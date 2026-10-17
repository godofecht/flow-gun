import Foundation
#if canImport(CoreML)
import CoreML
#endif

// Mirrors the Flow garden's visual genotype-to-phenotype terms.
// The CPU version remains the authoritative reference.
struct GardenGrid {
    static let width = 64
    static let cells = width * width
    static let inputChannels = 5
    static let outputChannels = 4

    // Channel-first: stature, branching, pigment, moisture, nutrients.
    let features: [Float]

    init(seed: UInt32) {
        var random = seed
        func next() -> UInt32 {
            random = random &* 1_664_525 &+ 1_013_904_223
            return random
        }
        var values = [Float](repeating: 0, count: Self.inputChannels * Self.cells)
        for cell in 0..<Self.cells {
            let a = next()
            let b = next()
            func locus(_ shift: UInt32) -> Float {
                Float(((a >> shift) & 255) + ((b >> shift) & 255)) / 510
            }
            values[cell] = locus(8)
            values[Self.cells + cell] = locus(16)
            values[2 * Self.cells + cell] = locus(24)
            values[3 * Self.cells + cell] = Float(next() & 65535) / 65535
            values[4 * Self.cells + cell] = Float(next() & 65535) / 65535
        }
        features = values
    }

    // Same affine features as the real Flow renderer; no ecology is altered.
    func cpuPhenotype() -> [Float] {
        var result = [Float](repeating: 0, count: Self.outputChannels * Self.cells)
        for i in 0..<Self.cells {
            result[i] = features[i]
            result[Self.cells + i] = features[Self.cells + i]
            result[2 * Self.cells + i] = features[2 * Self.cells + i]
            result[3 * Self.cells + i] = 0.35
                + 0.25 * features[3 * Self.cells + i]
                + 0.40 * features[4 * Self.cells + i]
        }
        return result
    }
}

struct Comparison {
    let maximumAbsoluteError: Float
    let meanAbsoluteError: Float
}

func compare(_ expected: [Float], _ actual: [Float]) throws -> Comparison {
    guard expected.count == actual.count else {
        throw GardenError.message("output length mismatch")
    }
    var maximum: Float = 0
    var sum: Double = 0
    for i in expected.indices {
        guard expected[i].isFinite, actual[i].isFinite else {
            throw GardenError.message("nonfinite output")
        }
        let error = abs(expected[i] - actual[i])
        maximum = max(maximum, error)
        sum += Double(error)
    }
    return Comparison(maximumAbsoluteError: maximum,
                      meanAbsoluteError: Float(sum / Double(expected.count)))
}

enum GardenError: Error, CustomStringConvertible {
    case message(String)
    var description: String {
        switch self { case .message(let text): return text }
    }
}

func benchmark(iterations: Int, operation: () throws -> Void) rethrows -> Double {
    let start = ProcessInfo.processInfo.systemUptime
    for _ in 0..<iterations { try operation() }
    return 1000 * (ProcessInfo.processInfo.systemUptime - start) / Double(iterations)
}

// Prevent the release compiler from removing the CPU reference work.
final class ResultSink {
    var checksum: Float = 0
    @inline(never)
    func consume(_ values: [Float]) {
        checksum += values[values.count - 1]
    }
}

#if canImport(CoreML)
struct CoreMLPhenotype {
    let model: MLModel

    init(modelURL: URL, units: MLComputeUnits) throws {
        let configuration = MLModelConfiguration()
        configuration.computeUnits = units
        // Compilation/warmup are excluded from the timed inference batches.
        let compiled = try MLModel.compileModel(at: modelURL)
        model = try MLModel(contentsOf: compiled, configuration: configuration)
    }

    func predict(_ grid: GardenGrid) throws -> [Float] {
        let tensor = try MLMultiArray(
            shape: [1, GardenGrid.inputChannels, GardenGrid.width, GardenGrid.width]
                .map { NSNumber(value: $0) },
            dataType: .float32
        )
        let values = tensor.dataPointer.bindMemory(
            to: Float.self, capacity: grid.features.count
        )
        for i in grid.features.indices { values[i] = grid.features[i] }

        let provider = try MLDictionaryFeatureProvider(dictionary: ["features": tensor])
        let prediction = try model.prediction(from: provider)
        guard let output = prediction.featureValue(for: "phenotype")?.multiArrayValue else {
            throw GardenError.message("missing phenotype output")
        }
        guard output.shape.map({ $0.intValue }) ==
                [1, GardenGrid.outputChannels, GardenGrid.width, GardenGrid.width] else {
            throw GardenError.message("unexpected phenotype shape")
        }
        var result = [Float](repeating: 0, count: GardenGrid.outputChannels * GardenGrid.cells)
        let strideC = output.strides[1].intValue
        let strideY = output.strides[2].intValue
        let strideX = output.strides[3].intValue
        for c in 0..<GardenGrid.outputChannels {
            for y in 0..<GardenGrid.width {
                for x in 0..<GardenGrid.width {
                    let index = c * GardenGrid.cells + y * GardenGrid.width + x
                    let offset = c * strideC + y * strideY + x * strideX
                    switch output.dataType {
                    case .float32:
                        result[index] = output.dataPointer
                            .bindMemory(to: Float.self, capacity: output.count)[offset]
                    case .float16:
                        let bits = output.dataPointer
                            .bindMemory(to: UInt16.self, capacity: output.count)[offset]
                        result[index] = Float(Float16(bitPattern: bits))
                    case .double:
                        result[index] = Float(output.dataPointer
                            .bindMemory(to: Double.self, capacity: output.count)[offset])
                    default:
                        throw GardenError.message("unsupported Core ML output type")
                    }
                }
            }
        }
        return result
    }
}
#endif

func run() throws {
    let args = Array(CommandLine.arguments.dropFirst())
    let modelPath = args.first(where: { $0.hasPrefix("--model=") })
        .map { String($0.dropFirst("--model=".count)) }
    let countString = args.first(where: { $0.hasPrefix("--iterations=") })
        .map { String($0.dropFirst("--iterations=".count)) }
    let iterations = countString.flatMap(Int.init) ?? 100
    guard iterations > 0 && iterations <= 100_000 else {
        throw GardenError.message("iterations must be between 1 and 100000")
    }
    let grid = GardenGrid(seed: 20_261_010)
    let expected = grid.cpuPhenotype()
    let sink = ResultSink()
    let baseline = benchmark(iterations: iterations) {
        sink.consume(grid.cpuPhenotype())
    }
    print("cpu-reference: \(String(format: "%.4f", baseline)) ms/batch; checksum \(sink.checksum)")

    guard let path = modelPath else {
        print("No Core ML model supplied; CPU-only reference completed.")
        return
    }
    #if canImport(CoreML)
    let url = URL(fileURLWithPath: path)
    for (name, units) in [
        ("cpu-only", MLComputeUnits.cpuOnly),
        ("cpu-and-ane", MLComputeUnits.cpuAndNeuralEngine)
    ] {
        let predictor = try CoreMLPhenotype(modelURL: url, units: units)
        let prediction = try predictor.predict(grid)
        let diff = try compare(expected, prediction)
        // Float16 conversions may differ slightly from Flow's float32 maths.
        guard diff.maximumAbsoluteError <= 0.005 else {
            throw GardenError.message("\(name) fails numerical parity: \(diff.maximumAbsoluteError)")
        }
        for _ in 0..<10 { _ = try predictor.predict(grid) }
        let milliseconds = try benchmark(iterations: iterations) {
            _ = try predictor.predict(grid)
        }
        print("\(name): \(String(format: "%.4f", milliseconds)) ms/batch; " +
              "max error \(diff.maximumAbsoluteError); " +
              "mean error \(diff.meanAbsoluteError)")
    }
    #else
    throw GardenError.message("Core ML is only available on macOS")
    #endif
}

do {
    try run()
} catch {
    fputs("garden-ane: \(error)\n", stderr)
    exit(1)
}
