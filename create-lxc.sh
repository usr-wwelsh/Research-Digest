#!/bin/bash
# Research Digest - Proxmox LXC Creator
# Run this on the Proxmox host to create and bootstrap the container.
#
# Usage: bash create-lxc.sh [CTID]
#   CTID defaults to the next available ID.

set -euo pipefail

# --- Configuration (tweak these) ---
CTID="${1:-}"
HOSTNAME="research-digest"
STORAGE="local-lvm"          # Change to your storage (local-lvm, zfs, etc.)
TEMPLATE="debian-12-standard" # Will auto-find the latest matching template
MEMORY=4096                   # MB - peak during torch inference
SWAP=512
CORES=4
DISK_SIZE="8"                 # GB
BRIDGE="vmbr0"
REPO_URL="https://github.com/usr-wwelsh/research-digest.git"
NAMESERVER=""                 # Leave empty for DHCP default, or set e.g. "1.1.1.1"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; exit 1; }

# --- Pre-checks ---
command -v pct &> /dev/null || err "This script must be run on a Proxmox host (pct not found)"
[ "$(id -u)" -eq 0 ] || err "Run as root"

# --- Find next available CTID ---
if [ -z "$CTID" ]; then
    CTID=$(pvesh get /cluster/nextid)
    log "Using next available CTID: $CTID"
fi

# Check CTID isn't already in use
if pct status "$CTID" &> /dev/null; then
    err "CTID $CTID already exists. Pick a different one or pass it as an argument."
fi

# --- Find template ---
log "Looking for Debian 12 template..."
TEMPLATE_PATH=$(pveam list "$STORAGE" 2>/dev/null | grep -i "$TEMPLATE" | tail -1 | awk '{print $1}' || true)

if [ -z "$TEMPLATE_PATH" ]; then
    log "Template not found in storage, downloading..."
    pveam update
    TEMPLATE_DL=$(pveam available --section system | grep -i "$TEMPLATE" | tail -1 | awk '{print $2}')
    [ -z "$TEMPLATE_DL" ] && err "Could not find a Debian 12 template to download"
    pveam download "$STORAGE" "$TEMPLATE_DL"
    TEMPLATE_PATH=$(pveam list "$STORAGE" | grep -i "$TEMPLATE" | tail -1 | awk '{print $1}')
fi

log "Using template: $TEMPLATE_PATH"

# --- Create container ---
log "Creating LXC container $CTID ($HOSTNAME)..."

CREATE_ARGS=(
    "$CTID"
    "$TEMPLATE_PATH"
    --hostname "$HOSTNAME"
    --memory "$MEMORY"
    --swap "$SWAP"
    --cores "$CORES"
    --rootfs "$STORAGE:$DISK_SIZE"
    --net0 "name=eth0,bridge=$BRIDGE,ip=dhcp"
    --unprivileged 1
    --features "nesting=1"
    --onboot 1
    --start 0
)

[ -n "$NAMESERVER" ] && CREATE_ARGS+=(--nameserver "$NAMESERVER")

pct create "${CREATE_ARGS[@]}"

log "Container $CTID created."

# --- Start container ---
log "Starting container..."
pct start "$CTID"

# Wait for container to be ready
log "Waiting for container to boot..."
for i in $(seq 1 30); do
    if pct exec "$CTID" -- true 2>/dev/null; then
        break
    fi
    [ "$i" -eq 30 ] && err "Container failed to start within 30 seconds"
    sleep 1
done

# Wait for network
log "Waiting for network..."
for i in $(seq 1 30); do
    if pct exec "$CTID" -- ping -c1 -W2 1.1.1.1 &>/dev/null; then
        break
    fi
    [ "$i" -eq 30 ] && err "Container has no network after 30 seconds. Check bridge/DHCP config."
    sleep 1
done

# --- Bootstrap inside container ---
log "Installing git..."
pct exec "$CTID" -- bash -c "apt-get update -qq && apt-get install -y -qq git > /dev/null"

log "Cloning repository..."
pct exec "$CTID" -- git clone "$REPO_URL" /opt/research-digest

log "Running setup.sh inside container..."
pct exec "$CTID" -- bash /opt/research-digest/setup.sh

# --- Print summary ---
CT_IP=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Container $CTID is ready!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "  Hostname:  $HOSTNAME"
echo "  CTID:      $CTID"
echo "  IP:        ${CT_IP:-unknown (check DHCP)}"
echo "  Caddy:     http://${CT_IP:-<IP>}:8080"
echo ""
echo "  To enter the container:"
echo "    pct enter $CTID"
echo ""
echo "  Next steps inside the container:"
echo "    1. Edit /opt/research-digest/config.json"
echo "    2. Test run: sudo -u www-data /opt/research-digest/run.sh"
echo "    3. Set up Cloudflare tunnel:"
echo "       cloudflared tunnel login"
echo "       cloudflared tunnel create research-digest"
echo "       cloudflared tunnel route dns research-digest YOUR_SUBDOMAIN.yourdomain.com"
echo "       # Then create /etc/cloudflared/config.yml (see setup.sh output)"
echo "       cloudflared service install"
echo "       systemctl enable --now cloudflared"
echo ""
