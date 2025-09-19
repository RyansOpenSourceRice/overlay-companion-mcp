# Overlay Companion MCP - Development Roadmap

## 🎯 Current Status (v1.0.0)

### ✅ **COMPLETED - Core Functionality**
- **MCP Protocol**: Full HTTP transport implementation (primary) with 13 working tools
- **Transport Layer**: Native HTTP transport with image support, multi-client capability
- **Legacy Support**: STDIO transport (deprecated) for backward compatibility
- **Overlay System**: Web-only viewer with MockOverlayWindow for server-side tracking; no native desktop GUI
- **Screenshot Capture**: Working with Linux tools (scrot/gnome-screenshot)
- **Input Simulation**: Click and type functionality implemented
- **Mode Management**: 4 modes (passive, assist, autopilot, composing) with proper state management
- **Session Management**: Status checking and lifecycle management
- **Clipboard Operations**: Basic set/get functionality
- **Event System**: Subscribe/unsubscribe for real-time updates
- **Batch Operations**: Multiple overlay operations in single call

### ✅ **COMPLETED - Infrastructure**
- **Build System**: .NET 8.0 with single-file publishing
- **Testing Framework**: Comprehensive functional testing with McpRawJsonClient
- **Documentation**: Complete MCP specification and usage examples
- **CI/CD Ready**: Automated builds and testing infrastructure

---

## 🚀 **HIGH PRIORITY - Missing Core Features**

### 1. **Multi-Monitor Support** 🖥️🖥️
**Status**: Planned but not implemented  
**Impact**: Critical for professional/enterprise use  
**Current Limitation**: All operations assume single monitor (index 0)

**Implementation Needed**:
- **`get_display_info` tool**: Return monitor count, resolutions, positions, primary monitor
- **Enhanced `CaptureMonitorAsync`**: Proper multi-monitor screenshot capture
- **Monitor-aware overlays**: Coordinate mapping across multiple displays
- **Display detection**: Runtime discovery of monitor configuration changes

**Technical Details**:
```csharp
// Current TODO in ScreenCaptureService.cs:
MonitorIndex = 0, // TODO: Implement multi-monitor detection
// TODO: Implement proper multi-monitor support
```

**Use Cases**:
- Developers with multiple monitors
- Trading/financial applications
- Design/creative workflows
- Enterprise environments

### 2. **Missing MCP Tools** 🔧
**Status**: Documented but not implemented  
**Impact**: Specification compliance issue

**Missing Tools**:
- **`re_anchor_element`**: Re-locate UI elements after viewport changes/scrolling
- **`get_display_info`**: Retrieve display configuration (overlaps with multi-monitor)

**Current**: 13/15 documented tools implemented

### 3. **HTTP Transport Enhancement** 🌐
Status: Implemented (native HTTP transport via ModelContextProtocol.AspNetCore). Bridge removed.
Impact: Future-proofing and web integration

**Benefits of HTTP Transport**:
- **Multi-client support**: Multiple MCP clients can connect simultaneously
- **Web integration**: Browser-based MCP clients can connect directly
- **Session management**: Persistent connections and state
- **Streaming responses**: Large image data can be streamed efficiently
- **Authentication**: Built-in auth support for secure deployments
- **CORS support**: Cross-origin requests for web applications

**Implementation Plan**:
```csharp
// Use ModelContextProtocol.AspNetCore for native HTTP
builder.Services
    .AddMcpServer()
    .WithHttpTransport()  // Native HTTP, not bridge
    .WithToolsFromAssembly();

app.MapMcp();  // Registers /mcp endpoint with streaming support
```

---

## 🔄 **MEDIUM PRIORITY - Enhancements**

### 4. **Advanced Screenshot Verification** 📸
- **Image processing**: Detect overlays in screenshots using OpenCV
- **Template matching**: Verify UI elements are correctly highlighted
- **Color analysis**: Robust overlay detection beyond simple color checks

### 5. **Scenario-Based Testing** 📋
- **YAML test scenarios**: Wire up `tests/ai-gui/scenarios/basic.yaml`
- **Automated workflows**: End-to-end testing of complex interaction sequences
- **Performance benchmarks**: Latency and throughput testing

### 6. **Performance Optimization** ⚡
- **Persistent connections**: Avoid process-per-request overhead
- **Connection pooling**: Efficient resource management
- **Streaming responses**: Large image data handling
- **Caching**: Screenshot and overlay state caching

---

## 🔮 **FUTURE ENHANCEMENTS**

### 7. **Advanced Input Simulation** 🖱️⌨️
- **Drag and drop**: Complex gesture support
- **Keyboard shortcuts**: Multi-key combinations
- **Mouse gestures**: Right-click, scroll, hover
- **Touch simulation**: For touch-enabled displays

### 8. **AI Integration Features** 🤖
- **OCR integration**: Text extraction from screenshots
- **Element detection**: Automatic UI element recognition
- **Smart anchoring**: ML-based element re-location
- **Accessibility integration**: Screen reader compatibility

### 9. **Enterprise Features** 🏢
- **Authentication**: User-based access control
- **Audit logging**: Complete action history
- **Policy enforcement**: Configurable safety restrictions
- **Remote deployment**: Docker/cloud-native support

### 10. **Cross-Platform Support** 🌍
- **Windows support**: Native Windows overlay and capture
- **macOS support**: Native macOS implementation
- **Mobile support**: Android/iOS screen interaction

---

## 📋 **Implementation Priority Matrix**

| Feature | Priority | Effort | Impact | Dependencies |
|---------|----------|--------|--------|--------------|
| Multi-Monitor Support | **HIGH** | Medium | High | get_display_info tool |
| Missing MCP Tools | **HIGH** | Low | Medium | None |
| HTTP Transport | **HIGH** | Medium | High | ModelContextProtocol.AspNetCore |
| Screenshot Verification | Medium | Low | Medium | OpenCV integration |
| Scenario Testing | Medium | Medium | Medium | YAML parser |
| Performance Optimization | Medium | High | Medium | Architecture changes |
| Advanced Input | Low | High | Medium | Platform-specific APIs |
| AI Integration | Low | Very High | High | ML/OCR libraries |
| Enterprise Features | Low | Very High | High | Security framework |
| Cross-Platform | Low | Very High | Very High | Platform abstraction |

---

## 🛠️ **Technical Implementation Notes**

### Multi-Monitor Implementation Strategy:
1. **Linux**: Prefer Wayland compositor APIs (hyprctl, swaymsg, wayland-info) with X11 `xrandr` as fallback
2. **Cross-platform**: Abstract monitor detection behind `IDisplayService`
3. **Coordinate mapping**: Transform screen coordinates between monitors
4. **Overlay positioning**: Ensure overlays appear on correct monitor

### HTTP Transport Implementation:
1. Primary: Native HTTP using `ModelContextProtocol.AspNetCore` at root `/` with SSE
2. Legacy: Optional STDIO (`--stdio`) for testing/compat; not recommended
3. Web UI served at `/`; config endpoints at `/setup`, `/config`

### Missing Tools Implementation:
1. **`get_display_info`**: Return monitor configuration, resolutions, scaling
2. **`re_anchor_element`**: Use screenshot comparison to relocate UI elements

---

## 📅 **Recommended Implementation Order**

### Phase 1: Complete Core (1-2 weeks)
1. Implement missing `re_anchor_element` and `get_display_info` tools
2. Add basic multi-monitor detection and display info
3. Fix HTTP bridge or implement native HTTP transport

### Phase 2: Production Ready (2-3 weeks)  
1. Enhanced screenshot verification with image processing
2. Comprehensive scenario-based testing
3. Performance optimization and persistent connections

### Phase 3: Advanced Features (1-2 months)
1. Full multi-monitor support with coordinate mapping
2. Advanced input simulation (drag/drop, gestures)
3. Cross-platform support (Windows/macOS)

### Phase 4: Enterprise/AI Integration (3-6 months)
1. OCR and AI-powered element detection
2. Enterprise security and audit features
3. Cloud-native deployment options

---

## 🎯 **Next Immediate Actions**

Based on your feedback, the immediate priorities are:

1. **✅ Multi-Monitor**: Add to roadmap (documented above)
2. **🔧 HTTP Transport**: Implement native HTTP alongside STDIO
3. **📋 Missing Tools**: Complete the specification with remaining 2 tools

**Recommendation**: Start with HTTP transport implementation since you identified it as needed, then add multi-monitor support as the next major feature.

---
## Appendix: Historical updates (consolidated)
## Recent Updates - Overlay Companion MCP

## Summary of Changes

This document outlines the recent improvements made to address the GitHub Actions error, add update functionality, and containerize the C# MCP server.

## 🔧 Issues Fixed

### 1. GitHub Actions Permissions Error
**Problem**: GitHub Actions workflow was failing with "Workflow does not contain permissions" error.

**Solution**: Added explicit permissions block to `.github/workflows/release-package.yml`:
```yaml
permissions:
  contents: write
  actions: read
  packages: write
```

This grants the workflow the necessary permissions to create releases and upload artifacts.

### 2. Install Script Update Capability
**Problem**: No way to update existing installations without reinstalling the entire system.

**Solution**: Added `--update` flag to `install.sh`:
- Skips OS and dependency checks
- Stops existing services gracefully
- Rebuilds container images with new code
- Re-provisions infrastructure with updates
- Preserves existing VM and data

**Usage**:
```bash
./install.sh --update
```

### 3. C# MCP Server Containerization
**Problem**: C# MCP server was not containerized, making deployment and integration complex.

**Solution**: Created complete containerization solution:

#### New Dockerfile (`Dockerfile.mcp-server`)
- Based on .NET 8.0 runtime
- Includes X11 support for headless screen capture
- Virtual display with Xvfb
- Security-hardened with non-root user
- Health checks and proper signal handling

#### OpenTofu Integration
- Automatic container building when C# source is available
- Conditional deployment based on image existence
- Integrated with existing podman-compose stack

#### Management Server Integration
- Added MCP server proxy endpoint (`/mcp/*`)
- Health monitoring of C# MCP server
- Seamless integration with existing web interface

## 🏗️ Architecture Improvements

### Container Stack
The system now includes these containers:
1. **PostgreSQL** - Database for Guacamole
2. **Guacd** - Guacamole daemon
3. **Guacamole** - Web-based remote desktop
4. **Management Server** - Node.js web interface and proxy
5. **C# MCP Server** - AI screen interaction engine (new)

### Network Architecture
```
Cherry Studio → Management Server (/mcp/*) → C# MCP Server
                     ↓
              Web Interface ← Guacamole ← Fedora VM
```

### Update Process
1. **Graceful Shutdown**: Stops services without data loss
2. **Image Refresh**: Rebuilds containers with latest code
3. **Infrastructure Update**: Re-provisions with OpenTofu
4. **Service Restart**: Brings everything back online
5. **Health Verification**: Confirms all services are healthy

## 🚀 Usage Examples

### Fresh Installation
```bash
## Standard installation
./install.sh

## With LAN exposure (security risk)
./install.sh --expose-lan
```

### Update Existing Installation
```bash
## Update containers and services
./install.sh --update

## Update with LAN exposure
./install.sh --update --expose-lan
```

### Health Monitoring
```bash
## Check system health
curl http://localhost:8080/health

## Check MCP server specifically
curl http://localhost:8080/mcp/health
```

## 🔒 Security Considerations

### Container Security
- C# MCP server runs as non-root user
- Minimal attack surface with Alpine-based images
- Isolated X11 display for screen capture
- Health checks prevent resource leaks

### Network Security
- Host-only networking by default
- Optional LAN exposure with explicit warnings
- Firewall automation with secure defaults
- Container network isolation

### Update Security
- Preserves existing security configurations
- No OS-level changes during updates
- Container image verification
- Graceful rollback on failure

## 📊 Performance Impact

### Positive Improvements
- **Container Isolation**: Better resource management
- **Image Caching**: Faster subsequent deployments
- **Incremental Updates**: Only changed components rebuilt
- **Health Monitoring**: Proactive issue detection

### Resource Usage
- **Additional Memory**: ~200MB for C# MCP server container
- **Storage**: ~500MB for container images
- **CPU**: Minimal overhead from containerization
- **Network**: Internal container communication only

## 🔄 Migration Path

### From Previous Versions
1. **Backup Data**: VM and configuration data preserved automatically
2. **Run Update**: `./install.sh --update`
3. **Verify Services**: Check health endpoints
4. **Test Integration**: Confirm MCP functionality

### Rollback Procedure
If issues occur during update:
1. Stop services: `cd ~/.config/overlay-companion-mcp && podman-compose down`
2. Restore previous images: `podman image list` and `podman tag`
3. Restart with previous configuration
4. Report issues with log files

## 📝 Configuration Changes

### Environment Variables
New variables added to management container:
- `MCP_SERVER_URL`: URL of C# MCP server (default: http://localhost:8081)
- `ASPNETCORE_URLS`: C# server binding (default: http://0.0.0.0:8081)
- `DISPLAY`: X11 display for screen capture (default: :99)

### Port Allocation
- **8080**: Management web interface
- **8081**: C# MCP server (new)
- **5432**: PostgreSQL (internal)
- **4822**: Guacd (internal)

### Volume Mounts
New persistent storage:
- `~/.local/share/overlay-companion-mcp/mcp-server/`: C# server data
- `/tmp/.X11-unix`: X11 socket sharing (read-write)

## 🧪 Testing

### Automated Tests
- Container build verification
- Service health checks
- Network connectivity tests
- Update process validation

### Manual Testing
1. **Fresh Install**: Verify complete deployment
2. **Update Process**: Test update without data loss
3. **MCP Integration**: Confirm Cherry Studio connectivity
4. **VM Access**: Test Guacamole remote desktop
5. **Health Monitoring**: Verify all endpoints respond

## 📚 Documentation Updates

### Updated Files
- `ARCHITECTURE.md`: Container architecture details
- `DEPLOYMENT.md`: Update procedures
- `README.md`: New usage examples
- `UPDATES.md`: This document

### New Documentation
- Container deployment guide
- Update troubleshooting
- Security configuration
- Performance tuning

## 🎯 Next Steps

### Immediate
- [ ] Test complete installation flow on fresh Fedora system
- [ ] Verify C# MCP server integration with Cherry Studio
- [ ] Validate update process with existing installations

### Future Enhancements
- [ ] HTTPS support with Let's Encrypt
- [ ] Authentication and user management
- [ ] Monitoring and alerting
- [ ] Multi-user support
- [ ] Cloud deployment options

## 🐛 Known Issues

### Current Limitations
- C# source code must be present for MCP server container
- Update process requires internet connectivity
- VM state not preserved during infrastructure updates
- Limited error recovery during updates

### Workarounds
- Manual container building if source unavailable
- Offline update support planned for future release
- VM snapshot/restore functionality in development
- Enhanced error handling and rollback procedures

## 📞 Support

### Getting Help
- Check health endpoints: `curl http://localhost:8080/health`
- Review log files: `/tmp/overlay-companion-mcp-install.log`
- Container logs: `podman logs <container-name>`
- GitHub Issues: Report problems with log files attached

### Common Issues
1. **Permission Errors**: Ensure user in podman group
2. **Port Conflicts**: Check for existing services on ports 8080/8081
3. **Memory Issues**: Verify 8GB+ RAM available
4. **Network Issues**: Confirm firewall allows container communication

---

**Last Updated**: 2025-08-26  
**Version**: 1.0.0  
**Compatibility**: Fedora Linux, RHEL/CentOS (experimental)
