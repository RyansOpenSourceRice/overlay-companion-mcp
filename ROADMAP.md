# Overlay Companion MCP - Development Roadmap

## 🎯 Current Status (v1.0.0)

### ✅ **COMPLETED - Core Functionality**
- **MCP Protocol**: Full HTTP transport implementation (primary) with 13 working tools
- **Transport Layer**: Native HTTP transport with image support, multi-client capability
- **Legacy Support**: STDIO transport (deprecated) for backward compatibility
- **Overlay System**: Complete with MockOverlayWindow for headless and AvaloniaOverlayWindow for GUI
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
**Status**: Bridge implementation exists, needs proper HTTP transport  
**Impact**: Future-proofing and web integration

**Current Implementation**: HTTP-to-STDIO bridge (functional but not optimal)
**Needed**: Native HTTP transport using `ModelContextProtocol.AspNetCore`

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
1. **Keep STDIO**: Maintain existing stdio transport (it's working perfectly)
2. **Add HTTP**: Implement native HTTP using `ModelContextProtocol.AspNetCore`
3. **Dual mode**: Support both transports simultaneously
4. **Configuration**: Runtime selection via command-line flags

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
4. Enhanced screenshot verification with image processing
5. Comprehensive scenario-based testing
6. Performance optimization and persistent connections

### Phase 3: Advanced Features (1-2 months)
7. Full multi-monitor support with coordinate mapping
8. Advanced input simulation (drag/drop, gestures)
9. Cross-platform support (Windows/macOS)

### Phase 4: Enterprise/AI Integration (3-6 months)
10. OCR and AI-powered element detection
11. Enterprise security and audit features
12. Cloud-native deployment options

---

## 🎯 **Next Immediate Actions**

Based on your feedback, the immediate priorities are:

1. **✅ Multi-Monitor**: Add to roadmap (documented above)
2. **🔧 HTTP Transport**: Implement native HTTP alongside STDIO
3. **📋 Missing Tools**: Complete the specification with remaining 2 tools

**Recommendation**: Start with HTTP transport implementation since you identified it as needed, then add multi-monitor support as the next major feature.