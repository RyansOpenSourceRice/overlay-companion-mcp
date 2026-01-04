[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io) [![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

# Overlay Companion MCP - Clipboard Bridge

A Flatpak application that provides clipboard synchronization between the host system and VM, enabling seamless clipboard access for AI-assisted screen interaction.

Note: As of this change, the bridge is implemented in Rust and packaged directly in the Flatpak (no Python runtime required).

## Overview

The Clipboard Bridge runs as a Flatpak service inside the VM and exposes a REST API that the host MCP server can use to read and write the VM's clipboard. This enables true clipboard synchronization across the VM boundary.

## Architecture

```
Host MCP Server → HTTP API → VM Flatpak Clipboard Bridge → VM Clipboard
                                      ↓
Host MCP Server ← JSON Response ← VM Flatpak Clipboard Bridge ← VM Clipboard
```

## Features

- **Multi-backend Support**: Automatically detects and uses the best available clipboard backend:
  - Wayland (`wl-copy`/`wl-paste`)
  - X11 (`xclip`, `xsel`)
  - GTK (fallback)
- **REST API**: Simple HTTP API for clipboard operations
- **Security**: API key authentication and CORS support
- **Auto-start**: Systemd user service for automatic startup
- **Health Monitoring**: Health check endpoint for service monitoring

## Installation

### Automatic Installation (Recommended)

Use the provided installation script:

```bash
# Run inside the VM
./scripts/vm-setup/install-clipboard-bridge.sh
```

### Manual Installation

1. **Install Dependencies**:
   ```bash
   sudo dnf install -y flatpak flatpak-builder wl-clipboard xclip xsel
   flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
   flatpak install -y flathub org.freedesktop.Platform//23.08 org.freedesktop.Sdk//23.08
   ```

2. **Build and Install**:
   ```bash
   cd flatpak/clipboard-bridge
   ./build.sh
   ```

3. **Configure Auto-start**:
   ```bash
   # Create systemd user service
   mkdir -p ~/.config/systemd/user
   cp clipboard-bridge.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable clipboard-bridge.service
   systemctl --user start clipboard-bridge.service
   ```

## API Reference

### Base URL
```
http://localhost:8765
```

### Authentication
All API endpoints (except `/health` and `/`) require an API key:  # pragma: allowlist secret
```
X-API-Key: overlay-companion-mcp
```

### Endpoints

#### GET `/health`  # pragma: allowlist secret
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00Z",
  "backend": "wayland"
}
```

#### GET `/clipboard`
Get current clipboard content.

**Response:**
```json
{
  "success": true,
  "content": "clipboard text content",
  "content_type": "text/plain",
  "timestamp": "2024-01-01T12:00:00Z",
  "message": "Clipboard content retrieved successfully"
}
```

#### POST `/clipboard`
Set clipboard content.

**Request:**
```json
{
  "content": "text to set in clipboard",
  "content_type": "text/plain"
}
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2024-01-01T12:00:00Z",
  "message": "Clipboard content set successfully"
}
```

#### DELETE `/clipboard`
Clear clipboard content.

**Response:**
```json
{
  "success": true,
  "timestamp": "2024-01-01T12:00:00Z",
  "message": "Clipboard cleared successfully"
}
```

## Configuration

### Environment Variables

- `CLIPBOARD_BRIDGE_HOST`: Host to bind to (default: `0.0.0.0`)
- `CLIPBOARD_BRIDGE_PORT`: Port to listen on (default: `8765`)
- `CLIPBOARD_BRIDGE_API_KEY`: API key for authentication (default: `overlay-companion-mcp`)

### Host MCP Server Configuration

#### Web Interface Configuration (Recommended)

Configure the clipboard bridge through the MCP server's web interface:

1. Open `http://localhost:3000/setup` in your browser
2. Scroll to the "VM Clipboard Bridge Settings" section
3. Enable the clipboard bridge and configure:
   - **Base URL**: VM clipboard bridge service URL (e.g., `http://vm-ip-address:8765`)
   - **API Key**: Authentication key (default: `overlay-companion-mcp`)
   - **Timeout**: Connection timeout in seconds (default: 5)
   - **Fallback**: Enable automatic fallback to local clipboard (recommended: enabled)
4. Click "Test Connection" to verify the bridge is working
5. Click "Save Settings" to persist the configuration

#### Manual Configuration (Advanced)

The settings are stored in `~/.overlay-companion/settings.json` and can be edited manually:

```json
{
  "clipboard_bridge": {
    "enabled": true,
    "baseUrl": "http://vm-ip-address:8765",
    "apiKey": "overlay-companion-mcp",  # pragma: allowlist secret
    "timeoutSeconds": 5,
    "fallbackToLocal": true,
    "description": "VM clipboard bridge for cross-system clipboard synchronization"
  }
}
```

## Usage Examples

### Command Line Testing

```bash
# Health check
curl -H "X-API-Key: overlay-companion-mcp" http://localhost:8765/health  # pragma: allowlist secret

# Get clipboard content
curl -H "X-API-Key: overlay-companion-mcp" http://localhost:8765/clipboard  # pragma: allowlist secret

# Set clipboard content
curl -X POST -H "X-API-Key: overlay-companion-mcp" -H "Content-Type: application/json" \
     -d '{"content":"Hello from API!"}' http://localhost:8765/clipboard

# Clear clipboard
curl -X DELETE -H "X-API-Key: overlay-companion-mcp" http://localhost:8765/clipboard
```

### MCP Tool Integration

The host MCP server automatically uses the clipboard bridge when available:

```python
# AI can now read VM clipboard
result = await mcp_client.call_tool("get_clipboard")
print(result["text"])  # Content from VM clipboard

# AI can set VM clipboard
await mcp_client.call_tool("set_clipboard", {"text": "Hello VM!"})
```

## Troubleshooting

### Service Not Starting

Check service status:
```bash
systemctl --user status clipboard-bridge.service
journalctl --user -u clipboard-bridge.service -f
```

### Clipboard Backend Issues

The service automatically detects the best backend. Check logs for backend selection:
```bash
journalctl --user -u clipboard-bridge.service | grep backend
```

### Network Connectivity

Ensure the VM allows connections on port 8765:
```bash
# Check if service is listening
ss -tlnp | grep 8765

# Test from host
curl -H "X-API-Key: overlay-companion-mcp" http://vm-ip:8765/health  # pragma: allowlist secret
```

### Firewall Configuration

Configure firewall to allow clipboard bridge access:
```bash
sudo firewall-cmd --permanent --add-port=8765/tcp
sudo firewall-cmd --reload
```

## Security Considerations

- **API Key**: Change the default API key in production
- **Network Access**: The service binds to `0.0.0.0` by default for VM access
- **Firewall**: Configure firewall rules to restrict access as needed
- **Flatpak Sandbox**: The service runs in a Flatpak sandbox with minimal permissions

## Development

### Building from Source

```bash
cd flatpak/clipboard-bridge
flatpak-builder --force-clean --repo=repo build org.overlaycompanion.ClipboardBridge.yml
flatpak install --user repo org.overlaycompanion.ClipboardBridge
```

### Testing

```bash
# Run directly for testing
flatpak run org.overlaycompanion.ClipboardBridge

# Test API endpoints
python3 -c "
import requests
headers = {'X-API-Key': 'overlay-companion-mcp'}
print(requests.get('http://localhost:8765/health', headers=headers).json())  # pragma: allowlist secret
"
```

## Integration with Overlay Companion MCP

The clipboard bridge integrates seamlessly with the main Overlay Companion MCP system:

1. **Automatic Detection**: The MCP server automatically detects when the clipboard bridge is available
2. **Fallback Support**: Falls back to local clipboard access if the bridge is unavailable
3. **Source Tracking**: API responses indicate whether clipboard operations used the VM bridge or local system
4. **Health Monitoring**: The main system can monitor clipboard bridge health

This enables AI assistants to seamlessly interact with clipboard content in the VM environment, providing a complete screen interaction experience.
