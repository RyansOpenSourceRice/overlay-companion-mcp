# Deployment Guide

Multiple deployment options for different use cases and infrastructure preferences.


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

---
# Appendix: Port configuration (consolidated)
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

---
# Appendix: Legacy AppImage validation fixes (consolidated)
# AppImage Validation and Error Detection Fixes

## Problem Summary (Legacy)

Note: The project is now web-only. Native GTK/Avalonia desktop UI paths have been removed. The notes below are preserved for historical context in case AppImage packaging is reintroduced for a desktop build in the future.

Previously, the AppImage build could fail with GTK4 dependency errors while GitHub Actions tests still passed (green checkmark) due to inadequate error detection. This created a false sense of success while the AppImage was actually broken.

### Original Errors

1. **GTK4 Dependency Error**: 
   ```
   ERROR: Failed to start GTK4 application: Unable to load shared library 'Gtk' or one of its dependencies
   ```

2. **Masked Test Failures**: Tests used `|| echo "Help test completed"` which always succeeded even on critical failures

3. **Missing System Dependencies**: GTK4 libraries weren't available during CI build, so they weren't bundled into the AppImage

## Solutions Implemented

### 1. Fixed Test Error Detection (`build-appimage.yml`)

**Before:**
```bash
xvfb-run -a ./app.AppImage --help || echo "Help test completed"
```

**After:**
```bash
if ! xvfb-run -a timeout 30 ./app.AppImage --help > appimage_help_test.log 2>&1; then
  # Check for critical dependency errors that should fail the build
  if grep -q "Unable to load shared library.*Gtk" appimage_help_test.log; then
    echo "❌ CRITICAL: GTK4 dependencies missing from AppImage"
    exit 1
  fi
  # ... additional error checks
fi
```

### 2. Added GTK4 System Dependencies (Historical)

This section applied to the former desktop build. With web-only delivery, GTK4 is no longer required. If reintroducing a desktop build, install comprehensive GTK4 development packages in CI:
```yaml
sudo apt-get install -y \
  libgtk-4-dev \
  libgtk-4-1 \
  pkg-config \
  libglib2.0-dev \
  libcairo2-dev \
  libpango1.0-dev \
  libgdk-pixbuf2.0-dev \
  libgraphene-1.0-dev \
  libepoxy-dev
```

### 3. Created Comprehensive Validation Script (Applies to any AppImage)

**New file: `scripts/validate-appimage.sh`**

Features:
- ✅ File property validation (executable, size)
- ✅ AppImage extraction testing
- ✅ Required file verification
- ✅ GTK4 dependency checking
- ✅ Runtime execution testing with timeout
- ✅ Critical error pattern detection
- ✅ Detailed diagnostic output

Usage:
```bash
./scripts/validate-appimage.sh path/to/app.AppImage
```

### 4. Enhanced Build Script Diagnostics

Improved `scripts/build-appimage.sh` to provide better feedback:
- Shows available libraries in AppDir
- Checks system GTK4 availability
- Provides clear warnings when GTK4 isn't bundled

### 5. Added Pre-commit Validation Hooks (General)

Enhanced `.pre-commit-config.yaml` with:
- Build script executable permission checks
- AppImage validation (if present)
- GitHub Actions workflow syntax validation
- npm cache configuration validation

## Testing the Fixes

### Manual Testing
```bash
# Test the validation script
./scripts/validate-appimage.sh build/overlay-companion-mcp-*.AppImage

# Run pre-commit hooks
pre-commit run --all-files
```

### CI Testing
The updated workflow will now:
1. Install GTK4 dependencies during build
2. Bundle GTK4 libraries into AppImage
3. Run comprehensive validation
4. Fail fast on critical dependency errors

## Expected Outcomes

### Before Fixes
- ❌ GTK4 errors hidden by `|| echo` statements
- ❌ Tests pass despite broken AppImage
- ❌ No early detection of dependency issues
- ❌ Poor diagnostic information

### After Fixes
- ✅ Critical errors cause build failures
- ✅ GTK4 libraries bundled in AppImage (desktop build only)
- ✅ Comprehensive validation with clear diagnostics
- ✅ Pre-commit hooks catch issues early
- ✅ Better error reporting and debugging info

## Future Improvements

1. **Automated Dependency Detection**: Could enhance the build script to automatically detect and bundle all required native dependencies

2. **Cross-platform Testing**: Add validation for different Linux distributions to ensure broader compatibility

3. **Performance Monitoring**: Track AppImage startup time and size to detect regressions

4. **Integration Testing**: Add tests that verify MCP functionality works correctly in the AppImage environment

## Usage Guidelines

### For Developers
1. Run `pre-commit install` to enable automatic validation
2. Use `./scripts/validate-appimage.sh` to test AppImages locally
3. Check CI logs for detailed validation output

### For CI/CD
1. The build will now fail fast on critical dependency errors
2. Validation logs provide detailed diagnostic information
3. AppImage artifacts are only uploaded if validation passes

This comprehensive approach ensures that AppImage builds are properly validated and critical errors are caught early in the development process.
## Current State

- The application runs as a web-first MCP server with HTTP transport at root "/" and a browser overlay viewer served from wwwroot.
- STDIO is retained only for legacy/testing.
- Desktop GUI artifacts (GTK/Avalonia) are excluded from the build. Any future reintroduction should revisit this document.

