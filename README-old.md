# overlay-companion-mcp

[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-FF6B35?style=for-the-badge&logo=anthropic)](https://modelcontextprotocol.io/)
[![Platform](https://img.shields.io/badge/platform-Web%20(HTTP%20MCP)-00ADD8?style=for-the-badge&logo=google-chrome)](https://modelcontextprotocol.io/)
[![Language](https://img.shields.io/badge/language-C%23-239120?style=for-the-badge&logo=csharp)](https://docs.microsoft.com/en-us/dotnet/csharp/)
[![AI](https://img.shields.io/badge/AI-Cherry%20Studio%20Compatible-4285F4?style=for-the-badge&logo=openai)](https://cherry-studio.ai/)
[![Automation](https://img.shields.io/badge/automation-Human%20in%20Loop-28A745?style=for-the-badge&logo=robot)](https://github.com/RyansOpenSauceRice/overlay-companion-mcp)
[![Status](https://img.shields.io/badge/status-development-yellow?style=for-the-badge&logo=github)](https://github.com/RyansOpenSauceRice/overlay-companion-mcp)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue?style=for-the-badge)](https://www.gnu.org/licenses/gpl-3.0.html)
[![Docs](https://img.shields.io/badge/docs-specification-green?style=for-the-badge&logo=markdown)](https://github.com/RyansOpenSauceRice/overlay-companion-mcp/blob/main/SPECIFICATION.md)

A general-purpose, human-in-the-loop AI-assisted screen interaction toolkit built with the **official ModelContextProtocol C# SDK**.

## 🚀 Quick Installation

### Step 1: Create a Fedora VM
Create a Fedora virtual machine using your preferred platform:
- **Proxmox**: Create new VM with Fedora template
- **TrueNAS**: Use VM manager to create Fedora VM
- **Boxes (Fedora)**: Create new Fedora virtual machine
- **VirtualBox**: Create new Fedora VM
- **VMware**: Create new Fedora virtual machine
- **Any other platform**: Any Fedora VM will work

**VM Requirements:**
- **OS**: Fedora Linux (latest stable recommended)
- **RAM**: 8+ GB (16+ GB recommended for better performance)
- **CPU**: 4+ cores
- **Disk**: 50+ GB free space
- **Network**: Internet access
- **Graphics**: Hardware acceleration recommended

### Step 2: Run Setup Inside VM
SSH into your VM or open a terminal, then run:
```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSauceRice/overlay-companion-mcp/main/setup.sh | bash
```

### Step 3: Access Your System
- **Web Interface**: `http://[VM-IP]:8080`
- **MCP Server**: `http://[VM-IP]:8080/mcp`
- **Management API**: `http://[VM-IP]:8080/api`

**What gets installed:**
- **Unified MCP + Management container** (C# overlay server + Node.js web interface)
- **PostgreSQL container** (database for Guacamole)
- **Guacamole containers** (web-based remote desktop access)
- All containers managed by podman-compose

**That's it!** Same powerful containerized infrastructure, your choice of VM platform.

## Installation (Web-first)

Run as a headless HTTP MCP server that serves a browser overlay viewer.

### From source (for development)
```bash
dotnet build -c Release src/OverlayCompanion.csproj -o build/publish
./build/publish/overlay-companion-mcp
```

Environment:
- PORT or OC_PORT to change port (default 3000)
- OC_SMOKE_TEST=1 to run smoke/startup check and exit



**Architecture**: Full HTTP MCP server with web-only viewer. Overlays render in the browser and the server runs headless by default.
- **Default operation**: HTTP server on port 3000
- **Native GUI**: Removed. All interaction is via the web UI and MCP over HTTP

### System Requirements
- **Runtime**: .NET 8, Linux
- **Web-first**: Browser overlay renders via /ws/overlays events from server
- **Recommended tools**: grim (Wayland), gnome-screenshot/spectacle; scrot/maim (X11 fallback)
- **Clipboard**: wl-clipboard (wl-copy/wl-paste) recommended; xclip as X11 fallback

### Current Notes
- **Transport**: HTTP is the primary transport at "/" with SSE. STDIO is deprecated and retained only for legacy/testing.
- **GUI**: No native GUI. GTK/Avalonia paths have been removed; web-only experience.

## Usage

### MCP Integration
Configure with Cherry Studio or other MCP-compatible AI clients using HTTP transport (recommended):

```json
{
  "mcpServers": {
    "overlay_companion": {
      "url": "http://localhost:3000/",
      "description": "AI-assisted screen interaction with overlay functionality for multi-monitor setups",
      "tags": ["screen-capture", "overlay", "automation", "multi-monitor", "web", "http", "sse", "linux"],
      "provider": "Overlay Companion",
      "provider_url": "https://github.com/RyansOpenSauceRice/overlay-companion-mcp"
    }
  }
}
```

> Note: STDIO transport is deprecated. Use HTTP above. If you must use STDIO, start the binary with `--stdio` and configure your client accordingly.

### Easy Configuration Setup

For a better user experience, the application provides configuration endpoints when running:

- **Web UI**: Visit `http://localhost:3000/setup` for an interactive configuration interface
- **JSON Config**: Get ready-to-use configuration from `http://localhost:3000/config`
- **MCP Endpoint**: POST JSON-RPC to `http://localhost:3000/` with header `Accept: application/json, text/event-stream` (SSE)
- **Copy & Paste**: One-click copy functionality for easy setup in Cherry Studio

The configuration includes proper metadata (description, tags, provider info) for better integration with MCP clients.

### Available Tools
- Screen capture, overlays, multi-monitor info
- Input simulation and clipboard tools
- Human-in-the-loop confirmations

Note: Wayland is preferred with X11 fallback. See SPECIFICATION.md for platform integration details.

For complete tool documentation, see [MCP_SPECIFICATION.md](MCP_SPECIFICATION.md).

## Development

**Contributors and AI agents:** See [DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md) for development environment setup.

## Troubleshooting

### HTTP Usage
- Default port: 3000
- MCP endpoint: POST to `http://localhost:3000/` with `Accept: application/json, text/event-stream`
- Setup page: `http://localhost:3000/setup`
- Config JSON: `http://localhost:3000/config`

### Transport Issues

#### HTTP Transport (Recommended)
- Default port: 3000
- Check firewall settings if connection fails
- Use `netstat -tlnp | grep 3000` to verify server is listening

#### STDIO Transport (Deprecated)
- Use `--stdio` flag for legacy compatibility
- Ensure MCP client supports STDIO transport
- Consider migrating to HTTP transport for better features

## Documentation Quality

This repository maintains high documentation standards with automated quality checks:

### Markdown Linting

All markdown files are automatically checked for:
- **Style consistency** using markdownlint
- **Spelling accuracy** using cspell
- **Link validity** using markdown-link-check
- **Table of contents** synchronization

### Running Checks Locally

```bash
# Run all markdown quality checks
./scripts/lint-markdown.sh

# Or run individual tools
markdownlint "**/*.md"
cspell "**/*.md"
```

### GitHub Actions

Quality checks run automatically on:
- All pull requests
- Pushes to main/develop branches
- Changes to markdown files

See `.github/workflows/` for complete automation setup.
