#!/usr/bin/env python3
"""Compile the *original* Flow-gun application with Apple Silicon PGO.

No simulated renderer, imported Python runtime, or new ecology. Uses exactly
the garden source Flow emits, trains on its actual 3D raster workload, and
links the native Cocoa graphics backend. Explicit --no-pgo fallback.
"""
import argparse
import os
from pathlib import Path
import platform
import subprocess
import tempfile


def run(args, env=None):
    args = [str(arg) for arg in args]
    print("+", " ".join(args), flush=True)
    subprocess.run(args, check=True, env=env)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--flow", type=Path, default=Path("flow-sdk/flow"))
    parser.add_argument("--output", type=Path, default=Path("build/garden-apple-silicon"))
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--no-pgo", action="store_true",
                        help="Skip training and use conservative -O2 -mcpu=native")
    parser.add_argument("--training-frames", type=int, default=60)
    args = parser.parse_args()

    if platform.system() != "Darwin" or platform.machine() != "arm64":
        parser.error("Apple Silicon macOS required")
    if args.training_frames < 8 and not args.no_pgo:
        parser.error("PGO requires at least 8 representative frames")
    root = Path(__file__).resolve().parent.parent
    flow = args.flow.resolve()
    sdk = flow.parent
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    # Flow generates portable WGSL + Metal stages from the same descriptor.
    run([flow, "run", root / "src/garden_gpu.flow"])
    shader = root / "dist/gpu/garden_scene/sh0_garden.metal"
    if not shader.is_file():
        raise RuntimeError("Flow GPU shader generation failed")

    with tempfile.TemporaryDirectory(prefix="garden-pgo-") as directory:
        scratch = Path(directory)
        # Use Flow's own supported headless compilation path to materialise
        # the source and correctly versioned Flow runtime archive.
        run([flow, "record", root / "src/garden.flow",
             "--frames", "1", "--out", scratch / "bootstrap"])
        generated = sdk / "build/garden.record.c"
        runtime_record = sdk / "build/runtime_flow/gfx_record.c"
        archives = list(sdk.rglob("libflowrt.a"))
        if not generated.is_file() or not runtime_record.is_file() or not archives:
            raise RuntimeError("Flow did not generate required C and runtime archive")
        archive = max(archives, key=lambda item: item.stat().st_mtime)
        common = ["-O2", "-mcpu=native", "-fno-omit-frame-pointer",
                  "-Wno-error=implicit-function-declaration"]
        profile_flags = []
        if not args.no_pgo:
            training_binary = scratch / "garden-training"
            raw_profile = scratch / "garden.profraw"
            merged = scratch / "garden.profdata"
            run([
                "clang", *common, "-fprofile-instr-generate",
                generated, runtime_record, sdk / "runtime/gfx_record.c",
                archive, "-framework", "CoreFoundation", "-lm",
                "-o", training_binary
            ])
            environment = os.environ.copy()
            environment.update({
                "LLVM_PROFILE_FILE": str(raw_profile),
                "FLOW_GFX_RECORD_DIR": str(scratch / "training"),
                "FLOW_GFX_RECORD_FRAMES": str(args.training_frames),
                # Switch to 3D, rotate the camera across many plants.
                "FLOW_GFX_RECORD_KEYS": "1:48,2:48,4-200:123",
            })
            Path(environment["FLOW_GFX_RECORD_DIR"]).mkdir()
            run([training_binary], env=environment)
            if not raw_profile.is_file():
                raise RuntimeError("Clang did not produce an instrumentation profile")
            run(["xcrun", "llvm-profdata", "merge", "-output", merged, raw_profile])
            profile_flags = [f"-fprofile-instr-use={merged}"]

        # The Flow garden C is unchanged, only macOS native build flags
        # differ. Cocoa event handling and the Flow ABI are unmodified.
        run([
            "clang", *common, *profile_flags, generated,
            sdk / "runtime/gfx_macos.m", root / "macos/garden_metal.m", archive,
            "-framework", "Metal", "-framework", "Foundation",
            "-framework", "Cocoa", "-framework", "CoreGraphics",
            "-framework", "QuartzCore", "-framework", "CoreText",
            "-framework", "CoreAudio", "-framework", "AudioToolbox",
            "-framework", "AudioUnit", "-lm", "-o", output
        ])

    print("Built Apple Silicon native Flow-gun:", output)
    if args.run:
        launch_env = os.environ.copy()
        launch_env["FLOW_GARDEN_MSL"] = str(shader)
        run([output], env=launch_env)


if __name__ == "__main__":
    main()
