#!/usr/bin/env bash

# local_smoke_test.sh
# Lightweight smoke-test runner that:
#  - pulls required images
#  - runs containers with explicit docker run commands on a user bridge network
#  - auto-selects free host ports when not provided (avoids port collisions)
#  - prints recent logs to stdout for easy copy/paste
#  - clears persistent named volumes while preserving container objects so tests can be repeated
#
# Usage:
#   chmod +x infra/local_smoke_test.sh
#   ./infra/local_smoke_test.sh start
#   ./infra/local_smoke_test.sh logs
#   ./infra/local_smoke_test.sh clear-data
#
# Notes:
#  - If docker pull returns "denied" for ghcr.io images, run:
#      echo "YOUR_GHCR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
#    The script will continue even if some pulls fail so you can capture logs.

# Load environment overrides from .env.smoke or .env in repository root (optional)
ENV_FILE=".env.smoke"
if [ -f "$ENV_FILE" ]; then
  echo "Loading environment from $ENV_FILE"
  # shellcheck disable=SC1090
  set +u; set -o allexport; source "$ENV_FILE"; set +o allexport; set -u
elif [ -f .env ]; then
  echo "Loading environment from .env"
  set +u; set -o allexport; source .env; set +o allexport; set -u
fi

set -euo pipefail

# Config
NETWORK_NAME="overlay-smoke-net"
VOLS=(kasmvnc_data kasmvnc_profiles)
IMAGES=(
  "lscr.io/linuxserver/kasm:latest"
  "ghcr.io/ryansopensaucerice/overlay-companion-mcp/mcp-server:2025.09.12.2"
  "ghcr.io/ryansopensaucerice/overlay-companion-mcp/web-interface:2025.09.12.2"
  "docker.io/library/caddy:2.8.4"
)

# Container names (stable)
CN_KASM="overlay-companion-kasmvnc"
CN_MCP="overlay-companion-mcp"
CN_WEB="overlay-companion-web"
CN_CADDY="overlay-companion-proxy"

# Helper: pick an available ephemeral port on the host
pick_free_port() {
  python3 - <<'PY'
import socket
s=socket.socket()
s.bind(('127.0.0.1',0))
port=s.getsockname()[1]
s.close()
print(port)
PY
}

# Ports mapped to host - honor environment variables when provided, otherwise auto-pick free ports
PORT_KASM=${KASMVNC_PORT:-}
PORT_KASM_ADMIN=${KASMVNC_ADMIN_PORT:-}
PORT_MCP=${MCP_PORT:-}
PORT_WEB=${WEB_PORT:-}
PORT_CADDY=${CONTAINER_PORT:-}

if [ -z "${PORT_KASM}" ]; then
  PORT_KASM=$(pick_free_port)
fi
if [ -z "${PORT_KASM_ADMIN}" ]; then
  PORT_KASM_ADMIN=$(pick_free_port)
fi
if [ -z "${PORT_MCP}" ]; then
  PORT_MCP=$(pick_free_port)
fi
if [ -z "${PORT_WEB}" ]; then
  PORT_WEB=$(pick_free_port)
fi
if [ -z "${PORT_CADDY}" ]; then
  PORT_CADDY=$(pick_free_port)
fi

echo "Selected host ports: KASMVNC=${PORT_KASM}, KASMVNC_ADMIN=${PORT_KASM_ADMIN}, MCP=${PORT_MCP}, WEB=${PORT_WEB}, CADDY=${PORT_CADDY}"

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
    "${IMAGES[0]}" || echo "Failed starting $CN_KASM"

  # Start mcp server
  docker run -d \
    --name "$CN_MCP" \
    --network "$NETWORK_NAME" \
    -e ASPNETCORE_URLS=http://0.0.0.0:3000 -e KASMVNC_URL=http://$CN_KASM:6901 \
    -p ${PORT_MCP}:3000 \
    --restart unless-stopped \
    "${IMAGES[1]}" || echo "Failed starting $CN_MCP"

  # Start web interface
  docker run -d \
    --name "$CN_WEB" \
    --network "$NETWORK_NAME" \
    -e PORT=8080 -e MCP_SERVER_URL=http://$CN_MCP:3000 -e KASMVNC_URL=http://$CN_KASM:6901 \
    -p ${PORT_WEB}:8080 \
    --restart unless-stopped \
    "${IMAGES[2]}" || echo "Failed starting $CN_WEB"

  # Start caddy (optional)
  if [ -f ./Caddyfile.kasmvnc ]; then
    docker run -d \
      --name "$CN_CADDY" \
      --network "$NETWORK_NAME" \
      -p ${PORT_CADDY}:80 \
      -v "$(pwd)/Caddyfile.kasmvnc":/etc/caddy/Caddyfile:ro \
      --restart unless-stopped \
      "${IMAGES[3]}" || echo "Failed starting $CN_CADDY"
  else
    echo "Note: ./Caddyfile.kasmvnc not found; skipping caddy container (you can add it later)."
  fi

  echo "Containers started (or attempted). Give services a few seconds to warm up."
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

# Print logs to stdout for easy copy/paste
print_logs() {
  for c in "$CN_MCP" "$CN_WEB" "$CN_KASM" "$CN_CADDY"; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${c}$"; then
      echo "\n===== LOGS: ${c} ====="
      docker logs --tail 400 "$c" 2>&1 || true
      echo "===== END LOGS: ${c} =====\n"
    fi
  done
}

# Clear the data inside named volumes but do NOT remove the container objects
clear_data_keep_containers() {
  echo "Clearing data from named volumes: ${VOLS[*]} (keeps containers)"
  for v in "${VOLS[@]}"; do
    echo "Clearing volume: $v"
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

# Interactive loop to run -> test -> print logs -> clear data -> repeat
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

    echo "\nWhen you've finished manual testing, press ENTER to print logs to the terminal (copy/paste the error blobs)."
    read -r
    print_logs

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
  logs)
    print_logs
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
  logs          Print recent container logs to stdout for copy/paste
  clear-data    Clear named volume data (keeps container objects)
  stop          Stop containers (keeps container objects)
  remove        Remove container objects entirely
  status        Show container + volume status
  run-loop      Interactive sequence: start -> test -> print logs -> clear -> repeat
EOF
    exit 1
    ;;
esac
