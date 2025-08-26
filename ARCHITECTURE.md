# Overlay Companion MCP - Architecture Specification

## Vision

A single-user, lightweight system where users download a small release package, run an install script, and get a local IP URL to access a Fedora Silverblue VM through a web interface with AI-assisted overlay capabilities.

## User Flow

1. **Download**: Small release package from GitHub (no large VM images)
2. **Install**: Run `install.sh` → auto-installs Podman + OpenTofu + libvirt
3. **Provision**: OpenTofu creates management container + Fedora Silverblue VM
4. **Access**: Script prints local IP URL (e.g., `http://192.168.1.42:8080`)
5. **Configure**: Click URL → Web interface → "Copy MCP Config" → Paste into Cherry Studio
6. **Use**: Access VM through Guacamole with AI overlay assistance

## System Architecture

### Core Components

```text
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   Cherry Studio │───▶│ Management       │───▶│ Fedora Silverblue   │
│   (AI Client)   │    │ Container        │    │ VM (KVM/libvirt)    │
└─────────────────┘    │                  │    └─────────────────────┘
                       │ • Guacamole      │              │
                       │ • MCP Server     │              │
                       │ • Web Frontend   │              │
                       │ • Overlay System │              │
                       └──────────────────┘              │
                                │                        │
                       ┌──────────────────┐              │
                       │ Web Interface    │◀─────────────┘
                       │ (Browser)        │
                       │ • guacamole-js   │
                       │ • Click-through  │
                       │ • Overlays       │
                       └──────────────────┘
```

### Technology Stack

#### Infrastructure Layer
- **OpenTofu**: Infrastructure as Code for provisioning
- **Podman**: Rootless container runtime (OCI compliant)
- **libvirt/KVM**: VM virtualization platform
- **Fedora Linux**: Host OS (target platform)

#### Management Container (Podman/OCI)
- **Guacamole Stack**:
  - `guacd`: Gateway daemon for RDP/VNC protocols
  - `guacamole`: Web application (Tomcat-based)
  - `postgres`: Database for Guacamole configuration
- **MCP Server**: C# WebSocket bridge for overlay broadcasting
- **Web Frontend**: Static assets + guacamole-common-js client
- **Reverse Proxy**: Caddy for TLS termination (future)

#### Virtual Machine
- **OS**: Fedora Silverblue (immutable, container-focused)
- **Display**: Wayland (future-proof, with XRDP fallback)
- **Remote Access**: XRDP for Guacamole connectivity
- **Isolation**: Full VM isolation for security

#### Client Integration
- **Cherry Studio**: AI client with MCP support
- **Web Browser**: Guacamole client + overlay rendering
- **Overlay System**: Click-through annotations with `pointer-events: none`

## Network Architecture

### Default Configuration (Secure)
```text
Host Machine (Fedora)
├── Management Container: localhost:8080
├── Fedora VM: 192.168.122.x (libvirt default network)
└── Access: Host-only (127.0.0.1)
```

### Optional LAN Exposure (With Warnings)
```text
Host Machine (Fedora)
├── Management Container: 0.0.0.0:8080
├── Fedora VM: 192.168.1.x (bridged network)
└── Access: LAN IP (192.168.1.42:8080)
```

### Security Considerations
- **Default**: Host-only access for security
- **Optional**: LAN exposure with explicit user consent + security warnings
- **Future**: HTTPS via self-signed certificates or Let's Encrypt
- **Authentication**: CORS headers + session-based access control

## Release Package Structure

### Lightweight Release (Primary)
```text
overlay-companion-release.tar.gz
├── install.sh                    # Main installer script
├── opentofu/                     # Infrastructure modules
│   ├── main.tf                   # Root module
│   ├── modules/
│   │   ├── management-container/ # Container provisioning
│   │   ├── fedora-vm/           # VM provisioning
│   │   └── networking/          # Network configuration
│   └── variables.tf             # Configuration variables
├── containers/                   # Container definitions
│   ├── Dockerfile.management    # Management container
│   └── compose/                 # Podman compose files
├── vm/                          # VM configuration
│   ├── cloud-init/              # VM initialization
│   └── kickstart/               # Automated installation
└── README.md                    # Installation instructions
```

### Installation Process
1. **Dependency Check**: Verify/install Podman + OpenTofu + libvirt
2. **Image Caching**: Download/cache Fedora Silverblue ISO (first run only)
3. **Infrastructure**: `opentofu apply` provisions containers + VM
4. **Network Discovery**: Detect and configure network access
5. **Service Start**: Launch management container + VM
6. **URL Output**: Print access URL for user

## Development Phases

### Phase 1: Core Infrastructure (MVP)
- [x] Disable AppImage builds
- [ ] Create install.sh script with dependency management
- [ ] Build OpenTofu modules for container + VM provisioning
- [ ] Implement management container with Guacamole stack
- [ ] Create web frontend with guacamole-common-js
- [ ] Setup Fedora Silverblue VM with XRDP

### Phase 2: Integration & Polish
- [ ] Integrate existing C# MCP server with WebSocket broadcasting
- [ ] Implement overlay system with click-through functionality
- [ ] Add "Copy MCP Config" one-click functionality
- [ ] Setup VM image caching to avoid re-downloads
- [ ] Add network configuration options (host-only vs LAN)

### Phase 3: Production Readiness
- [ ] Add HTTPS/TLS support via Caddy
- [ ] Implement proper authentication and session management
- [ ] Add monitoring and logging capabilities
- [ ] Create comprehensive documentation
- [ ] Setup CI/CD for release packaging

## Platform Support Policy

### Supported Platforms
- **Primary**: Fedora Linux (latest stable)
- **Secondary**: Other RPM-based distributions (RHEL, CentOS Stream)

### Explicitly Out of Scope
- **Windows**: Complex virtualization requirements, different container ecosystem
- **macOS**: Limited KVM support, licensing restrictions
- **Debian/Ubuntu**: Different package management, testing overhead

**Rationale**: Focus on single platform ensures reliability, reduces support burden, and enables faster iteration. Future multi-platform support can be evaluated based on user demand.

## Resource Requirements

### Minimum (Development/Testing)
- **CPU**: 4 vCPU
- **RAM**: 8 GB
- **Storage**: 80 GB SSD
- **Network**: 100 Mbps

### Recommended (Production Use)
- **CPU**: 8 vCPU
- **RAM**: 16 GB
- **Storage**: 200 GB SSD
- **Network**: 1 Gbps

### Resource Allocation
- **Host OS**: 2 GB RAM, 2 vCPU
- **Management Container**: 2 GB RAM, 2 vCPU
- **Fedora VM**: 4-8 GB RAM, 2-4 vCPU
- **Storage**: 40 GB VM disk, 40 GB container images/data

## Security Model

### Isolation Boundaries
1. **VM Isolation**: Full hardware virtualization via KVM
2. **Container Isolation**: Rootless Podman with user namespaces
3. **Network Isolation**: Default host-only access
4. **Process Isolation**: Separate processes for each component

### Access Control
- **Default**: Local access only (127.0.0.1)
- **Optional**: LAN access with explicit user consent
- **Authentication**: Session-based with CORS protection
- **Future**: OAuth/OIDC integration for multi-user scenarios

### Data Protection
- **VM State**: Encrypted VM disk images (future)
- **Network Traffic**: HTTPS for external access (future)
- **Secrets**: OpenTofu state encryption
- **Logs**: Structured logging with sensitive data filtering

## Future Enhancements

### Short Term
- **Multi-Monitor Support**: Two-window cropping for dual displays
- **Performance Optimization**: GPU passthrough for better VM performance
- **Update Management**: Automated updates for VM and containers

### Long Term
- **Multi-User Support**: Multiple concurrent VM sessions
- **Cloud Deployment**: AWS/GCP/Azure deployment options
- **Advanced Overlays**: 3D annotations, video recording
- **API Extensions**: REST API for programmatic control

## Integration Points

### Cherry Studio Integration
```json
{
  "mcpServers": {
    "overlay_companion": {
      "url": "http://192.168.1.42:8080/mcp",
      "transport": "http",
      "description": "AI-assisted screen interaction with VM overlay"
    }
  }
}
```

### MCP Protocol Extensions
- **Overlay Commands**: `draw_overlay`, `clear_overlays`, `batch_overlay`
- **VM Control**: `screenshot`, `click`, `type`, `scroll`
- **Session Management**: `start_session`, `stop_session`, `get_status`
- **Multi-Monitor**: `set_viewport`, `get_monitors`, `crop_display`

This architecture provides a solid foundation for the single-user, lightweight release while maintaining extensibility for future enhancements.