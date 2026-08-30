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

FILES=(
    "ort-wasm-simd-threaded.mjs"
    "ort-wasm-simd-threaded.wasm"
    "ort-wasm-simd-threaded.asyncify.mjs"
    "ort-wasm-simd-threaded.asyncify.wasm"
)

for f in "${FILES[@]}"; do
    if [ -f "$OUT_DIR/$f" ]; then
        echo "  already have $f"
        continue
    fi
    echo "  fetching $f..."
    curl -fsSL "$ORT_BASE/$f" -o "$OUT_DIR/$f.tmp"
    mv "$OUT_DIR/$f.tmp" "$OUT_DIR/$f"
done

echo "onnxruntime-web WASM runtime ready in $OUT_DIR"
