# Apple Silicon phenotype acceleration experiment (macOS only)

This directory now contains both an **opt-in real Metal 3D raster backend**
and the earlier Core ML feasibility benchmark. The native builder uses the
original Flow ecology and shares shader definitions with WebGPU; the regular
portable `flow gfx` path, Linux and the headless recorder retain the
Flow software renderer. The Core ML phenotype transform remains disabled.

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

## Observed Apple Silicon CI result (17 October 2026)

The `macos-15` arm64 runner successfully built the model and passed all
Swift unit tests and Core ML numerical comparisons. The diagnostic numbers
from [the first successful job](https://github.com/godofecht/flow-gun/actions/runs/39039983977):

| Backend | Milliseconds per 4,096-cell batch | Max absolute error vs Swift |
|---|---:|---:|
| Direct Swift CPU | 0.0111 | 0 |
| Core ML CPU only | 1.0350 | 0.0000976 |
| Core ML CPU + Neural Engine allowed | 1.0725 | 0.0000976 |

**Do not enable this backend for the current phenotype transform.** It is
approximately **97× slower** than the direct CPU reference when accounting
for feature copies, Core ML scheduling and output readback. This is a
single virtualised M1 runner observation rather than a comprehensive hardware
study. The Core ML compute-unit option does not establish actual ANE placement.
A future heavy learned morphology network could cross the break-even point,
but it would require different measurements and actual integration.

## GPU graphics: shared Flow shader source

`src/garden_gpu.flow` defines the typed 3D vertex/fragment pipeline with
Flow's `stdlib/gpu_render.flow`. The **same Flow invocation** emits
`dist/gpu/garden_scene/sh0_garden.wgsl` and `.metal` through
`gpu_job_write`. The native build automatically runs the generator.
`macos/garden_metal.m` implements the GPU raster stage with an offscreen Metal
render target and depth buffer. Its input is the *actual Flow simulator*
(ground, species, age, resources, genes, terrain and camera matrix).
Geometry and pixel colours are drawn on the GPU, then read back to the
existing Flow framebuffer so HUD and controls are preserved.

The browser Pages workflow runs the exact same Flow generator, and
`site/garden-webgpu.js` uses the WGSL on a WebGPU canvas over the native
Flow canvas' 3D viewport. WebGPU is selected automatically when available.
The browser's 2D interface and software 3D fallback remain untouched.
The browser uses Emscripten SIMD (`-msimd128`); Apple-only PGO does **not**
transfer to WASM.

The two GPU renderers generate simplified crossed-leaf vegetation for
the same genomes and positions. They are not yet pixel-identical to Flow's
software organ rendering, and native Metal introduces texture readback
overhead. **Do not infer an interactive FPS win** from the earlier Clang
PGO benchmark. Verify scene quality, end-to-end FPS and energy use on
real target Macs and browsers before using GPU by default more widely.

## Native macOS application build: successful PGO experiment

The actual bottleneck in Flow-gun is its **CPU 3D software rasterizer**, not
its tiny 64×64 phenotype arithmetic. An Apple Silicon-specific build profile
is now available for the **original Flow source and Cocoa window**:

```sh
git clone https://github.com/flooooooooooow/flow.git flow-sdk
python3 macos/build_native.py --flow flow-sdk/flow --run
```

Requires an Apple Silicon Mac, the Xcode command-line tools, Python 3 and the
Flow compiler checkout. The script compiles the original `src/garden.flow`,
trains PGO on real 3D garden frames, then links the **same Flow program** to
its standard Cocoa graphics backend using `-O2 -mcpu=native` and the generated
profile. No simulated garden, altered biology or GPU acceleration is involved.
The default `flow gfx src/garden.flow` remains unchanged. Run
`python3 macos/build_native.py --flow flow-sdk/flow --no-pgo --run`
for the conservative Apple CPU build without PGO.

On the GitHub-hosted macOS 15 arm64 runner on 17 October 2026, five compiler
variants produced **pixel-identical 18-frame moving 3D recordings**:

| Compiled garden | Median 18-frame wall time (2 runs) | vs baseline |
|---|---:|---:|
| Flow-compatible `-O2` | 0.3811 s | 1.000× |
| `-O2 -mcpu=native` | 0.3653 s | 1.043× |
| `-O3 -mcpu=native` | 0.3944 s | 0.966× |
| `-Oz -mcpu=native` | 0.4326 s | 0.881× |
| **`-O2 -mcpu=native` with PGO** | **0.3466 s** | **1.099×** |

Source: [successful moving 3D benchmark CI](https://github.com/godofecht/flow-gun/actions/runs/39041066519).
Times include startup and writing image files, not just rasterization;
these are small CI samples and **not** stable interactive frame-rate
measurements. The CI runner has no validated user-visible Cocoa window test;
only the build, headless rendering, exact pixel parity and timing are tested.
The script intentionally keeps Linux, WebAssembly and Flow core untouched.

## Further performance and parity gates

The GPU paths now consume the actual Flow environmental state through one
batched native/WASM ABI crossing. Their next gates are GPU-vs-CPU visual parity,
steady-state FPS under representative camera movements, retained geometry
buffers and avoidance of synchronous Metal readback. The fallback remains
the original Flow renderer whenever the device or shader is unavailable.
The Core ML arithmetic experiment remains deliberately unused because
the measured end-to-end latency was much worse than direct CPU calculation.
