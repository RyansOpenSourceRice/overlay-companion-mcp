#!/usr/bin/env bash

set -euo pipefail

# Config
NETWORK_NAME="overlay-smoke-net"
VOLS=(kasmvnc_data kasmvnc_profiles)
IMAGES=( \
  "lscr.io/linuxserver/kasm:latest" \
  "ghcr.io/ryansopensaucerice/overlay-companion-mcp/mcp-server:2025.09.12.2" \
  "ghcr.io/ryansopensaucerice/overlay-companion-mcp/web-interface:2025.09.12.2" \
  "docker.io/library/caddy:2.8.4" \
)


# Pull required images
pull_images() {
  echo "Pulling images..."
  for img in "${IMAGES[@]}"; do
    echo "  docker pull $img"
    docker pull "$img" || echo "Warning: docker pull failed for $img"
  done
}

# Create network and volumes
prepare_env() {
  echo "Creating network $NETWORK_NAME (if missing) and volumes..."
  docker network create "$NETWORK_NAME" >/dev/null 2>&1 || true
  for v in "${VOLS[@]}"; do
    docker volume create "$v" >/dev/null 2>&1 || true
  done
}

# Start containers (detached)
start_containers() {
  prepare_env
  echo "Starting containers on network: $NETWORK_NAME"

  # Start kasmvnc
  docker run -d \
    --name "$CN_KASM" \
    --network "$NETWORK_NAME" \
    --privileged \
    -e PUID=1000 -e PGID=1000 -e TZ=Etc/UTC -e KASM_PORT=443 -e DOCKER_MTU=1500 \
    -v kasmvnc_data:/opt -v kasmvnc_profiles:/profiles -v /dev/input:/dev/input:ro -v /run/udev/data:/run/udev/data:ro \
    -p ${PORT_KASM}:6901 -p ${PORT_KASM_ADMIN}:3000 \
    --restart unless-stopped \
    "${IMAGES[0]}"

  # Start mcp server
  docker run -d \
    --name "$CN_MCP" \
    --network "$NETWORK_NAME" \
    -e ASPNETCORE_URLS=http://0.0.0.0:3000 -e KASMVNC_URL=http://$CN_KASM:6901 \
    -p ${PORT_MCP}:3000 \
    --restart unless-stopped \
    "${IMAGES[1]}"

  # Start web interface
  docker run -d \
    --name "$CN_WEB" \
    --network "$NETWORK_NAME" \
    -e PORT=8080 -e MCP_SERVER_URL=http://$CN_MCP:3000 -e KASMVNC_URL=http://$CN_KASM:6901 \
    -p ${PORT_WEB}:8080 \
    --restart unless-stopped \
    "${IMAGES[2]}"

  # Start caddy (optional: requires local Caddyfile.kasmvnc present if you want custom config)
  if [ -f ./Caddyfile.kasmvnc ]; then
    docker run -d \
      --name "$CN_CADDY" \
      --network "$NETWORK_NAME" \
      -p ${PORT_CADDY}:80 \
      -v "$(pwd)/Caddyfile.kasmvnc":/etc/caddy/Caddyfile:ro \
      --restart unless-stopped \
      "${IMAGES[3]}"
  else
    echo "Note: ./Caddyfile.kasmvnc not found; skipping caddy container (you can add it later)."
  fi

  echo "Containers started. Give services a few seconds to warm up."
}

# Quick tests
test_endpoints() {
  echo "Testing endpoints (HTTP HEAD). Copy any errors printed below."
  echo "MCP server: http://localhost:${PORT_MCP}/"
  curl -I --max-time 5 "http://localhost:${PORT_MCP}/" || true
  echo
  echo "Web UI: http://localhost:${PORT_WEB}/"
  curl -I --max-time 5 "http://localhost:${PORT_WEB}/" || true
  echo
  echo "KasmVNC UI (web): http://localhost:${PORT_KASM}/"
  curl -I --max-time 5 "http://localhost:${PORT_KASM}/" || true
}

# Collect logs into infra/logs/
collect_logs() {
  mkdir -p infra/logs
  for c in "$CN_MCP" "$CN_WEB" "$CN_KASM" "$CN_CADDY"; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${c}$"; then
      echo "Collecting logs for $c -> infra/logs/${c}.log"
      docker logs "$c" > "infra/logs/${c}.log" 2>&1 || true
    fi
  done
  echo "Logs saved to infra/logs/"
}

# Clear the data inside named volumes but do NOT remove the container objects
clear_data_keep_containers() {
  echo "Clearing data from named volumes: ${VOLS[*]} (keeps containers)"
  for v in "${VOLS[@]}"; do
    echo "Clearing volume: $v"
    # Use a short-lived container to mount and remove files from the volume.
    docker run --rm -v "${v}:/data" busybox sh -c 'rm -rf /data/* || true; sync'
  done
  echo "Volume data cleared. Note: containers still exist but may have lost state."
}

# Stop containers (keeps container objects)
stop_containers() {
  for c in "$CN_CADDY" "$CN_WEB" "$CN_MCP" "$CN_KASM"; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${c}$"; then
      echo "Stopping $c"
      docker stop "$c" || true
    fi
  done
}

# Remove containers completely
remove_containers() {
  for c in "$CN_CADDY" "$CN_WEB" "$CN_MCP" "$CN_KASM"; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${c}$"; then
      echo "Removing $c"
      docker rm "$c" || true
    fi
  done
}

# Helper: show status
status() {
  docker ps -a --filter "name=overlay-companion-" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
  echo
  docker volume ls --filter name=kasmvnc -q || true
}

# Interactive loop to run -> test -> collect logs -> clear data -> repeat
run_loop() {
  echo "Starting interactive run loop. Press Ctrl-C to exit at any time."
  while true; do
    echo "\n=== Pulling images and starting containers ==="
    pull_images
    start_containers

    echo "Waiting 8s for services to warm up..."
    sleep 8

    echo "\n=== Run quick tests (inspect and copy errors) ==="
    test_endpoints

    echo "\nWhen you've finished manual testing, press ENTER to collect logs."
    read -r
    collect_logs

    echo "\nPress ENTER to clear persistent data (keeps container objects)."
    read -r
    stop_containers
    clear_data_keep_containers

    echo "Data cleared. If you want to repeat, press ENTER. To quit, type 'q' then ENTER."
    read -r -p ">> " ans
    if [ "${ans}" = "q" ]; then
      echo "Exiting loop."
      break
    fi
    echo "Repeating test iteration..."
  done
}

case "${1:-}" in
  start)
    pull_images
    start_containers
    ;;
  test)
    test_endpoints
    ;;
  collect-logs)
    collect_logs
    ;;
  clear-data)
    stop_containers
    clear_data_keep_containers
    ;;
  stop)
    stop_containers
    ;;
  remove)
    stop_containers
    remove_containers
    ;;
  status)
    status
    ;;
  run-loop)
    run_loop
    ;;
  *)
    cat <<EOF
Usage: $0 <command>
Commands:
  start         Pull images and start containers (detached)
  test          Run quick HTTP HEAD tests against services
  collect-logs  Save container logs to infra/logs/
  clear-data    Clear named volume data (keeps container objects)
  stop          Stop containers (keeps container objects)
  remove        Remove container objects entirely
  status        Show container + volume status
  run-loop      Interactive sequence: start -> test -> collect -> clear -> repeat
EOF
    exit 1
    ;;
esac
