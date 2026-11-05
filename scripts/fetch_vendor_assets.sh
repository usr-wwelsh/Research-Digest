#!/bin/bash
# Fetches the onnxruntime-web WASM runtime that models.worker.js needs to
# run transformers.js locally in the browser. Not committed to git (same
# treatment as the HF model weights in .hf_cache/ — a one-time download,
# cached on disk after that) so the repo stays free of large binaries.
#
# This pulls from jsdelivr once, at setup/dev time, into vendor/ort/, which
# Caddy then serves same-origin — the *running app* never calls out to
# jsdelivr; only this script does, the same way `pip install`/`npm pack`
# already fetch from a public registry during setup elsewhere in this repo.
#
# The version below must match the onnxruntime-web dependency pinned by
# app/vendor/transformers.min.js's package (@huggingface/transformers) —
# see that file's header comment for how to check/update it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ORT_VERSION="1.26.0-dev.20260416-b7804b056c"
ORT_BASE="https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist"
OUT_DIR="$ROOT_DIR/vendor/ort"

mkdir -p "$OUT_DIR"

declare -A SHA256=(
    ["ort-wasm-simd-threaded.mjs"]="5f2cd914554830762579c372d0211614c1e3f40ab3f6c0cfcf0900343229071d"
    ["ort-wasm-simd-threaded.wasm"]="f4f290847a4df02d0b93cdbf39b4b0e71acefbe80573e7e6b9342a7abd7b290a"
    ["ort-wasm-simd-threaded.asyncify.mjs"]="5959c6733039619c9af710d8e1bae8d6e84402787990637be987c2b1bd6c5fa9"
    ["ort-wasm-simd-threaded.asyncify.wasm"]="e0c0c6d3e73d43b8a249972f8358f845b08cc16fec3c80efafdf8bed40366786"
)

verify() {
    echo "${SHA256[$1]}  $2" | sha256sum -c >/dev/null 2>&1
}

for f in "${!SHA256[@]}"; do
    if [ -f "$OUT_DIR/$f" ] && verify "$f" "$OUT_DIR/$f"; then
        echo "  verified $f"
        continue
    fi
    echo "  fetching $f..."
    curl -fsSL "$ORT_BASE/$f" -o "$OUT_DIR/$f.tmp"
    if ! verify "$f" "$OUT_DIR/$f.tmp"; then
        rm -f "$OUT_DIR/$f.tmp"
        echo "checksum mismatch for $f" >&2
        exit 1
    fi
    mv "$OUT_DIR/$f.tmp" "$OUT_DIR/$f"
done

echo "onnxruntime-web WASM runtime ready in $OUT_DIR"
