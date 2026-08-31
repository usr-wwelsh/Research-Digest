#!/bin/bash
# Research Digest - LXC Setup Script
# Run this inside a fresh Debian 12 / Ubuntu 22.04+ LXC container.
#
# Usage: sudo bash setup.sh
#
# What this does:
#   1. Installs Python 3, pip, venv
#   2. Installs Caddy web server
#   3. Installs cloudflared
#   4. Clones the repo and sets up the Python venv
#   5. Fetches the onnxruntime-web WASM runtime for the in-browser summarizer
#   6. Configures systemd services (Caddy + relay)
#   7. Sets up a weekly cron job (Monday 8am)

set -euo pipefail

INSTALL_DIR="/opt/research-digest"
REPO_URL="https://github.com/usr-wwelsh/research-digest.git"
CRON_SCHEDULE="0 8 * * 1"  # Every Monday at 8:00 AM

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; exit 1; }

# --- Pre-checks ---
[ "$(id -u)" -eq 0 ] || err "Run this script as root (sudo bash setup.sh)"

log "Updating package lists..."
apt-get update -qq

# --- 1. Python ---
log "Installing Python and build deps..."
apt-get install -y -qq python3 python3-pip python3-venv git curl > /dev/null

# --- 2. Caddy ---
if ! command -v caddy &> /dev/null; then
    log "Installing Caddy..."
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https > /dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
    apt-get update -qq
    apt-get install -y -qq caddy > /dev/null
else
    log "Caddy already installed."
fi

# Kill and mask the default Caddy service — it conflicts with our own unit
# (both try to bind the admin API on :2019)
systemctl stop caddy 2>/dev/null || true
systemctl disable caddy 2>/dev/null || true
systemctl mask caddy 2>/dev/null || true
pkill -9 caddy 2>/dev/null || true

# --- 3. Cloudflared ---
if ! command -v cloudflared &> /dev/null; then
    log "Installing cloudflared..."
    curl -1sLf -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
    dpkg -i /tmp/cloudflared.deb > /dev/null
    rm -f /tmp/cloudflared.deb
else
    log "cloudflared already installed."
fi

# --- 4. Clone repo and set up venv ---
if [ -d "$INSTALL_DIR/.git" ]; then
    log "Repo already exists at $INSTALL_DIR, pulling latest..."
    cd "$INSTALL_DIR" && git pull --ff-only
else
    log "Cloning repo to $INSTALL_DIR..."
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
mkdir -p logs

if [ ! -d "$INSTALL_DIR/venv" ]; then
    log "Creating Python virtual environment..."
    python3 -m venv "$INSTALL_DIR/venv"
fi

log "Installing Python dependencies (this pulls CPU-only torch + transformers, ~1GB)..."
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip -q
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt" -q

log "Pre-downloading summarizer/embedding model weights (~650MB, one-time)..."
export HF_HOME="$INSTALL_DIR/.hf_cache"
mkdir -p "$HF_HOME"
"$INSTALL_DIR/venv/bin/python" -c "import local_ai; local_ai.warm()"

# --- 5. onnxruntime-web WASM runtime (threaded backend for models.worker.js) ---
log "Fetching onnxruntime-web WASM runtime..."
bash "$INSTALL_DIR/scripts/fetch_vendor_assets.sh"

# --- 6. Set permissions ---
chown -R www-data:www-data "$INSTALL_DIR"

# --- 7. Caddy service ---
log "Setting up Caddy service..."
cp "$INSTALL_DIR/research-digest-caddy.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable research-digest-caddy.service
systemctl start research-digest-caddy.service

# --- 8. Relay service (stateless CORS relay for the client-side PWA) ---
log "Setting up relay service..."
cp "$INSTALL_DIR/research-digest-relay.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable research-digest-relay.service
systemctl start research-digest-relay.service

# --- 9. Cloudflare tunnel ---
warn "Cloudflare tunnel setup requires interactive login."
warn "After this script finishes, run:"
echo ""
echo "    cloudflared tunnel login"
echo "    cloudflared tunnel create research-digest"
echo "    cloudflared tunnel route dns research-digest YOUR_SUBDOMAIN.yourdomain.com"
echo ""
echo "Then create /etc/cloudflared/config.yml:"
echo ""
cat << 'CFEOF'
    tunnel: research-digest
    credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

    ingress:
      - hostname: YOUR_SUBDOMAIN.yourdomain.com
        service: http://localhost:8080
      - service: http_status:404
CFEOF
echo ""
echo "Then run:"
echo "    cloudflared service install"
echo "    systemctl enable cloudflared"
echo "    systemctl start cloudflared"
echo ""

# --- 10. Cron job ---
log "Setting up weekly cron job ($CRON_SCHEDULE)..."
# Run run.sh directly as www-data. No systemd-run wrapper: a non-root user can't
# create a transient scope from cron (it needs interactive polkit auth), which
# silently broke the job every week. The LXC already caps CPU/RAM at the container level.
printf 'SHELL=/bin/bash\n%s www-data %s/run.sh\n' "$CRON_SCHEDULE" "$INSTALL_DIR" > /etc/cron.d/research-digest
chmod 644 /etc/cron.d/research-digest

log "=== Setup complete! ==="
echo ""
echo "  Caddy is serving on :8080"
echo "  Relay is serving on 127.0.0.1:8082 (proxied via Caddy at /relay/*)"
echo "  Weekly digest runs: Monday 8:00 AM"
echo "  Logs: $INSTALL_DIR/logs/"
echo ""
echo "  Next steps:"
echo "    1. Edit $INSTALL_DIR/config.json with your research interests"
echo "    2. (optional) Recover an existing backlog from old digests:"
echo "         sudo -u www-data $INSTALL_DIR/venv/bin/python $INSTALL_DIR/migrate_from_html.py"
echo "    3. First build: sudo -u www-data $INSTALL_DIR/run.sh"
echo "    4. Set up the Cloudflare tunnel (see instructions above)"
echo ""
