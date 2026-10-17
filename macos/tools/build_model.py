#!/usr/bin/env python3
"""Create the Flow-gun visual phenotype Core ML model without PyTorch.

features [1,5,64,64]: stature, branches, pigment, moisture, nutrients
phenotype [1,4,64,64]: stature, branches, pigment, vigour
The weights encode the exact affine phenotype terms in src/garden.flow.
"""
from pathlib import Path
import argparse

import numpy as np
import coremltools as ct
from coremltools.converters.mil.mil import Builder as mb


def build(path: Path):
    weights = np.zeros((4, 5, 1, 1), dtype=np.float32)
    for channel in range(3):
        weights[channel, channel, 0, 0] = 1.0
    weights[3, 3, 0, 0] = 0.25
    weights[3, 4, 0, 0] = 0.40
    bias = np.array([0.0, 0.0, 0.0, 0.35], dtype=np.float32)

    @mb.program(input_specs=[mb.TensorSpec(shape=(1, 5, 64, 64))])
    def program(features):
        return mb.conv(x=features, weight=weights, bias=bias,
                       pad_type="valid", name="phenotype")

    model = ct.convert(
        program,
        convert_to="mlprogram",
        minimum_deployment_target=ct.target.macOS13,
        compute_precision=ct.precision.FLOAT16,
        compute_units=ct.ComputeUnit.CPU_ONLY,
    )
    model.author = "Flow-gun macOS acceleration experiment"
    model.short_description = "Batched visual phenotype channels for the Flow garden"
    model.save(str(path))
    print(path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("macos/GardenPhenotype.mlpackage"))
    arguments = parser.parse_args()
    arguments.out.parent.mkdir(parents=True, exist_ok=True)
    build(arguments.out)
