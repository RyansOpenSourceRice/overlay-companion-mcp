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

### System Requirements
- Linux (Wayland preferred; X11 supported as fallback)
- Wayland compositor (e.g., GNOME, KDE, Sway, Hyprland)
- Recommended tools: grim (Wayland), gnome-screenshot/spectacle; scrot/maim (X11 fallback)
- Modern desktop environment (GNOME, KDE, XFCE, etc.)

## Usage

### MCP Integration
Configure with Jan.ai or other MCP-compatible AI clients:

```json
{
  "mcpServers": {
    "overlay-companion": {
      "command": "/path/to/overlay-companion-mcp",
      "args": ["--mcp"]
    }
  }
}
```

### Available Tools
- Screen capture (Wayland-first via grim/spectacle/gnome-screenshot; X11 fallback via scrot/maim)
- Overlay drawing for visual feedback
- Multi-monitor info (Wayland via swaymsg/hyprctl; X11 fallback via xrandr/xdpyinfo)
- Input simulation (Wayland via wtype; X11 fallback via xdotool)
- Clipboard access (Wayland via wl-copy/wl-paste; X11 fallback via xclip)
- Human-in-the-loop confirmation for actions

For complete tool documentation, see [MCP_SPECIFICATION.md](MCP_SPECIFICATION.md).

### Wayland-first stack (X11 fallback)
- Clipboard: wl-clipboard (wl-copy, wl-paste) → fallback: xclip
- Typing: wtype → fallback: xdotool
- Screenshots: grim (+ slurp for region) or gnome-screenshot/spectacle → fallback: scrot/maim/ImageMagick import
- Display info: swaymsg, hyprctl → fallback: xrandr, xdpyinfo

### Clipboard round-trip with MCP
- Read clipboard in the AI agent: call MCP tool get_clipboard; the app prefers Wayland wl-paste and falls back to xclip.
- Write clipboard from the AI agent: call MCP tool set_clipboard with text; the app prefers wl-copy and falls back to xclip.
- Safety: Clipboard tools respect the current mode; in Assist/Autopilot, set_clipboard may require confirmation depending on settings.

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
