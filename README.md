# Flow Garden

**A tiny living world grown by [Flow](https://github.com/flooooooooooow/flow).**

A colourful, interactive 2D and 3D garden in which **soil, moisture, light, resources and neighbouring plants** determine what grows. You can plant four species, change the weather, clear a patch, and watch the ecosystem reorganise. The living garden is simulated and rendered **entirely in Flow** with the native gfx library.

## Play on GitHub Pages

The browser site is generated from **the same `src/garden.flow`** source using Emscripten and Flow's WebAssembly backend. The [website workflow](.github/workflows/pages.yml) compiles the real program, loads it in headless Chromium, verifies that **the canvas has a nonzero visible size, contains actual garden pixels, advances frames, and switches to 3D**, and then mirrors the verified static files and `.wasm` binary to the repository's root. GitHub Pages serves this from **Deploy from a branch → main → /(root)**.

The workflow also opens the **actual public GitHub Pages URL in Chromium after publication** and checks its embedded Flow engine plus the exact source-commit marker. This catches deployment races, stale Pages output and an apparently successful build that displays a blank canvas. The previous competing direct-deployment mechanism has been removed.

After deployment, the public URL is: https://godofecht.github.io/flow-gun/

**If the canvas appears blank:** reload the page without cache (Shift + Reload, or Cmd + Shift + R on Mac), or open the [standalone viewer](https://godofecht.github.io/flow-gun/garden/index.html?autostart=1). The October 2026 zero-width canvas regression is fixed in `site/embed.css`; a dedicated real-browser regression test prevents silently republishing that bug. If loading itself fails, the dashboard displays a retry control and the engine's error.

## Full-screen evolutionary laboratory

The GitHub Pages interface is a **viewport-height laboratory**, with the
living WebAssembly canvas at its centre, environmental interventions and
species brushes on the left, and the evolutionary model on the right.
The previous long-form landing page has been replaced to minimise scrolling.
The embedded Flow canvas scales to the available viewport while preserving
its aspect ratio. The controls compact on narrow displays.

## Heritable genetics and developmental morphology

This is a **heritable evolutionary ecosystem**, not four fixed sprites. Every
occupied cell carries an explicit *diploid genome*: two homologous 32-bit
chromosomes with four quantitative 8-bit alleles per chromosome.

| Locus | Organism-level consequence |
|---|---|
| 0: hydration optimum | Shifts the moisture optimum determining survival and reproductive success |
| 1: stature / internodes | Controls height, maturation and growth cost |
| 2: branching allocation | Controls rosettes, fern pinnae, shrub meristems, seed allocation and nutrient cost |
| 3: pigment | Determines heritable floral colour morphs (pink, violet, gold) |

Offspring inherit a gamete made from randomly selected maternal alleles at
each locus, combined with a gamete from a conspecific neighbouring donor
(where available) or from the same parent (self-fertilisation). Each allele has
a **1/180 mutation probability** per gamete with a bounded change of
up to 20 units. Founders arrive through a background seed bank or planting.

Phenotype is a function of **genotype × environment × developmental age**:
resources and maturity regulate vigour; genomes regulate internode growth,
leaf and branch morphology, reproductive allocation, and petal pigments.
Selection therefore acts on *heritable differences* in a shared habitat.

Both 2D and 3D depict these inherited traits. Near organisms develop detailed
rosettes, paired fern pinnae, branching woody canopies, and petal whorls, while
distant individuals reduce to low-cost billboards. The in-game HUD displays
the current population's mean stature and branch alleles.

**Scientific scope:** This is an educational *evo-devo abstraction*, not
genome-scale, molecularly faithful, or experimentally calibrated plant biology.
Loci recombine freely rather than model linkage and crossover. The fern
alternation-of-generations lifecycle is simplified, and there are no simulated
molecular hormones, gene-regulatory networks, meiosis stages, or validated
biomechanical leaf-growth equations. Genetics and genotype-to-phenotype
causality are implemented rather than depicted decoratively; parameter values
are illustrative.

## Developmental genome compiler (experimental)

The Flow engine now compiles each occupied plant's diploid alleles into a small
**four-instruction developmental program** (four packed 32-bit words):

| Opcode | Organ-development program | Parameters |
|---|---|---|
| `AXIS` (1) | Primary stem / internode development | Stature, moisture physiology, species |
| `RAMIFY` (2) | Lateral meristems and shrub branching | Branch allocation, stature |
| `FOLIATE` (3) | Rosette leaflets and fern pinnae | Branch/leaf allocation, hydration |
| `REPRODUCE` (4) | Flowering threshold, pigmentation and reproductive allocation | Reproductive allocation, pigmentation, stature |

A per-cell program cache tracks both parental chromosomes and species. When
inheritance, mutation or deliberate planting changes a genome, the program
is recompiled; otherwise the renderer interprets the existing instructions.
This avoids rebuilding genotype-dependent instruction records on every camera
frame. The compiler is checked with dedicated bytecode format, operand and
allele-differentiation tests at startup. **These are developmental instructions,
not machine code, and are not a molecular gene-regulatory model.**

The 3D interpreter now renders distinct trunk internodes with bark bands and
lower woody branches, alongside species-specific leaf and floral organs.
Camera-distance levels of detail limit work on distant plants. Reproductive
fitness is still resolved by the ecology's resource-limited local mating rules,
using the same inherited allocation locus; the opcode provides a visual
developmental encoding rather than a separate independent breeding engine.

## Camera and touch-first interaction

The default 3D orbit opens centered over the garden at a readable elevated
pitch rather than looking across the garden from a displaced point.
Mouse dragging rotates the camera with finer sensitivity; zoom steps scale
with camera distance so both close morphology inspection and landscape
overview remain controllable, with smoothed transitions. Space resets the
camera to a stable center view.

On touch devices, **two translucent thumb controls** appear in 3D: the left
cluster moves with WASD semantics; the right cluster looks around using the
arrow-key camera controls. Plus/minus buttons adjust the orbit's dolly
distance. Controls release key state on pointer cancellation, blur, or
lost focus, preventing movement from becoming stuck. A live camera-mode
indicator distinguishes top-down, orbit and walk views. Pause, world reset
and camera recenter remain reachable on narrow mobile screens.

The [Chromium integration check](scripts/smoke-browser.mjs) tests a visible
running WASM canvas, actual movement/look key presses and releases, mobile
pause/resume and the camera-mode indicator on a 390px touchscreen viewport.

## Optimised 3D navigation

The 3D mode now features smooth frame-time-based movement, a birds-eye **orbit**
camera and a ground-level **walk** camera. Both are views of the same 2D
ecological lattice. **Tab** toggles 2D/3D, **V** switches orbit/walk,
**WASD** pans/moves, **drag** rotates the view, **arrow keys** look,
**scroll** zooms in orbit or changes FOV in walk, **Q/E** zoom in/out in
orbit, **F** accelerates movement, and **Space** resets orientation. The
3D ground uses 2,048 triangles instead of 8,192, with distance-based
vegetation detail reduction. The 64×64 ecology remains full-resolution.

## Run

Install [Flow](https://github.com/flooooooooooow/flow) from its current main branch (or, on macOS/Linux, use `brew tap flooooooooooow/flow && brew install flow`).

```sh
git clone https://github.com/godofecht/flow-gun.git
cd flow-gun
flow gfx src/garden.flow
```

If you are using a source checkout of Flow rather than an installed `flow`, run `/path/to/flow/flow gfx /path/to/flow-gun/src/garden.flow`.

On Linux, Flow's windowed gfx backend uses SDL2. On macOS, it uses the native Cocoa backend.

## Two views, one living world

The **2D map and navigable 3D garden are views of the exact same Flow simulation**, sharing plant identity, developmental age, soil, nutrients, rainfall, and random history. **Tab** switches between the views without resetting or copying the ecosystem. Flow's software 3D renderer projects an elevated heightfield, species-specific shoots and billboards using a depth buffer; the 3D camera appears as a marker on the 2D map and the 3D view contains a live minimap.

In 2D, click a plot to plant and position the 3D camera above it. In 3D, **orbit** mode lets you inspect the landscape from a rotatable vantage point, while **V** switches to a ground-level **walk** mode. **WASD** pans or walks, **drag** and **arrow keys** look, **scroll** zooms in orbit (or adjusts field of view in walk), **Q/E** provide keyboard orbit zoom, **F** moves faster, and **Space** returns to the garden centre and resets the camera orientation. Walkers slide along pond banks rather than passing through the water. Climate shortcuts in 3D are **Z = rain, X = temperate, C = drought** so they don't conflict with movement. Switch back to the map with **Tab**. The website has buttons that trigger the original Flow WebAssembly input handling.

There is no decorative camera animation or separate 3D biology: only user-controlled navigation and evolving plants.

## The garden

The 64 × 64 world has terrain (soil, a pond, and stepping-stone paths), two continuous fields (water and nutrients), and two discrete biological fields (species and age). Its ecology consists of four competing growth strategies.

| Species | Ecological niche | Visual |
|---|---|---|
| Clover | Rapid ground cover in moderately moist soil | Four green leaflets |
| Wildflowers | Sun-facing moderate-moisture beds; flower at maturity | Pink, violet and gold blossoms |
| Ferns | Damp, shaded soil | Alternating green fronds |
| Shrubs | Tolerate relatively dry soil, spread slowly and shade neighbours | Dark green canopies |

At each simulation day the solver diffuses moisture and nutrients from neighbouring cells; adjusts rainfall, evaporation, uptake and replenishment; lets established plants survive or die according to local fitness; and permits a random adjacent parent to colonise available soil. Decomposing litter returns nutrients. Rare background recruitment represents a persistent seed bank.

This is **morphogenesis through local environmental feedback**, not a pasted collage of prebuilt plants. No generator prescribes the locations or shapes of clover patches, flowerbeds, fern thickets or shrubby borders. The pond and paths are the fixed landscape constraints.

### Controls

| Input | Action |
|---|---|
| `Tab` | Toggle 2D map and 3D navigable garden |
| `WASD` (3D) | Pan the orbit focus / walk at ground level |
| Mouse drag / arrow keys (3D) | Look around |
| `V` (3D) | Switch orbit / walk camera |
| Mouse wheel (3D) | Dolly camera in orbit / adjust field of view in walk |
| `Q` / `E` (3D orbit) | Zoom closer / further |
| `F` (3D) | Fast move |
| `Space` (3D) | Return to centre and reset camera |
| `Z`/`X`/`C` (3D) | Rain / temperate / drought |
| `1`, `2`, `3`, `4` | Brush: clover, wildflower, fern, shrub |
| Left mouse button | Plant chosen species |
| Right mouse button | Remove plants |
| `W` | Rain |
| `S` | Temperate weather |
| `D` | Drought |
| `R` | New deterministic seed |
| `P` | Pause / resume |
| Escape | Quit |

## Record a GIF

Flow's headless recorder runs the exact same Flow program and visualiser:

```sh
flow record src/garden.flow --frames 240 --skip 3 --out /tmp/flow-garden --gif /tmp/flow-garden.gif
```

The repository's GitHub Actions workflow compiles and records a short run, then uploads the captured frames as an artifact. The 3D regression test **pauses the ecosystem first**, scripting keyboard movement and mouse drag/scroll so that distinct frames must arise from camera navigation, not plant growth.

## Model / rules

Let `m` denote moisture, `n` nutrient availability, `p` the plant occupant, `a` its age, and `L` local sunlight. Water updates by a four-neighbour diffusion stencil with precipitation, evaporation, and plant uptake:

```text
m[t+1] = clamp(m[t] + 0.12 * (mean4(m) - m[t]) + rain - evap - uptake)
```

Nutrients diffuse more slowly and recover through regrowth and decomposing litter:

```text
n[t+1] = clamp(n[t] + 0.04 * (mean4(n) - n[t]) + 0.004 - feeding + litter)
```

Fitness `F(species, m, n, L)` is explicitly species-dependent and bounded to `[0,1]`. Surviving individuals age, occasionally die, and compete for soil. Empty sites select **one neighbour** as a possible coloniser, then establish with a species-specific dispersal probability multiplied by `F`. A tiny seed-bank probability adds new immigrants.

The update is double buffered: all ecological decisions see the **previous** garden state, so results are not biased by row traversal order.

## Verification

Startup checks allele segregation and bounded mutation in gametes, plus
genotype-dependent fitness, then runs 90 simulation ticks twice from the same
fixed seed and checks the lattice invariants (no vegetation on stone or water; biological type range; bounded resources; surviving plants), and checks identical state fingerprints. The app aborts before opening its graphics window if either check fails.

The GitHub workflow is a compile/record smoke test against current Flow main. The startup tests are deterministic invariants, **not** an ecological validation study.

## Extend it

Add competition for vertical canopy light, soil microbes and decomposers, nutrient-driven root branching, pollen agents and directional seed drift, seasons, or a state-to-state recognition/residual probe to detect emergent ecological regimes. The current model is intentionally small and inspectable.

The core implementation is in [`src/garden.flow`](src/garden.flow).

## Flow-generated Metal and WebGPU garden renderer

The same typed Flow GPU shader in [src/garden_gpu.flow](src/garden_gpu.flow)
emits both MSL and WGSL. The GitHub Pages workflow automatically builds
WGSL alongside SIMD-enabled WebAssembly. When a browser exposes WebGPU,
[site/garden-webgpu.mjs](site/garden-webgpu.mjs) draws the actual living
garden cells and camera through a hardware depth-tested pipeline. Without
WebGPU the original Flow software 3D view runs unchanged. The browser
still runs the same ecological simulation with the same seed, genetics,
weather and interaction.

On Apple Silicon, run:

    python3 macos/build_native.py --flow flow-sdk/flow --run

This builds the original Flow app with a Metal rasterisation path, using
the same Flow-generated MSL and a software fallback.

The GPU paths currently draw simplified crossed-leaf geometry rather than
the software renderer's complete organ graph. This is a genuine GPU draw
from the same Flow world state, not a duplicate simulation, but exact pixel
parity and measured interactive FPS improvement are not yet established.

## Experimental Apple Silicon acceleration

The optional [macOS Core ML benchmark](macos/README.md) tests batching the
existing genotype-to-visual-phenotype calculations through Core ML with
CPU and CPU/Neural Engine settings. It verifies output agreement and measures
full batch latency on Apple Silicon; **it is not wired into the interactive
Flow renderer and makes no speedup claim**. The regular deterministic Flow,
Linux and WebAssembly paths remain unchanged.
