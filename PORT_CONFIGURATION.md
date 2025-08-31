# Port Configuration Guide

## Overview

The Overlay Companion MCP setup script now includes intelligent port management to handle port conflicts (like with OpenWebUI on port 8080).

## Usage Options

### 1. Default Installation
```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/host-setup.sh | bash
```
- Uses port 8080 by default
- If port 8080 is in use, offers interactive alternatives

### 2. Specify Custom Port
```bash
# Method 1: Command line argument (recommended)
./host-setup.sh 8081

# Method 2: Explicit flag
./host-setup.sh --port 8081

# Method 3: Environment variable
OVERLAY_COMPANION_PORT=8081 ./host-setup.sh

# Method 4: Get help
./host-setup.sh --help
```

### 3. Interactive Port Selection
If the default port (8080) is in use, the script will:
1. **Detect the conflict** and show what's using the port
2. **Offer options**:
   - Auto-select next available port (8081, 8082, etc.)
   - Specify custom port interactively
   - Exit to resolve conflict manually

### 4. Help and Usage Information
```bash
# Get detailed help and usage examples
./host-setup.sh --help

# Shows all available options and examples
```

## Port Conflict Detection

The script automatically detects port conflicts using:
```bash
ss -tuln | grep ":PORT "
```

When a conflict is detected, it shows:
- Which processes are using the port
- Clear options for resolution
- Automatic port selection capabilities

## Configuration Changes

The script automatically updates:
- `podman-compose.yml` port mappings
- Container environment variables
- Service URLs in completion message
- Health check endpoints

## Examples

### OpenWebUI Conflict (Port 8080)
```bash
# OpenWebUI is using port 8080
OVERLAY_COMPANION_PORT=8081 ./host-setup.sh
```

### Multiple Services
```bash
# If you have multiple services, use different ports
OVERLAY_COMPANION_PORT=8082 ./host-setup.sh
```

### Auto-Selection
```bash
# Let the script find the next available port
./host-setup.sh
# Script detects 8080 is in use
# Choose option 1 to auto-select 8081
```

## After Installation

Your services will be available at:
- **Web Interface**: `http://localhost:YOUR_PORT`
- **MCP Server**: `http://localhost:YOUR_PORT/mcp`
- **Management API**: `http://localhost:YOUR_PORT/api`

## Troubleshooting

### Check What's Using a Port
```bash
ss -tulnp | grep ":8080"
lsof -i :8080
```

### Change Port After Installation
1. Stop services: `cd ~/.config/overlay-companion-mcp && podman-compose down`
2. Edit `podman-compose.yml` port mapping
3. Restart: `podman-compose up -d`

### Verify Port is Free
```bash
# Check if port is available
ss -tuln | grep ":8081" || echo "Port 8081 is available"
```

## Security Notes

- Ports below 1024 require root privileges (not recommended)
- Use ports 1024-65535 for user applications
- The script validates port ranges automatically
- Internal container ports remain unchanged (8080 internally)