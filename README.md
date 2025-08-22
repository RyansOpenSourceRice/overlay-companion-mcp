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

> **Note**: AppImages from v2025.08.22+ include all necessary native dependencies (libSkiaSharp, libHarfBuzzSharp) for proper GUI functionality. Earlier versions may experience GUI initialization issues.

### System Requirements
- Linux (Wayland preferred; X11 supported as fallback)
- Wayland compositor (e.g., GNOME, KDE, Sway, Hyprland)
- Recommended tools: grim (Wayland), gnome-screenshot/spectacle; scrot/maim (X11 fallback)
- Clipboard: wl-clipboard (wl-copy/wl-paste) recommended; xclip as X11 fallback

- Modern desktop environment (GNOME, KDE, XFCE, etc.)

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
