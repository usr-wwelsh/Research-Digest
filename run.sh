#!/bin/bash
# Research Digest v2 — pipeline runner.
#
# Stages are independent; only fetch touches arXiv, and its failure is non-fatal
# (a rate limit just means no new papers — the corpus and seed file stay intact).
# export_seed is the gate: it refuses to overwrite seed-corpus.json with an
# empty export. The PWA fetches for itself client-side after that; this
# pipeline only needs to keep seed-corpus.json non-empty for a fresh install.
#
#   ./run.sh            full pipeline: fetch -> summarize -> embed -> relate -> export_seed
#   ./run.sh --offline  skip fetch (rebuild from the existing corpus; no network)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$SCRIPT_DIR/venv/bin/python"
LOG_FILE="$SCRIPT_DIR/logs/digest_$(date +%Y%m%d_%H%M%S).log"
mkdir -p "$SCRIPT_DIR/logs"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG_FILE"; }
run() { log "→ $1"; if "$PY" "$1" >>"$LOG_FILE" 2>&1; then log "  ok"; else log "  FAILED: $1"; return 1; fi; }

[ -x "$PY" ] || { log "ERROR: venv missing at $SCRIPT_DIR/venv — run setup.sh"; exit 1; }
cd "$SCRIPT_DIR"

# Per-deployment env, gitignored.
[ -f "$SCRIPT_DIR/.env" ] && { set -a; . "$SCRIPT_DIR/.env"; set +a; }

# HuggingFace model cache — www-data can't write to its own home under /var/www.
export HF_HOME="$SCRIPT_DIR/.hf_cache"
mkdir -p "$HF_HOME"

log "=== Research Digest pipeline ==="

if [ "${1:-}" = "--offline" ]; then
    log "offline mode: skipping fetch"
else
    run fetch.py || log "fetch failed — continuing with existing corpus"
fi

run summarize.py || true   # local model stages skip gracefully if a model is unavailable
run embed.py || true
run relate.py || true

if run export_seed.py; then
    log "=== pipeline complete ==="
else
    log "=== export_seed refused (empty corpus?) — seed-corpus.json left unchanged ==="
    exit 1
fi

find "$SCRIPT_DIR/logs" -name "digest_*.log" -mtime +84 -delete 2>/dev/null || true
