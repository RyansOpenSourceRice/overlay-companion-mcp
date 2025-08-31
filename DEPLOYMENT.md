# Deployment Guide

Multiple deployment options for different use cases and infrastructure preferences.

> **📋 Important**: This guide reflects the new KasmVNC architecture. The legacy Guacamole deployment is deprecated due to database complexity and limited multi-monitor support.

---

## 🏠 Option 1: Host + VM Architecture (Recommended)

**KasmVNC containers on HOST Fedora Linux, VMs separate - simplified architecture**

### Architecture
- **Host OS**: Runs 4 podman containers (MCP server, Management web, KasmVNC, Caddy proxy)
- **Separate VM**: Runs KasmVNC server for web-native remote desktop access
- **Connection**: Direct WebSocket/WebRTC connection to KasmVNC, MCP provides AI overlay

### Quick Start

**Step 1: Set up containers on HOST Fedora Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/host-setup-kasmvnc.sh | bash
```

**Step 2: Create Fedora VM on your preferred platform**
- Use VMware, VirtualBox, Proxmox, etc.
- Install Fedora Silverblue or Workstation
- Minimum: 4GB RAM, internet access

**Step 3: Set up KasmVNC in VM**
```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/vm-setup-kasmvnc.sh | bash
```

**What gets installed:**
- ✅ **Host**: 4 containers (MCP server, Web interface, KasmVNC, Caddy proxy) - **33% fewer containers**
- ✅ **VM**: KasmVNC server with GNOME desktop
- ✅ **Connection**: Direct WebSocket/WebRTC to KasmVNC (no database required)
- ✅ **No Database**: Eliminates PostgreSQL complexity entirely
- ✅ Ready to use in 10-15 minutes

**After installation:**
- **Main Interface**: `http://localhost:8080` (Caddy proxy)
- **MCP Server**: `http://localhost:3000` (direct) or `http://localhost:8080/mcp` (via proxy)
- **KasmVNC**: `http://localhost:8080/vnc/` (web-native VNC client)
- **Web Interface**: `http://localhost:8080/` (overlay management)
- Add VM via web interface using its IP address and port 6901

**Benefits:**
- ✅ **No Database**: Eliminates PostgreSQL setup and maintenance
- ✅ **Fewer Containers**: 4 instead of 6 (33% reduction in complexity)
- ✅ **True Multi-Monitor**: Native support with separate browser windows
- ✅ **Web-Native**: Built for browsers, no legacy VNC clients
- ✅ **Better Performance**: WebSocket/WebRTC protocols
- ✅ **Simpler Configuration**: YAML-based instead of database schemas
- ✅ Resource efficient: containers don't compete with VM resources

---

## 🐳 Option 2: Podman (OCI Containers - Existing Infrastructure)

**For users with existing container infrastructure**

If you already have Podman/Docker infrastructure and want to integrate:

```bash
git clone https://github.com/RyansOpenSourceRice/overlay-companion-mcp.git
cd overlay-companion-mcp/infra
podman-compose up -d
```

**Container Stack (6 containers):**
- **postgres**: PostgreSQL 16-alpine with Guacamole schema
- **guacd**: Guacamole daemon for RDP/VNC connections
- **guacamole**: Guacamole web application
- **mcp-server**: C# MCP server with HTTP transport
- **overlay-web**: Node.js web interface for overlay management
- **caddy**: Reverse proxy routing all services

**Requirements:**
- Existing Podman/Docker setup
- Fedora Linux host
- Network access to target VMs

**Access Points:**
- **Main**: http://localhost:8080 (Caddy proxy)
- **MCP**: http://localhost:3000 (direct MCP server)
- **Database**: PostgreSQL on port 5432 (internal)

---

## 🖥️ Option 3: Legacy VM-Only (Not Recommended)

**Everything in containers inside a VM - for testing only**

⚠️ **Warning**: This approach is overly complex and resource-intensive. Use Option 1 instead.

If you must use this approach:
1. Create a large Fedora VM (8+ GB RAM, 4+ cores)
2. Run the old container setup inside the VM
3. Access via VM IP address

**Why not recommended:**
- ❌ Resource waste: containers compete with VM overhead
- ❌ Complex networking: multiple layers of virtualization
- ❌ Harder troubleshooting: nested virtualization issues
- ❌ Platform lock-in: tied to specific VM platform

---

## 🔧 Advanced Deployment

### Custom Container Build
```bash
git clone https://github.com/RyansOpenSourceRice/overlay-companion-mcp.git
cd overlay-companion-mcp

# Build custom containers
podman build -f release/containers/Dockerfile.unified -t overlay-companion:custom .

# Deploy with custom configuration
cp release/containers/podman-compose.yml ~/.config/overlay-companion-mcp/
# Edit configuration as needed
podman-compose up -d
```

### Multiple VM Setup
1. Run host-setup.sh once on your Fedora Linux
2. Create multiple VMs on different platforms
3. Run vm-setup.sh in each VM
4. Add all VMs to the management interface
5. Switch between VMs through the web interface

### Production Deployment
- Use systemd services for container auto-start
- Configure firewall rules for security
- Set up SSL/TLS for web interface
- Use persistent volumes for data
- Monitor container health

---

## 📊 Comparison

| Deployment | Complexity | Resources | Flexibility | Recommended |
|------------|------------|-----------|-------------|-------------|
| Host + VM  | Medium     | Efficient | High        | ✅ Yes      |
| Containers | Low        | Very Efficient | Medium | For experts |
| VM-Only    | High       | Wasteful  | Low         | ❌ No       |

---

## 🚀 Getting Started

**New users**: Start with Option 1 (Host + VM Architecture)
**Container experts**: Consider Option 2 (Podman integration)
**Testing only**: Option 3 might work but is not supported

Choose the deployment that best fits your infrastructure and expertise level.