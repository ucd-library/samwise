#! /bin/bash

# The GFD labeler is what's crashing it. The labeler tries to read memory info to generate node labels 
# like nvidia.com/gpu.memory, hits the same unified-memory Not Supported from NVML, and since 
# failOnInitError: true is set, the entire process exits.
# Two things to fix — disable GFD (which you don't strictly need) and relax the init error behavior.

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Copy the nvidia-config.yaml file to the control plane node and run this
microk8s enable nvidia --driver host --values nvidia-config.yaml