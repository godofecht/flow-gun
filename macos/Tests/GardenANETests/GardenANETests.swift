import XCTest
@testable import GardenANE

final class GardenANETests: XCTestCase {
    func testReproducibility() {
        let first = GardenGrid(seed: 1)
        XCTAssertEqual(first.features, GardenGrid(seed: 1).features)
        XCTAssertNotEqual(first.features, GardenGrid(seed: 2).features)
    }

    func testPhenotypeBounds() {
        let result = GardenGrid(seed: 77).cpuPhenotype()
        XCTAssertEqual(result.count, 4 * 64 * 64)
        XCTAssertTrue(result.allSatisfy { $0.isFinite && $0 >= 0 && $0 <= 1 })
    }

    func testComparisonRejectsMismatch() throws {
        let match = try compare([0, 1], [0.001, 1.001])
        XCTAssertEqual(match.maximumAbsoluteError, 0.001, accuracy: 0.00001)
        XCTAssertThrowsError(try compare([0], [0, 1]))
    }
}
