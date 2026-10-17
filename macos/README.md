# Apple Silicon phenotype acceleration experiment (macOS only)

This is an **opt-in feasibility benchmark**, not an enabled rendering backend.
The existing `src/garden.flow` deterministic ecology, software 3D renderer,
recorder, Linux workflow and GitHub Pages WASM build are not modified.

The experiment packs 4,096 plant-cell features into one Core ML tensor
(`NCHW [1,5,64,64]`) and runs a fixed, explicit 1×1-convolution transform
that mirrors the actual garden's simple visual phenotype terms:

```text
stature  = (genome_a[8:15]  + genome_b[8:15])  / 510
branches = (genome_a[16:23] + genome_b[16:23]) / 510
pigment  = (genome_a[24:31] + genome_b[24:31]) / 510
vigour   = 0.35 + 0.25 * moisture + 0.40 * nutrients
```

The benchmark first computes the same terms in Swift with a seedable LCG
matching the garden's generator, then checks Core ML numerical agreement
(maximum absolute error ≤ 0.005) and measures **end-to-end batch latency**
for (1) the Swift CPU reference, (2) Core ML CPU-only and
(3) Core ML CPU + Neural Engine. Timings exclude model compilation
and warmup, but **include each input allocation/copy and output readback**
because those costs matter at runtime.

**Crucial:** these are arithmetic operations, not a learned model.
Core ML might run all or part of them on the CPU despite the
`.cpuAndNeuralEngine` request. A very small 64×64 transform is likely
to lose to direct CPU arithmetic. The feature remains deliberately disabled
until instrumented Apple Silicon measurements show a real benefit. It does
not accelerate arbitrary Flow branching, ecological RNG, software
rasterisation, or the garden application itself yet.

## Run on an Apple Silicon Mac

Requires macOS 13+, Xcode command-line tools, Swift 5.9+ and Python 3.11+:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install 'numpy<3' 'coremltools>=8,<10'
python macos/tools/build_model.py --out macos/GardenPhenotype.mlpackage
swift test --package-path macos
swift run --package-path macos -c release garden-ane --model=macos/GardenPhenotype.mlpackage --iterations=250
```

Run `swift run --package-path macos -c release garden-ane` without a
model to check the CPU reference on any Swift-supported platform.

The workflow `.github/workflows/macos-ane.yml` compiles and tests
the Apple Silicon prototype on `macos-15`, but CI benchmarks are
diagnostic, not proof of user-device performance. Core ML's requested
compute units are *allowed devices*, not guaranteed placement. Use Xcode
Instruments/Core ML performance reporting to confirm ANE utilisation.

## Runtime integration gate

This is a safe first stage; it intentionally does not duplicate the Flow
simulation or add an unverified macOS-only FFI to its main loop.
Before enabling anything in `src/garden.flow`, the next stage must export
or batch the *actual* genotype/environment data at a native Flow ABI boundary,
reuse the returned phenotype buffer in the renderer, ensure deterministic
fallback, and benchmark complete frames. The fallback should be the original
CPU path whenever Core ML compilation, availability, numerical parity, or
frame latency is worse. The 2D/3D and WASM views must still represent the
same ecological state. Do not claim an ANE performance win from this
prototype without the hardware evidence.
