# Flow Garden

**A tiny living world grown by [Flow](https://github.com/flooooooooooow/flow).**

A colourful, interactive 2D and 3D garden in which **soil, moisture, light, resources and neighbouring plants** determine what grows. You can plant four species, change the weather, clear a patch, and watch the ecosystem reorganise. The living garden is simulated and rendered **entirely in Flow** with the native gfx library.

## Play on GitHub Pages

The browser site is generated from **the same `src/garden.flow`** source using Emscripten and the Flow WASM backend. The [Pages workflow](.github/workflows/pages.yml) automatically builds the site and publishes the generated WebAssembly bundle once GitHub Pages is enabled.

GitHub Pages is deployed by the [publish workflow](.github/workflows/pages.yml), which compiles the original Flow program to WebAssembly before deployment. The repository's Pages source must remain set to **GitHub Actions** (rather than branch-based Jekyll) for the interactive site to stay live.

After deployment, the public URL is: https://godofecht.github.io/flow-gun/

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

Startup runs 90 simulation ticks twice from the same fixed seed, checks the lattice invariants (no vegetation on stone or water; biological type range; bounded resources; surviving plants), and checks identical state fingerprints. The app aborts before opening its graphics window if either check fails.

The GitHub workflow is a compile/record smoke test against current Flow main. The startup tests are deterministic invariants, **not** an ecological validation study.

## Extend it

Add competition for vertical canopy light, soil microbes and decomposers, nutrient-driven root branching, pollen agents and directional seed drift, seasons, or a state-to-state recognition/residual probe to detect emergent ecological regimes. The current model is intentionally small and inspectable.

The core implementation is in [`src/garden.flow`](src/garden.flow).
