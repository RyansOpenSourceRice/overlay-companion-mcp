# Overlay Companion MCP - Test Suite

This directory contains comprehensive testing scripts and reports for validating the Overlay Companion MCP server in headless Docker environments.

## Test Scripts

### Primary Test Scripts

- **`test_gui_streamable_http.py`** - **RECOMMENDED** Modern Streamable HTTP transport test (MCP 2025-03-26 spec)
  - Uses the current MCP standard (Streamable HTTP)
  - Replaces deprecated HTTP+SSE transport
  - Single endpoint, better resumability
  - Ready for when .NET MCP SDK fully supports 2025-03-26 spec

- **`test_gui_stdio.py`** - STDIO transport test (legacy, for comparison)
  - Uses STDIO transport (deprecated as of March 2025)
  - Useful for local debugging only
  - **NOT recommended for production or modern development**

- **`test_gui_overlays.py`** - Earlier iteration of GUI tests

### Test Coverage

All test scripts validate:
- ✅ Display information retrieval
- ✅ Text overlay creation and rendering
- ✅ Screenshot capture
- ✅ Mouse click simulation
- ✅ Keyboard input simulation
- ⚠️  Clipboard operations (requires headless configuration)
- ⚠️  Overlay removal (JSON parsing issues)

## Test Reports

- **`GUI_TEST_REPORT.md`** - **PRIMARY REPORT** - Comprehensive test results and analysis
- **`COMPREHENSIVE_TEST_REPORT.md`** - Detailed test environment documentation
- **`TEST_REPORT.md`** - Initial test findings
- **`TESTING_SUMMARY_FOR_USER.md`** - User-friendly summary
- **`VM_TESTING_RESEARCH.md`** - Research on VNC/VM testing approaches

## Test Environment Setup

### Prerequisites

```bash
# Install required packages
apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    fluxbox \
    python3 \
    python3-pip

# Install Python dependencies
pip3 install requests
```

### Start Test Environment

```bash
# 1. Start Xvfb (virtual display)
Xvfb :99 -screen 0 1920x1080x24 &

# 2. Start window manager
DISPLAY=:99 fluxbox &

# 3. Start VNC server
x11vnc -display :99 -forever -shared -rfbport 5900 -passwd vncpass &

# 4. (Optional) Start noVNC for web access
# See GUI_TEST_REPORT.md for noVNC setup
```

### Run Tests

```bash
# Start MCP server with HTTP transport
cd /workspace/overlay-companion-mcp/src
DISPLAY=:99 dotnet run -c Release -- --http

# In another terminal, run tests
cd /workspace/overlay-companion-mcp/tests

# Run Streamable HTTP tests (RECOMMENDED)
python3 test_gui_streamable_http.py

# Or run STDIO tests (legacy)
python3 test_gui_stdio.py
```

## Visual Verification

Tests can be visually verified via:

- **VNC Client:** `vnc://localhost:5900` (password: vncpass)
- **Web Browser:** `http://localhost:6901` (if noVNC configured)
- **Screenshots:** Saved to `./gui_test_results/`

## MCP Transport Evolution

### Timeline

1. **STDIO** (Original)
   - Stdin/stdout communication
   - Good for local debugging
   - **DEPRECATED** as of March 2025
   - ❌ Not recommended for modern development

2. **HTTP + SSE** (Server-Sent Events)
   - HTTP with event streaming
   - **DEPRECATED** as of March 2025 (protocol version 2025-03-26)
   - ❌ Being phased out

3. **Streamable HTTP** (Current Standard)
   - Modern MCP transport (2025-03-26 spec)
   - Single endpoint (`POST /mcp`)
   - Better resumability and stateless support
   - ✅ **RECOMMENDED** for all new development

### Current Server Status

The Overlay Companion MCP server currently implements:
- ✅ STDIO transport (legacy, works but deprecated)
- ✅ HTTP+SSE transport (pre-2025-03-26 spec, works but deprecated)
- ⏳ Streamable HTTP (awaiting .NET MCP SDK update to 2025-03-26 spec)

## Test Results Summary

### STDIO Transport (Legacy)
- **Status:** 4/7 tests passing (57.1%)
- **Grade:** C
- **Working:** Display Info, Text Overlay, Mouse Click, Keyboard Input
- **Failing:** Screenshot parsing, Clipboard ops, Remove overlay

### HTTP Transport (Current)
- **Status:** Server uses HTTP+SSE (pre-2025-03-26)
- **Note:** Streamable HTTP test script ready for SDK update

## Known Issues

1. **Screenshot Test** - Server returns valid PNG data, test parsing needs fix
2. **Clipboard Operations** - Requires headless environment configuration
3. **Remove Overlay** - JSON response format inconsistency
4. **Transport Deprecation** - STDIO and HTTP+SSE deprecated, need Streamable HTTP

## Recommendations

1. ✅ Use `test_gui_streamable_http.py` for modern testing
2. ❌ Avoid STDIO transport for new development
3. 🔧 Fix screenshot test parsing logic
4. 🔧 Configure clipboard for headless environments
5. 🔧 Update to Streamable HTTP when .NET MCP SDK supports 2025-03-26 spec

## Contributing

When adding new tests:
1. Use Streamable HTTP transport (not STDIO or SSE)
2. Follow the test structure in `test_gui_streamable_http.py`
3. Update this README with new test coverage
4. Document findings in test reports

## References

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP Transport Evolution](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/)
- [Streamable HTTP Transport](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/#streamable-http)
