# Cold Storage Workflows

This directory contains GitHub Actions workflows that are no longer actively used but are preserved for historical reference or potential future use.

## Workflows in Cold Storage

### build-appimage.yml
- **Status**: Disabled
- **Reason**: Project has migrated to containerized deployment with KasmVNC architecture
- **Alternative**: Use `host-setup-kasmvnc.sh` for installation instead
- **Last Active**: Before KasmVNC migration
- **Notes**: AppImage builds are no longer the primary deployment method. The project now uses:
  - Container-based deployment (4 containers: MCP Server, Web Interface, KasmVNC, Caddy Proxy)
  - No database required (YAML configuration instead of PostgreSQL)
  - True multi-monitor support via KasmVNC
  - Modern web-native protocols (WebSocket/WebRTC)

## Restoring a Workflow

To restore a workflow from cold storage:

1. Move the workflow file back to `.github/workflows/`
2. Update any outdated dependencies or actions
3. Test thoroughly before enabling
4. Update documentation to reflect the restored functionality

## Security Note

All workflows in cold storage have been reviewed for security issues. If restoring a workflow, ensure it includes proper `permissions` declarations following the principle of least privilege.