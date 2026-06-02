#! /bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR/.."

cork-kube init prod
cork-kube up prod
cork-kube apply kustomize/vllm -o cyberdyne02-qwen35