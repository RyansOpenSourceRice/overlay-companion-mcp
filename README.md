# overlay-companion-mcp

[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-FF6B35?style=for-the-badge&logo=anthropic)](https://modelcontextprotocol.io/)
[![Platform](https://img.shields.io/badge/platform-Linux%20AppImage-FCC624?style=for-the-badge&logo=linux)](https://appimage.org/)
[![Language](https://img.shields.io/badge/language-C%23-239120?style=for-the-badge&logo=csharp)](https://docs.microsoft.com/en-us/dotnet/csharp/)
[![AI](https://img.shields.io/badge/AI-Jan.ai%20Compatible-4285F4?style=for-the-badge&logo=openai)](https://jan.ai/)
[![Automation](https://img.shields.io/badge/automation-Human%20in%20Loop-28A745?style=for-the-badge&logo=robot)](https://github.com/RyansOpenSauceRice/overlay-companion-mcp)
[![Status](https://img.shields.io/badge/status-development-yellow?style=for-the-badge&logo=github)](https://github.com/RyansOpenSauceRice/overlay-companion-mcp)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue?style=for-the-badge)](https://www.gnu.org/licenses/gpl-3.0.html)
[![Docs](https://img.shields.io/badge/docs-specification-green?style=for-the-badge&logo=markdown)](https://github.com/RyansOpenSauceRice/overlay-companion-mcp/blob/main/SPECIFICATION.md)

A general-purpose, human-in-the-loop AI-assisted screen interaction toolkit built with the **official ModelContextProtocol C# SDK**.

## Installation

### Download AppImage (Recommended)
1. Download the latest AppImage from [Releases](https://github.com/RyansOpenSauceRice/overlay-companion-mcp/releases)
2. Make it executable: `chmod +x overlay-companion-mcp-*.AppImage`
3. Run: `./overlay-companion-mcp-*.AppImage`

**Architecture**: The application runs an **HTTP server** (required for MCP protocol) with a **GUI interface**:
- **Normal operation**: HTTP server + GUI (default)
- **Testing only**: GUI can be disabled with `--no-gui` or `HEADLESS=1` for automated testing

> **Note**: AppImages from v2025.08.22.4+ include the Avalonia double initialization fix, smoke test timeout fix, and all necessary native dependencies (libSkiaSharp, libHarfBuzzSharp) for proper GUI functionality. Earlier versions may experience GUI initialization issues or CI test timeouts.

### System Requirements
- **Target Platform**: Fedora Linux with Wayland (GNOME)
- **Current GUI Framework**: Avalonia UI (cross-platform)
- **Click-Through Limitation**: Overlays are transparent but not fully click-through on native Wayland
- **Recommended tools**: grim (Wayland), gnome-screenshot/spectacle; scrot/maim (X11 fallback)
- **Clipboard**: wl-clipboard (wl-copy/wl-paste) recommended; xclip as X11 fallback

### Known Limitations
- **Overlay Click-Through**: Current Avalonia implementation provides visual transparency but limited click-through on Wayland
- **Workaround**: Run under XWayland for better click-through support
- **Future**: Migration to GTK4 planned for native Wayland click-through support

## Usage

### MCP Integration
Configure with Jan.ai or other MCP-compatible AI clients using HTTP transport (recommended):

```json
{
  "mcpServers": {
    "overlay-companion": {
      "command": "/path/to/overlay-companion-mcp",
      "args": [],
      "transport": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**Legacy STDIO transport** (deprecated, use only if HTTP is not supported):
```json
{
  "mcpServers": {
    "overlay-companion": {
      "command": "/path/to/overlay-companion-mcp",
      "args": ["--stdio"]
    }
  }
}
```

### Available Tools
- Screen capture, overlays, multi-monitor info
- Input simulation and clipboard tools
- Human-in-the-loop confirmations

Note: Wayland is preferred with X11 fallback. See SPECIFICATION.md for platform integration details.

For complete tool documentation, see [MCP_SPECIFICATION.md](MCP_SPECIFICATION.md).

## Development

**Contributors and AI agents:** See [DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md) for development environment setup.

## Troubleshooting

### AppImage Issues

#### "Setup was already called on one of AppBuilder instances" Error

**Fixed in v2025.08.22.2+**: This Avalonia double initialization error has been resolved with proper lifetime management.

**Symptoms:**
- HTTP server starts successfully on port 3000
- Error occurs during GUI initialization
- Application crashes with Avalonia setup error

**Solution:**
- **Update to latest AppImage** (v2025.08.22.4 or newer)
- For older versions, temporary workaround: `HEADLESS=1 ./overlay-companion-mcp.AppImage` (testing mode only)

#### GUI Not Starting

**Desktop Environment:**
- Ensure you're running in a desktop environment (GNOME, KDE, XFCE, etc.)
- Check that `$DISPLAY` is set (X11) or Wayland compositor is running
- Try: `./overlay-companion-mcp.AppImage --gui` to force GUI mode

**Headless Environment:**
- Use `HEADLESS=1` environment variable or `--no-gui` flag
- HTTP transport will work without GUI: `http://localhost:3000/mcp`

#### Native Library Issues

**libSkiaSharp/libHarfBuzzSharp errors:**
- Update to AppImage v2025.08.22.4+ (includes all native dependencies and fixes)
- For manual builds, ensure native libraries are in LD_LIBRARY_PATH

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
