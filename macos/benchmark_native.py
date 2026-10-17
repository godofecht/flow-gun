#!/usr/bin/env python3
"""Benchmark real Flow-gun 3D frames with standard vs Apple Silicon-tuned Clang.

No model, synthetic grid, benchmark-only renderer, or changes to the Flow
simulator: both binaries execute the exact C source emitted by Flow.
"""
import argparse
import hashlib
import os
from pathlib import Path
import platform
import shutil
import statistics
import subprocess
import tempfile
import time


def execute(command, *, environment=None, quiet=False):
    if not quiet:
        print("+", " ".join(str(arg) for arg in command), flush=True)
    subprocess.run(command, env=environment, check=True,
                   stdout=subprocess.DEVNULL if quiet else None,
                   stderr=subprocess.DEVNULL if quiet else None)


def timed(binary, folder, frames):
    folder.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment.update({
        "FLOW_GFX_RECORD_DIR": str(folder),
        "FLOW_GFX_RECORD_FRAMES": str(frames),
        # Enter 3D and continuously orbit: tests actual CPU raster workload.
        "FLOW_GFX_RECORD_KEYS": "1:48,2:48,4-200:123",
    })
    start = time.perf_counter()
    execute([str(binary)], environment=environment, quiet=True)
    elapsed = time.perf_counter() - start
    images = sorted(folder.glob("*.ppm"))
    if len(images) != frames:
        raise RuntimeError(f"{binary}: expected {frames} frames, found {len(images)}")
    return elapsed, images


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--flow", type=Path, default=Path("flow-sdk/flow"))
    parser.add_argument("--frames", type=int, default=32)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--require-speedup", action="store_true")
    arguments = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        parser.error("Apple Silicon macOS required")
    if arguments.frames < 8 or arguments.repeats < 1:
        parser.error("at least 8 frames and 1 repeat required")
    flow = arguments.flow.resolve()
    sdk = flow.parent
    source = Path("src/garden.flow").resolve()
    if not source.exists():
        parser.error("run from flow-gun repository root")

    # Flow's own record command compiles the correct runtime archive and
    # generator source; never guess the Flow ABI or depend on old codegen.
    with tempfile.TemporaryDirectory(prefix="garden-macos-") as temporary:
        scratch = Path(temporary)
        env = os.environ.copy()
        env.update({
            "FLOW_GFX_RECORD_FRAMES": "1",
            "FLOW_GFX_RECORD_DIR": str(scratch / "bootstrap"),
        })
        execute([str(flow), "record", str(source), "--frames", "1",
                 "--out", str(scratch / "bootstrap")], environment=env)

        generated = sdk / "build" / "garden.record.c"
        recorder = sdk / "build" / "runtime_flow" / "gfx_record.c"
        libraries = list(sdk.rglob("libflowrt.a"))
        if not generated.exists() or not recorder.exists() or not libraries:
            raise RuntimeError("Flow record generated C / runtime archive missing")
        # The recorder toolchain builds a single runtime archive for this checkout.
        archive = max(libraries, key=lambda p: p.stat().st_mtime)
        files = [str(generated), str(recorder),
                 str(sdk / "runtime" / "gfx_record.c"), str(archive)]

        binaries = {}
        for name, extra in {
            "standard": ["-O2"],
            "apple-silicon": ["-O3", "-mcpu=native"],
        }.items():
            target = scratch / name
            execute(["clang", *extra, "-fno-omit-frame-pointer",
                     "-Wno-error=implicit-function-declaration", *files,
                     "-framework", "CoreFoundation", "-lm",
                     "-o", str(target)])
            binaries[name] = target

        elapsed = {"standard": [], "apple-silicon": []}
        for repeat in range(arguments.repeats):
            # Alternate ordering to reduce thermal/caching bias.
            names = list(binaries)
            if repeat % 2:
                names.reverse()
            captured = {}
            for name in names:
                folder = scratch / f"{name}-{repeat}"
                seconds, images = timed(binaries[name], folder, arguments.frames)
                elapsed[name].append(seconds)
                captured[name] = images
            for index, (base, tuned) in enumerate(zip(
                    captured["standard"], captured["apple-silicon"])):
                if sha(base) != sha(tuned):
                    raise RuntimeError(
                        f"pixel parity failed: iteration {repeat}, frame {index}"
                    )
            # Ensure we really rendered a moving scene, not a frozen viewport.
            if sha(captured["standard"][3]) == sha(captured["standard"][-1]):
                raise RuntimeError("camera motion fixture produced identical frames")
        baseline = statistics.median(elapsed["standard"])
        optimized = statistics.median(elapsed["apple-silicon"])
        speedup = baseline / optimized
        print(f"PASS: pixel-exact parity across {arguments.frames} moving 3D frames")
        print(f"standard -O2:      {baseline:.4f}s median ({arguments.repeats} runs)")
        print(f"apple -O3 -mcpu:   {optimized:.4f}s median ({arguments.repeats} runs)")
        print(f"end-to-end speedup: {speedup:.3f}x")
        if arguments.require_speedup and speedup <= 1.0:
            raise SystemExit("Apple Silicon compiler tuning is not faster")


if __name__ == "__main__":
    main()
