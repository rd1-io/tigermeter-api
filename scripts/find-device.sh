#!/usr/bin/env bash
#
# Find a TigerMeter (ESP32) device on the local network.
# Prints the device IP/host on success (exit 0), or exits 1 if not found.
#
# Usage:
#   DEVICE_HOST=192.168.1.42 bash scripts/find-device.sh   # use explicit host
#   bash scripts/find-device.sh                              # auto-discover

set -euo pipefail

# If DEVICE_HOST is provided, validate it's reachable and print it
if [ -n "${DEVICE_HOST:-}" ]; then
    if curl -s -m 3 -o /dev/null "http://${DEVICE_HOST}/"; then
        echo "$DEVICE_HOST"
        exit 0
    fi
    echo "DEVICE_HOST=${DEVICE_HOST} is not reachable" >&2
    exit 1
fi

CANDIDATES=()

# 1) Try mDNS service browsing (macOS dns-sd) for tigermeter-* devices
if command -v dns-sd >/dev/null 2>&1; then
    while IFS= read -r name; do
        [ -z "$name" ] && continue
        CANDIDATES+=("${name}.local")
    done < <(
        timeout 2 dns-sd -B _http._tcp . 2>/dev/null \
            | grep -oi 'tigermeter-[0-9a-f]*' \
            | head -5 \
            || true
    )
fi

# 2) Collect all local IPs from ARP cache (skip incomplete/expired entries)
while IFS= read -r line; do
    ip=$(echo "$line" | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)
    [ -z "$ip" ] && continue
    case "$ip" in
        *.255|*.0|224.*|239.*) continue ;;
    esac
    CANDIDATES+=("$ip")
done < <(arp -a 2>/dev/null | grep -v 'incomplete')

if [ ${#CANDIDATES[@]} -eq 0 ]; then
    echo "No candidates found on local network" >&2
    exit 1
fi

# Probe all candidates in parallel; first TigerMeter response wins
TMPDIR_PROBE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_PROBE"' EXIT

for host in "${CANDIDATES[@]}"; do
    (
        body=$(curl -s -m 2 "http://${host}/" 2>/dev/null || true)
        if echo "$body" | grep -qi "TigerMeter"; then
            echo "$host" > "$TMPDIR_PROBE/found"
        fi
    ) &
done
wait

if [ -f "$TMPDIR_PROBE/found" ]; then
    head -1 "$TMPDIR_PROBE/found"
    exit 0
fi

echo "No TigerMeter device found among ${#CANDIDATES[@]} candidates" >&2
exit 1
