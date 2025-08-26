# Deployment Guide

Multiple deployment options for different use cases and infrastructure preferences.

---

## 🏠 Option 1: Host + VM Architecture (Recommended)

**Containers on HOST Fedora Linux, VMs separate - proper separation of concerns**

### Architecture
- **Host OS**: Runs 4 podman containers (MCP server, Management web, PostgreSQL, Guacamole)
- **Separate VM**: Runs RDP services, accessed through Guacamole
- **Connection**: Guacamole connects to VM via RDP, MCP provides AI overlay

### Quick Start

**Step 1: Set up containers on HOST Fedora Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSauceRice/overlay-companion-mcp/main/host-setup.sh | bash
```

**Step 2: Create Fedora VM on your preferred platform**
- Use VMware, VirtualBox, Proxmox, etc.
- Install Fedora Silverblue or Workstation
- Minimum: 4GB RAM, internet access

**Step 3: Set up RDP in VM**
```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSauceRice/overlay-companion-mcp/main/vm-setup.sh | bash
```

**What gets installed:**
- ✅ **Host**: 4 containers (MCP server, Management web, PostgreSQL, Guacamole)
- ✅ **VM**: RDP services (xrdp, VNC, GNOME desktop)
- ✅ **Connection**: Guacamole connects to VM via RDP
- ✅ Ready to use in 15-20 minutes

**After installation:**
- Management Interface: `http://localhost:8080`
- MCP Server: `http://localhost:8080/mcp`
- Add VM via web interface using its IP address

**Benefits:**
- ✅ Proper separation: containers on host, VMs separate
- ✅ Platform agnostic: use any VM platform
- ✅ Scalable: add multiple VMs easily
- ✅ Resource efficient: containers don't compete with VM resources

---

## 🐳 Option 2: Podman (OCI Containers - Existing Infrastructure)

**For users with existing container infrastructure**

If you already have Podman/Docker infrastructure and want to integrate:

```bash
git clone https://github.com/RyansOpenSauceRice/overlay-companion-mcp.git
cd overlay-companion-mcp/release/containers
podman-compose up -d
```

**Requirements:**
- Existing Podman/Docker setup
- Fedora Linux host
- Network access to target VMs

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
git clone https://github.com/RyansOpenSauceRice/overlay-companion-mcp.git
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