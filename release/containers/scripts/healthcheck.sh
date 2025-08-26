#!/bin/bash
set -euo pipefail

# Health check script for Overlay Companion MCP Management Container
# This script is used by Docker/Podman health checks

# Configuration
HEALTH_URL="http://localhost:8080/health"
TIMEOUT=10
MAX_RETRIES=3

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[HEALTH]${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[HEALTH]${NC} $1" >&2
}

error() {
    echo -e "${RED}[HEALTH]${NC} $1" >&2
}

# Check if curl is available
if ! command -v curl >/dev/null 2>&1; then
    error "curl is not available"
    exit 1
fi

# Perform health check with retries
for attempt in $(seq 1 $MAX_RETRIES); do
    log "Health check attempt $attempt/$MAX_RETRIES"
    
    # Make HTTP request to health endpoint
    if response=$(curl -fsSL --connect-timeout $TIMEOUT --max-time $TIMEOUT "$HEALTH_URL" 2>/dev/null); then
        # Parse JSON response
        if echo "$response" | jq -e '.status == "healthy"' >/dev/null 2>&1; then
            log "✅ Health check passed"
            
            # Extract and display key metrics
            uptime=$(echo "$response" | jq -r '.uptime // "unknown"')
            memory_used=$(echo "$response" | jq -r '.memory.heapUsed // 0' | awk '{print int($1/1024/1024)}')
            connected_clients=$(echo "$response" | jq -r '.services.connectedClients // 0')
            
            log "📊 Uptime: ${uptime}s, Memory: ${memory_used}MB, Clients: $connected_clients"
            exit 0
        else
            warn "Health endpoint returned unhealthy status"
            echo "$response" | jq '.' >&2 2>/dev/null || echo "$response" >&2
        fi
    else
        warn "Failed to connect to health endpoint (attempt $attempt/$MAX_RETRIES)"
    fi
    
    # Wait before retry (except on last attempt)
    if [ $attempt -lt $MAX_RETRIES ]; then
        sleep 2
    fi
done

error "❌ Health check failed after $MAX_RETRIES attempts"
exit 1