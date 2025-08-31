# Overlay Companion MCP

AI-powered screen overlay system with Model Context Protocol (MCP) integration. Provides intelligent screen interaction capabilities through simplified containerized infrastructure using KasmVNC.

> Note: This project uses the KasmVNC-based architecture. See [DEPRECATION_NOTICE.md](DEPRECATION_NOTICE.md) for migration details.

## Architecture

**Host OS (Fedora Linux)**: Runs 4 podman containers (simplified from 6)
- **MCP Server Container**: C# overlay functionality for AI screen interaction
- **Management Web Container**: Node.js web interface for system management
- **KasmVNC Container**: Web-native VNC server with multi-monitor support
- **Caddy Proxy Container**: Unified access point for all services

**Separate VM (Optional)**: Target for KasmVNC connections
- Runs KasmVNC server for remote desktop access
- Web-native interface, no legacy VNC client needed
- True multi-monitor support with separate browser windows

**Connection Flow**: Host containers → KasmVNC → Remote Desktop

## Key Improvements over Guacamole

✅ **No Database Required**: Eliminates PostgreSQL complexity and credential management  
✅ **True Multi-Monitor Support**: KasmVNC provides native multi-monitor with separate windows  
✅ **Fewer Containers**: 4 containers instead of 6 (33% reduction)  
✅ **Simpler Configuration**: YAML-based config instead of database schemas  
✅ **Modern Web-Native**: Built for browsers from the ground up  
✅ **Better Performance**: WebSocket/WebRTC protocols instead of legacy VNC

## Installation

### Option A: KasmVNC Setup (Recommended - Simplified)

Use the new KasmVNC-based setup for better multi-monitor support and simpler configuration:
```bash
# Quick start with KasmVNC (no database required)
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/host-setup-kasmvnc.sh | bash
```

**Benefits**: No database, true multi-monitor support, 4 containers instead of 6, simpler maintenance.

Run this on your main Fedora Linux system:

**KasmVNC installation (recommended):**
```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/host-setup-kasmvnc.sh | bash
```

**Custom port installation:**
```bash
# Method 1: Download and run with port argument (recommended)
wget https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/host-setup.sh
chmod +x host-setup.sh
./host-setup.sh 8081

# Method 2: Use environment variable
OVERLAY_COMPANION_PORT=8081 ./host-setup.sh

# Method 3: Explicit port flag
./host-setup.sh --port 8081

# Method 4: Get help
./host-setup.sh --help
```

**Interactive port selection:**
If port 8080 is in use, the script will automatically detect this and offer options:
- Auto-select next available port
- Specify custom port interactively
- Exit to resolve port conflict manually

**What gets installed on HOST (KasmVNC):**
- MCP server container (C# overlay functionality)
- Management web interface container (Node.js)
- KasmVNC container (web-native VNC with multi-monitor support)
- Caddy proxy container (unified access point)
- **No Database**: Eliminates PostgreSQL complexity
- **Ports**: All service ports configurable with automatic conflict resolution


### Step 2: Create a VM or Remote System (Optional)
For remote desktop access, create a VM or use an existing system:
- **Proxmox**: Create new VM with Fedora template
- **VirtualBox**: Create new Fedora VM
- **VMware**: Create new Fedora virtual machine
- **Physical Machine**: Any Linux system with KasmVNC support

**System Requirements:**
- **OS**: Fedora, Ubuntu, or other Linux distribution
- **RAM**: 4+ GB
- **Network**: Internet access
- **Platform**: Any (VMware, VirtualBox, Proxmox, physical hardware)

### Step 3: Set up remote desktop services
SSH into your VM/system or open a terminal, then run:

**For KasmVNC (recommended):**
```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/vm-setup-kasmvnc.sh | bash
```

**For legacy XRDP/VNC:**
```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/vm-setup.sh | bash
```

**What gets installed (KasmVNC):**
- KasmVNC server (web-native VNC with multi-monitor support)
- Virtual framebuffer (Xvfb) for headless operation
- Basic desktop applications (Firefox, terminal, etc.)
- Systemd service for automatic startup

**What gets installed (Legacy):**
- XRDP server (primary RDP access)
- VNC server (backup access)
- GNOME desktop environment
- Basic desktop applications

### Step 4: Connect them together

**For KasmVNC setup:**
1. Access management interface: `http://localhost:PORT` (where PORT is the port you configured)
2. Click "Connect" to access the remote desktop via KasmVNC
3. Use "Add Display" button for multi-monitor support
4. Copy MCP configuration for Cherry Studio integration

**Note:** If you used a custom port, replace `8080` with your chosen port in all URLs below.

## Usage

### Web Interface (KasmVNC)
- **Main Interface**: `http://localhost:8080` (Caddy proxy - configurable port)
- **Management**: `http://localhost:8080/` (overlay management interface)
- **KasmVNC Desktop**: `http://localhost:8080/vnc/` (web-native VNC access)
- **System Status**: Container health and remote desktop connections

- **Direct Access**: `http://localhost:3001` (configurable port)
- **Via Proxy**: `http://localhost:8080/mcp` (through Caddy)
- **Protocol**: Model Context Protocol over HTTP
- **Features**: Screen capture, overlay annotations, AI interaction, clipboard access

### VM Clipboard Bridge (Optional)

The Overlay Companion MCP includes an optional Flatpak-based clipboard bridge that enables seamless clipboard synchronization between the host system and VM environments.

**Features:**
- **Cross-VM Clipboard Access**: Read and write clipboard content from the VM
- **Automatic Fallback**: Falls back to local clipboard when VM bridge is unavailable
- **Multi-Backend Support**: Works with Wayland, X11, and various clipboard tools
- **Secure API**: REST API with authentication for clipboard operations
- **Auto-Start**: Systemd service for automatic startup in the VM

**Installation (in VM):**
```bash
# Automatic installation
./scripts/vm-setup/install-clipboard-bridge.sh

# Manual installation
cd flatpak/clipboard-bridge
./build.sh
```

**Configuration:**
Configure the clipboard bridge through the web interface at `http://localhost:3000/setup`. The settings include:
- **Enable/Disable**: Toggle VM clipboard bridge functionality
- **Base URL**: VM clipboard bridge service URL (default: `http://localhost:8765`)
- **API Key**: Authentication key for the bridge service
- **Timeout**: Connection timeout in seconds
- **Fallback**: Enable automatic fallback to local clipboard

**Status Check:**
- Use the web interface test button to verify connectivity
- Use the `get_clipboard_bridge_status` MCP tool for programmatic status checking

**Documentation:** See [flatpak/clipboard-bridge/README.md](flatpak/clipboard-bridge/README.md) for detailed setup and usage instructions.

Configure your AI client (Cherry Studio, etc.) to use:
```
MCP Server URL: http://localhost:3000
```
Or via proxy: `http://localhost:8080/mcp`
(Ports are configurable during installation)

## Service Management

### Container Management (on HOST)
```bash
# Check container status
podman ps

# View logs
podman logs overlay-companion

# Restart services
cd ~/.config/overlay-companion-mcp
podman-compose restart

# Stop all services
podman-compose down
```

### VM Management
```bash
# Check RDP service in VM
sudo systemctl status xrdp

# Restart RDP service in VM
sudo systemctl restart xrdp

# Check VNC service in VM
sudo systemctl status vncserver@1
```

## Troubleshooting

### Container Issues
- Check logs: `podman logs [container-name]`
- Restart containers: `podman-compose restart`
- Rebuild containers: Re-run host-setup.sh

### VM Connection Issues
- Verify VM IP address
- Check firewall settings in VM
- Test RDP connection directly: `xfreerdp /v:[VM-IP] /u:[username]`

### Network Issues
- Ensure VM and host can communicate
- Check firewall rules on both systems
- Verify RDP port 3389 is open

## Development

### Building from Source
```bash
git clone https://github.com/RyansOpenSourceRice/overlay-companion-mcp.git
cd overlay-companion-mcp
./host-setup.sh
```

### Container Architecture
- **KasmVNC container**: Web-native VNC with multi-monitor support
- **MCP server container**: C# overlay functionality
- **Web interface container**: Management UI
- **Caddy proxy container**: Unified access point

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with both host containers and VM setup
5. Submit a pull request

## License

MIT License - see LICENSE file for details.
