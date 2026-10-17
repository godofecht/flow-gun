#!/usr/bin/env python3
"""Build the unchanged Flow-gun program with Apple Silicon Clang tuning.

This is deliberately a macOS-specific *build optimisation*, not a second
simulation. The same Flow garden is compiled, linked with Cocoa's gfx backend,
and retains its deterministic model and user controls.
"""
import argparse
from pathlib import Path
import platform
import subprocess
import tempfile


def run(args):
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run([str(value) for value in args], check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--flow", type=Path, default=Path("flow-sdk/flow"))
    parser.add_argument("--output", type=Path, default=Path("build/garden-apple-silicon"))
    parser.add_argument("--run", action="store_true")
    args = parser.parse_args()

    if platform.system() != "Darwin" or platform.machine() != "arm64":
        parser.error("native Apple Silicon macOS required")
    root = Path(__file__).resolve().parent.parent
    flow = args.flow.resolve()
    sdk = flow.parent
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="garden-gfx-bootstrap-") as folder:
        # 'record' generates the same C-language garden and Flow runtime,
        # without opening a window on a headless CI runner.
        run([flow, "record", root / "src/garden.flow",
             "--frames", "1", "--out", folder])

    generated = sdk / "build/garden.record.c"
    archives = list(sdk.rglob("libflowrt.a"))
    if not generated.is_file() or not archives:
        raise RuntimeError("Flow compiler did not produce expected generated source/archive")
    archive = max(archives, key=lambda item: item.stat().st_mtime)
    run([
        "clang", "-O3", "-mcpu=native", "-fno-omit-frame-pointer",
        "-Wno-error=implicit-function-declaration",
        generated, sdk / "runtime/gfx_macos.m", archive,
        "-framework", "Cocoa",
        "-framework", "CoreGraphics",
        "-framework", "QuartzCore",
        "-framework", "CoreText",
        "-framework", "CoreAudio",
        "-framework", "AudioToolbox",
        "-framework", "AudioUnit",
        "-lm", "-o", output,
    ])
    print("Apple Silicon native Flow-gun built:", output)
    if args.run:
        run([output])


if __name__ == "__main__":
    main()
