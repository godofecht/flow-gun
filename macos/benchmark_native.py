#!/usr/bin/env python3
"""Actual moving 3D Flow-gun frames: macOS arm64 compiler experiments.

All candidates compile exactly the same Flow-generated C, with no different
garden rules or synthetic renderer. Pixel parity is checked frame by frame.
"""
import argparse
import hashlib
import os
from pathlib import Path
import platform
import statistics
import subprocess
import tempfile
import time


def execute(command, *, environment=None, quiet=False):
    if not quiet:
        print("+", " ".join(str(arg) for arg in command), flush=True)
    subprocess.run([str(arg) for arg in command], env=environment, check=True,
                   stdout=subprocess.DEVNULL if quiet else None,
                   stderr=subprocess.DEVNULL if quiet else None)


def timed(binary, folder, frames):
    folder.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment.update({
        "FLOW_GFX_RECORD_DIR": str(folder),
        "FLOW_GFX_RECORD_FRAMES": str(frames),
        # Tab toggles 3D, arrow rotates continuously. No idle frame timing.
        "FLOW_GFX_RECORD_KEYS": "1:48,2:48,4-200:123",
    })
    start = time.perf_counter()
    execute([str(binary)], environment=environment, quiet=True)
    elapsed = time.perf_counter() - start
    images = sorted(folder.glob("*.ppm"))
    if len(images) != frames:
        raise RuntimeError(f"{binary}: expected {frames} frames, found {len(images)}")
    return elapsed, images


def digest(path):
    return hashlib.sha256(path.read_bytes()).digest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--flow", type=Path, default=Path("flow-sdk/flow"))
    parser.add_argument("--frames", type=int, default=24)
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        parser.error("Apple Silicon macOS is required")
    if args.frames < 8 or args.repeats < 1:
        parser.error("at least 8 frames and 1 repeat required")
    flow = args.flow.resolve()
    sdk = flow.parent
    source = Path("src/garden.flow").resolve()

    with tempfile.TemporaryDirectory(prefix="garden-macos-") as temporary:
        scratch = Path(temporary)
        execute([str(flow), "record", str(source), "--frames", "1",
                 "--out", str(scratch / "bootstrap")])
        generated = sdk / "build/garden.record.c"
        recorder = sdk / "build/runtime_flow/gfx_record.c"
        libraries = list(sdk.rglob("libflowrt.a"))
        if not generated.exists() or not recorder.exists() or not libraries:
            raise RuntimeError("Flow did not generate recorder C and runtime archive")
        archive = max(libraries, key=lambda p: p.stat().st_mtime)
        sources = [generated, recorder, sdk / "runtime/gfx_record.c", archive]

        def build(name, flags):
            target = scratch / name
            execute(["clang", *flags, "-fno-omit-frame-pointer",
                     "-Wno-error=implicit-function-declaration",
                     *sources, "-framework", "CoreFoundation", "-lm",
                     "-o", target])
            return target

        binary = {
            "baseline O2": build("baseline", ["-O2"]),
            "O2 native": build("o2native", ["-O2", "-mcpu=native"]),
            "O3 native": build("o3native", ["-O3", "-mcpu=native"]),
            "Oz native": build("oznative", ["-Oz", "-mcpu=native"]),
        }
        instrumented = build("instrumented", [
            "-O2", "-mcpu=native", "-fprofile-instr-generate"
        ])
        profile_path = scratch / "training.profraw"
        os.environ["LLVM_PROFILE_FILE"] = str(profile_path)
        try:
            timed(instrumented, scratch / "training-frames", args.frames)
        finally:
            del os.environ["LLVM_PROFILE_FILE"]
        profile_data = scratch / "training.profdata"
        execute(["xcrun", "llvm-profdata", "merge", "-output", profile_data,
                 profile_path])
        binary["PGO native"] = build("pgo", [
            "-O2", "-mcpu=native", f"-fprofile-instr-use={profile_data}"
        ])

        elapsed = {key: [] for key in binary}
        all_names = list(binary)
        for repeat in range(args.repeats):
            names = all_names[repeat % len(all_names):] + all_names[:repeat % len(all_names)]
            captures = {}
            for name in names:
                duration, images = timed(
                    binary[name], scratch / f"{name.replace(' ', '-')}-{repeat}",
                    args.frames
                )
                elapsed[name].append(duration)
                captures[name] = [digest(path) for path in images]
            reference = captures["baseline O2"]
            if reference[3] == reference[-1]:
                raise RuntimeError("camera fixture did not produce moving 3D frames")
            for name in binary:
                if captures[name] != reference:
                    bad = next(i for i, (a, b) in enumerate(
                        zip(reference, captures[name])) if a != b)
                    raise RuntimeError(f"{name} has different pixels at frame {bad}")

        base = statistics.median(elapsed["baseline O2"])
        print(f"PASS: pixel-exact parity across {args.frames} moving 3D frames")
        for name in binary:
            value = statistics.median(elapsed[name])
            print(f"{name}: {value:.4f}s median ({args.repeats} runs), " +
                  f"end-to-end speedup: {base / value:.3f}x")
        winner = min(binary, key=lambda name: statistics.median(elapsed[name]))
        print(f"WINNER: {winner}")
        if winner == "baseline O2":
            print("NO MAC BUILD SPEEDUP: keep Flow's default native optimisation")


if __name__ == "__main__":
    main()
