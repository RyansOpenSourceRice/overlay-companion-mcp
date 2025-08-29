#!/bin/bash
set -e

echo "Starting KasmVNC for Overlay Companion..."

# Set up display environment
export DISPLAY=:1
export KASM_VNC=true

# Configure multi-monitor support
if [ "${KASM_VNC_MULTI_MONITOR}" = "true" ]; then
    echo "Enabling multi-monitor support..."
    export KASM_MULTI_MONITOR=true
fi

# Set resolution
RESOLUTION=${KASM_VNC_RESOLUTION:-1920x1080}
DEPTH=${KASM_VNC_DEPTH:-24}

echo "Starting KasmVNC with resolution: ${RESOLUTION}, depth: ${DEPTH}"

# Start KasmVNC server
exec /usr/bin/kasmvnc \
    -geometry ${RESOLUTION} \
    -depth ${DEPTH} \
    -websocket 6901 \
    -httpd /usr/share/kasmvnc/www \
    -config /etc/kasmvnc/kasmvnc.yaml \
    -log /var/log/kasmvnc.log \
    :1