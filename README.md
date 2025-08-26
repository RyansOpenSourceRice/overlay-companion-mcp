# Overlay Companion MCP

AI-powered screen overlay system with Model Context Protocol (MCP) integration. Provides intelligent screen interaction capabilities through containerized infrastructure.

## Architecture

**Host OS (Fedora Linux)**: Runs 4 podman containers
- **MCP Server Container**: C# overlay functionality for AI screen interaction
- **Management Web Container**: Node.js web interface for system management
- **PostgreSQL Container**: Database for Guacamole
- **Guacamole Container**: Web-based RDP client for VM access

**Separate VM (Fedora)**: Target for RDP connections
- Runs RDP server (xrdp, VNC)
- Accessed through Guacamole container on host
- No containers needed in VM

**Connection Flow**: Host containers → Guacamole → RDP → VM

## Installation

### Step 1: Set up containers on your HOST Fedora Linux
Run this on your main Fedora Linux system:
```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSauceRice/overlay-companion-mcp/main/host-setup.sh | bash
```

**What gets installed on HOST:**
- MCP server container (C# overlay functionality)
- Management web interface container (Node.js)
- PostgreSQL container (database)
- Guacamole container (web-based RDP client)

### Step 2: Create a Fedora VM separately
Create a VM using your preferred platform:
- **Proxmox**: Create new VM with Fedora template
- **VirtualBox**: Create new Fedora VM
- **VMware**: Create new Fedora virtual machine
- **Any platform**: Any Fedora VM will work

**VM Requirements:**
- **OS**: Fedora Silverblue or Fedora Workstation
- **RAM**: 4+ GB
- **Network**: Internet access
- **Platform**: Any (VMware, VirtualBox, Proxmox, etc.)

### Step 3: Set up RDP services in your VM
SSH into your VM or open a terminal, then run:
```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSauceRice/overlay-companion-mcp/main/vm-setup.sh | bash
```

**What gets installed in VM:**
- XRDP server (primary RDP access)
- VNC server (backup access)
- GNOME desktop environment
- Basic desktop applications

### Step 4: Connect them together
1. Access management interface: `http://localhost:8080`
2. Add your VM using its IP address
3. Configure RDP connection settings
4. Start using AI overlay functionality

## Usage

### Web Interface
- **Management**: `http://localhost:8080`
- **RDP Access**: Through Guacamole web interface
- **System Status**: Container health and VM connections

### MCP Server
- **Endpoint**: `http://localhost:8080/mcp`
- **Protocol**: Model Context Protocol
- **Features**: Screen capture, overlay annotations, AI interaction

### AI Client Configuration
Configure your AI client (Cherry Studio, etc.) to use:
```
MCP Server URL: http://localhost:8080/mcp
```

## Service Management

### Container Management (on HOST)
```bash
# Check container status
podman ps

# View logs
podman logs overlay-companion
podman logs overlay-companion-postgres
podman logs overlay-companion-guacamole

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
git clone https://github.com/RyansOpenSauceRice/overlay-companion-mcp.git
cd overlay-companion-mcp
./host-setup.sh
```

### Container Architecture
- **Dockerfile.unified**: Combined MCP server + Management web interface
- **podman-compose.yml**: Multi-container orchestration
- **PostgreSQL**: Separate container for database isolation
- **Guacamole**: Separate containers for RDP functionality

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with both host containers and VM setup
5. Submit a pull request

## License

MIT License - see LICENSE file for details.