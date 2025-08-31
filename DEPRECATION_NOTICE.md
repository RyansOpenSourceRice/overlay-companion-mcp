# Deprecation Notice: Guacamole Architecture

## ⚠️ Important: Guacamole-based Components are Deprecated

The Guacamole-based architecture has been **DEPRECATED** in favor of the new **KasmVNC architecture**. This change provides significant improvements in functionality, simplicity, and performance.

## Why the Change?

### Issues with Guacamole Architecture
- **Complex Database Setup**: Requires PostgreSQL with complex schema initialization
- **Single Canvas Limitation**: No true multi-monitor support (GUACAMOLE-288 still open)
- **Resource Heavy**: Uses 6 containers instead of 4 (50% more overhead)
- **Legacy Protocols**: Relies on VNC/RDP bridging instead of modern web-native protocols
- **Complex Credential Management**: Database-driven user management adds complexity

### Benefits of KasmVNC Architecture
✅ **No Database Required**: YAML-based configuration eliminates PostgreSQL complexity  
✅ **True Multi-Monitor Support**: Native multi-monitor with separate browser windows  
✅ **33% Fewer Containers**: 4 containers instead of 6 (reduced resource usage)  
✅ **Modern Web-Native**: Built for browsers with WebSocket/WebRTC protocols  
✅ **Simpler Configuration**: No database schemas or complex credential setup  
✅ **Better Performance**: Direct web protocols instead of legacy bridging

## Deprecated Components

### Scripts
- `host-setup.sh` → Use `host-setup-kasmvnc.sh`
- `vm-setup.sh` → Use `vm-setup-kasmvnc.sh`

### Container Configurations
- `infra/podman-compose.yml` → Use `infra/kasmvnc-compose.yml`
- `release/containers/podman-compose.yml` → Use KasmVNC-based configuration

### Web Components
- `infra/web/src/components/GuacamoleClient.js` → Use `KasmVNCClient.js`
- `release/containers/web/src/index.js` → Use KasmVNC-based web interface

### Infrastructure
- `release/opentofu/main.tf` → Create new KasmVNC-based infrastructure

## Migration Path

### For New Installations
Use the KasmVNC setup exclusively:
```bash
# Host setup
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/host-setup-kasmvnc.sh | bash

# VM setup
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/vm-setup-kasmvnc.sh | bash
```

### For Existing Installations
1. **Backup your data** (if any custom configurations exist)
2. **Stop existing containers**: `podman-compose down`
3. **Switch to KasmVNC setup**: Use the new setup scripts
4. **Test multi-monitor functionality**: Verify improved multi-monitor support

## Timeline

- **Current Status**: Guacamole components marked as deprecated with runtime warnings
- **Maintenance**: Guacamole components will receive security fixes only
- **Future Removal**: Guacamole components may be removed in a future major version

## Support

- **KasmVNC Architecture**: Full support and active development
- **Guacamole Architecture**: Security fixes only, no new features

## Architecture Comparison

| Feature | Guacamole (Deprecated) | KasmVNC (Current) |
|---------|----------------------|-------------------|
| Database | PostgreSQL required | None (YAML config) |
| Containers | 6 containers | 4 containers |
| Multi-Monitor | Single canvas | Separate windows |
| Protocols | VNC/RDP bridging | WebSocket/WebRTC |
| Setup Complexity | High | Low |
| Credential Management | Database-driven | Simple configuration |
| Performance | Legacy bridging | Native web protocols |

## Questions?

If you have questions about the migration or need assistance with the KasmVNC setup, please:
1. Check the updated documentation in `README.md`
2. Review the multi-monitor setup guide in `MULTI_MONITOR_SETUP.md`
3. Open an issue on the repository

---

**Note**: This deprecation notice will be updated as the migration progresses and Guacamole components are eventually removed.