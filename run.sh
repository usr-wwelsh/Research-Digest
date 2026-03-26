#!/bin/bash
# Research Digest - Weekly pipeline runner
# Fetches papers, generates HTML digests, and updates the archive index.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
LOG_FILE="$SCRIPT_DIR/logs/digest_$(date +%Y%m%d_%H%M%S).log"

mkdir -p "$SCRIPT_DIR/logs"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "=== Research Digest pipeline starting ==="

# Activate venv
if [ ! -d "$VENV_DIR" ]; then
    log "ERROR: Virtual environment not found at $VENV_DIR"
    log "Run setup.sh first or create it manually: python3 -m venv $VENV_DIR"
    exit 1
fi
source "$VENV_DIR/bin/activate"

cd "$SCRIPT_DIR"

# Fetch papers and generate digest
log "Fetching papers and generating digest..."
if python main.py >> "$LOG_FILE" 2>&1; then
    log "Digest generated successfully."
else
    log "ERROR: main.py failed (exit code $?)"
    exit 1
fi

# Generate archive index
log "Generating archive index..."
if python generate_index.py >> "$LOG_FILE" 2>&1; then
    log "Index generated successfully."
else
    log "ERROR: generate_index.py failed (exit code $?)"
    exit 1
fi

# Clean up old logs (keep last 12 weeks)
find "$SCRIPT_DIR/logs" -name "digest_*.log" -mtime +84 -delete 2>/dev/null || true

log "=== Pipeline complete ==="
