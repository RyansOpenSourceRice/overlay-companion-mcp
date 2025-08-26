# Overlay Companion (MCP) - MCP Protocol Specification

*A general-purpose, human-in-the-loop AI-assisted screen interaction toolkit.*

---

## Overview & Purpose

**Overlay Companion (MCP)** is a desktop-based Model Context Protocol (MCP) server designed to facilitate context-aware, human-assisted UI interactions across arbitrary applications—not tied to any specific use case such as job applications. Its primary goal is to provide a **safe, extendable, and vendor-agnostic interface** enabling AI agents (via Cherry Studio or others) to:

- Draw overlays (highlight, label, annotate) on the screen using an OS-level transparent window.
- Capture screenshots in a controlled, high-performance manner.
- Emulate user input (clicks and typing) under safely defined policies.
- Operate in distinct modes ("passive", "assist", "autopilot", "composing") for flexible control over automation and human consent.
- Be the foundation for more specialized workflows, such as job application assistants, without embedding that logic into the core tool.

### Design Principles

- **Human-in-the-loop by default** — no automated actions unless explicitly enabled per mode or user confirmation.
- **Mode-aware behavior** — switching modes adjusts behavior (e.g. clicking automatically vs. suggesting).
- **Privacy-respecting** — screenshots can be scrubbed before being shared; clipboard access controlled by user permission.
- **Multi-monitor and DPI-aware** — avoids overlay misplacement in complex setups (planned for future implementation).
- **Rate-limited calls** — protects local and remote inference systems from overload and keeps operations low-latency.

### Extension Strategy

This repository is intended to serve as a **public, reusable base tool**. Domain-specific workflows (e.g., job applications, form filling, cover letter generation) should be built as **separate, private MCP servers** that integrate with this tool. For example:

- The public MCP server handles overlays, screenshots, input simulation, and modes.
- A private "Job-Helper MCP server" uses these tools to focus and orchestrate job application logic.
- This keeps your public repo generic, avoiding naming conflicts or policy concerns related to job automation on GitHub.

---

## MCP Protocol Implementation

### Server Information

- **Name**: `overlay-companion-mcp`
- **Version**: `1.0.0`
- **Description**: General-purpose, human-in-the-loop AI-assisted screen interaction toolkit
- **Protocol**: MCP server with native HTTP transport (default)
- **Primary Transport**: Native HTTP transport using ModelContextProtocol.AspNetCore
  - **Port**: 3000 (configurable)
  - **Features**: Server-Sent Events streaming, multi-client support, CORS enabled, **image handling**
  - **Benefits**: Web integration, session management, real-time streaming, concurrent clients, binary data support
- **Legacy Transport**: Standard I/O (stdio) - **DEPRECATED** (use `--stdio` flag)
  - **Limitations**: No image support, single client only, legacy compatibility only
- **SDK**: Official ModelContextProtocol C# SDK v0.3.0-preview.3
- **Framework**: .NET 8.0 with Microsoft.Extensions.Hosting
- **Protocol Version**: 2024-11-05

### Capabilities

- **Tools**: Provides 15 tools for screen interaction
- **Resources**: None
- **Prompts**: None
- **Sampling**: None

### Error Handling

The server implements standard MCP error responses:

- **-32700**: Parse error
- **-32600**: Invalid request
- **-32601**: Method not found
- **-32602**: Invalid parameters
- **-32603**: Internal error

### Rate Limiting

- Screenshot operations: Maximum 10 per second
- Input simulation: Maximum 5 per second
- Overlay operations: Maximum 20 per second

### Security Model

- **Human confirmation required** for input simulation in most modes
- **Mode-based permissions** control automation level
- **No network access** - purely local operations
- **Clipboard access** requires explicit user permission

### Operational Modes

1. **Passive**: Read-only operations (screenshots, overlays)
2. **Assist**: Suggests actions, requires confirmation
3. **Autopilot**: Automated actions with safety checks
4. **Composing**: Specialized mode for text composition
5. **Custom**: User-defined behavior

## Connection Configuration

### Cherry Studio Configuration (HTTP Transport - Recommended)
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

### Configuration Helper Endpoints

When the application is running with HTTP transport, it provides helpful configuration endpoints:

- **Web UI**: `http://localhost:3000/setup` - Interactive configuration interface with one-click copy
- **JSON Config**: `http://localhost:3000/config` - Ready-to-use JSON configuration
- **Legacy STDIO**: `http://localhost:3000/config/stdio` - STDIO transport configuration (deprecated)

These endpoints include proper metadata (description, tags, provider info) for better integration with MCP clients.

---

## Modes and Safety

- Modes: passive (read‑only), assist (confirmation required), autopilot (guard‑railed automation)
- Input simulation is gated by mode and can require explicit user confirmation
- CORS configured; TLS terminates at reverse proxy (Caddy)
- Planned: per‑viewer JWTs for overlay WS and session scoping

---

### Claude Desktop Configuration (HTTP Transport - Recommended)
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

### Legacy STDIO Configuration (Deprecated)
**⚠️ STDIO transport is deprecated and lacks image support. Use HTTP transport above.**

```json
{
  "mcpServers": {
    "overlay-companion": {
      "command": "/path/to/overlay-companion-mcp",
      "args": ["--stdio"],
      "env": {}
    }
  }
}
```

## Operational Modes

The server operates in different modes that control automation behavior:

- **Passive**: No automated actions, only provides information
- **Assist**: Suggests actions but requires user confirmation
- **Autopilot**: Automated actions with safety confirmations
- **Composing**: Optimized for text generation and form filling

## Tools

### 1. draw_overlay

**Title:** Draw overlay box  
**Mode:** async

Draws a visual overlay (highlight, label, annotation) on the screen using an OS-level transparent window.

**Parameters:**
- `x` (number, required): X coordinate for the overlay
- `y` (number, required): Y coordinate for the overlay  
- `width` (number, required): Width of the overlay
- `height` (number, required): Height of the overlay
- `color` (string, optional): Color of the overlay (default: yellow)
- `label` (string, optional): Text label for the overlay
- `annotation_type` (string, optional): Type of annotation (box, text, arrow, icon)
- `temporary_ms` (number, optional): Auto-remove overlay after specified milliseconds
- `anchor_id` (string, optional): Unique identifier for element tracking across frames

**Returns:**
- `overlay_id` (string): Unique identifier for the created overlay
- `bounds` (object): Actual bounds of the overlay with x, y, width, height
- `monitor_index` (number): Index of the monitor where overlay was drawn
- `display_scale` (number): Display scale factor for the monitor
- `anchor_id` (string): Element anchor ID if provided

### 2. remove_overlay

**Title:** Remove overlay  
**Mode:** sync

Removes a previously created overlay from the screen.

**Parameters:**
- `overlay_id` (string, required): ID of the overlay to remove

**Returns:**
- `removed` (boolean): Whether the overlay was successfully removed
- `not_found` (boolean): Whether the overlay ID was not found

### 3. take_screenshot

**Title:** Take screenshot  
**Mode:** async

Captures a screenshot of the screen or a specific region in a controlled, high-performance manner.

**Parameters:**
- `region` (object, optional): Specific region to capture with x, y, width, height
- `full_screen` (boolean, optional): Whether to capture the full screen
- `scale` (number, optional): Scale factor for the screenshot
- `wait_for_stable_ms` (number, optional): Wait time for UI to stabilize before capture
- `monitor_index` (number, optional): Specific monitor to capture from
- `scrub_mask_rects` (array, optional): Array of rectangles to obscure for privacy

**Returns:**
- `image_base64` (string): Base64-encoded screenshot image
- `width` (number): Width of the captured image
- `height` (number): Height of the captured image
- `region` (object): Actual region that was captured
- `monitor_index` (number): Index of the monitor that was captured
- `display_scale` (number): Display scale factor used
- `viewport_scroll` (object): Viewport scroll position with x, y coordinates
- `timestamp` (number): Timestamp when screenshot was taken
- `context_metadata` (object): Additional context information

### 4. click_at

**Title:** Simulate click  
**Mode:** sync

Emulates user input by simulating mouse clicks at specified coordinates.

**Parameters:**
- `x` (number, required): X coordinate to click
- `y` (number, required): Y coordinate to click
- `button` (string, optional): Mouse button to click (left, right, middle)
- `clicks` (number, optional): Number of clicks to perform
- `require_user_confirmation` (boolean, optional): Whether to require user confirmation before clicking
- `action_timing_hint` (object, optional): Timing hints with minDelayMs, maxDelayMs
- `monitor_index` (number, optional): Monitor where click should occur
- `anchor_id` (string, optional): Element anchor ID for context

**Returns:**
- `success` (boolean): Whether the click was successful
- `was_confirmed` (boolean): Whether the action was confirmed by the user
- `actual_position` (object): Actual click coordinates with x, y
- `timestamp` (number): When the click occurred

### 5. type_text

**Title:** Emulate typing  
**Mode:** async

Emulates keyboard input by typing specified text.

**Parameters:**
- `text` (string, required): Text to type
- `typing_speed_wpm` (number, optional): Typing speed in words per minute
- `require_user_confirmation` (boolean, optional): Whether to require user confirmation before typing
- `action_timing_hint` (object, optional): Timing hints with minDelayMs, maxDelayMs
- `clear_existing` (boolean, optional): Whether to clear existing text first

**Returns:**
- `success` (boolean): Whether the typing was successful
- `typed_length` (number): Number of characters that were typed
- `was_confirmed` (boolean): Whether the action was confirmed by the user
- `timestamp` (number): When the typing occurred

### 6. set_mode

**Title:** Set operational mode  
**Mode:** sync

Sets the operational mode of the MCP server, controlling automation behavior and human consent requirements.

**Parameters:**
- `mode` (string, required): Operational mode (passive, assist, autopilot, composing, custom)
- `metadata` (object, optional): Additional metadata for the mode

**Returns:**
- `ok` (boolean): Whether the mode was set successfully
- `active_mode` (string): The currently active mode

### 7. set_screenshot_frequency

**Title:** Set screenshot frequency  
**Mode:** sync

Configures the frequency of automatic screenshot capture.

**Parameters:**
- `mode` (string, required): Screenshot capture mode
- `interval_ms` (number, required): Interval between screenshots in milliseconds
- `only_on_change` (boolean, optional): Whether to only capture on UI changes

**Returns:**
- `ok` (boolean): Whether the frequency was set successfully
- `applied_interval_ms` (number): The actual interval that was applied

### 8. get_clipboard

**Title:** Get clipboard  
**Mode:** sync

Retrieves the current clipboard content.

**Parameters:** None

**Returns:**
- `text` (string): Current clipboard text content
- `available` (boolean): Whether clipboard content is available

### 9. set_clipboard

**Title:** Set clipboard  
**Mode:** sync

Sets the clipboard content to the specified text.

**Parameters:**
- `text` (string, required): Text to set in clipboard

**Returns:**
- `ok` (boolean): Whether the clipboard was set successfully

### 10. batch_overlay

**Title:** Draw multiple overlays  
**Mode:** async

Draws multiple overlays simultaneously or sequentially.

**Parameters:**
- `overlays` (array, required): Array of overlay objects, each containing:
  - `x` (number): X coordinate
  - `y` (number): Y coordinate
  - `width` (number): Width
  - `height` (number): Height
  - `color` (string, optional): Color
  - `label` (string, optional): Label
  - `annotation_type` (string, optional): Type of annotation
  - `temporary_ms` (number, optional): Auto-remove time
  - `anchor_id` (string, optional): Element anchor ID
- `one_at_a_time` (boolean, optional): Whether to draw overlays sequentially
- `monitor_index` (number, optional): Target monitor for all overlays

**Returns:**
- `overlay_ids` (array): Array of overlay IDs that were created
- `monitor_index` (number): Monitor where overlays were drawn
- `display_scale` (number): Display scale factor used

### 11. subscribe_events

**Title:** Subscribe to UI events  
**Mode:** async

Subscribes to UI events for real-time monitoring of user interactions.

**Parameters:**
- `events` (array, required): Array of event types to subscribe to
- `debounce_ms` (number, optional): Debounce time for events
- `filter` (object, optional): Event filtering criteria

**Returns:**
- `subscription_id` (string): Unique identifier for the subscription
- `subscribed` (array): Array of events that were successfully subscribed to

### 12. unsubscribe_events

**Title:** Unsubscribe from events  
**Mode:** sync

Unsubscribes from previously subscribed UI events.

**Parameters:**
- `subscription_id` (string, required): ID of the subscription to cancel

**Returns:**
- `ok` (boolean): Whether the unsubscription was successful

### 13. re_anchor_element

**Title:** Re-anchor element after scroll or layout change  
**Mode:** async

Re-locates a previously anchored element after viewport changes, scrolling, or layout updates.

**Parameters:**
- `anchor_id` (string, required): ID of the anchor to re-locate
- `search_region` (object, optional): Region to search within for the element
- `tolerance` (number, optional): Matching tolerance for element recognition

**Returns:**
- `found` (boolean): Whether the element was successfully re-anchored
- `new_position` (object): New position with x, y coordinates
- `confidence` (number): Confidence score of the match (0-1)
- `viewport_scroll` (object): Current viewport scroll position

### 14. get_display_info

**Title:** Get display configuration  
**Mode:** sync

Retrieves information about all connected displays and their configurations.

**Parameters:** None

**Returns:**
- `displays` (array): Array of display objects with:
  - `monitor_index` (number): Display index
  - `bounds` (object): Display bounds with x, y, width, height
  - `scale_factor` (number): DPI scale factor
  - `is_primary` (boolean): Whether this is the primary display
- `total_virtual_screen` (object): Combined virtual screen dimensions

## Operational Modes

The MCP server supports different operational modes that control automation behavior:

- **passive**: No automated actions, only observation and overlay capabilities
- **assist**: Suggests actions but requires user confirmation
- **autopilot**: Performs actions automatically with minimal user intervention
- **composing**: Specialized mode for text composition and editing
- **custom**: User-defined mode with custom behavior

## Rate Limiting

All tools implement rate limiting to protect local and remote inference systems from overload and maintain low-latency operations. Configurable limits include:

- Maximum requests per second (default: 10/sec)
- Maximum screenshot requests per minute (default: 60/min)
- Burst allowance for rapid interactions
- Mode-specific rate limits (autopilot mode has higher limits)

## Privacy and Security

- **Screenshot Scrubbing**: Configurable privacy masks to obscure sensitive information
- **Clipboard Control**: User-controlled clipboard access permissions
- **Action Confirmation**: All automated actions can require user confirmation
- **Human-in-the-loop**: Design ensures user maintains control over automation
- **Audit Trail**: Optional logging of all actions for security and debugging
- **Local Processing**: Sensitive operations can be processed locally without external API calls

## Multi-Monitor Support

**Current Status**: Single monitor support only (monitor index 0)  
**Roadmap**: Full multi-monitor support planned for future implementation

**Current Limitations**:
- All operations assume single monitor (index 0)
- `CaptureMonitorAsync` treats all requests as full screen capture
- Overlay coordinates not mapped across multiple displays

**Planned Features**:
- **Multiple Displays**: Proper handling of multi-monitor setups with different resolutions
- **DPI Scaling**: Automatic detection and handling of different DPI scales per monitor
- **Virtual Screen**: Support for extended desktop configurations
- **Monitor Migration**: Handling of displays being connected/disconnected during operation
- **Coordinate Translation**: ✅ IMPLEMENTED - Accurate coordinate mapping across different display configurations
- **`get_display_info` tool**: ✅ IMPLEMENTED - Returns monitor count, resolutions, positions, primary monitor
- **Monitor-Specific Operations**: ✅ IMPLEMENTED - Overlays and screenshots can target specific monitors
- **Boundary Clamping**: ✅ IMPLEMENTED - Overlays are automatically clamped to monitor bounds

**Implementation Status**: ✅ COMPLETED - Full multi-monitor support implemented and tested

## Performance Considerations

- **Real-time Operation**: Designed for <0.5 second response times
- **Efficient Screenshot Capture**: Optimized algorithms for minimal latency
- **Memory Management**: Careful resource usage for overlay and image operations
- **Async Operations**: Non-blocking operations for UI responsiveness
- **Local Model Support**: Optimized for local AI model inference

## Context Awareness

- **Viewport Tracking**: Automatic tracking of scroll positions and viewport changes
- **Element Anchoring**: Persistent element identification across UI changes
- **State Management**: Maintains context across multiple interactions
- **Metadata Exchange**: Bidirectional context sharing with AI models

## Development Environment

### For AI Agents and AllHands Instances

**Automatic Setup (Required):**
```bash
git clone https://github.com/RyansOpenSauceRice/overlay-companion-mcp.git
cd overlay-companion-mcp
./scripts/setup-dev-environment.sh
```

This repository uses **automated development environment setup** with:
- ✅ Pre-commit hooks for code quality (Black, flake8, mypy, bandit)
- ✅ Multi-language linting (Python, C#, Markdown)
- ✅ Security scanning and dependency checking
- ✅ Conventional commit enforcement
- ✅ Automatic code formatting

### Quality Standards

**Multi-Language Linting Strategy**: Multiple workflow files (industry standard)
- `python-lint.yml`: Comprehensive Python quality checks
- `csharp-lint.yml`: C# formatting and analysis
- `markdown-lint.yml`: Documentation quality assurance

**Pre-commit Hooks**: All code changes are automatically validated for:
- Code formatting and style consistency
- Security vulnerabilities and credential detection
- Type checking and static analysis
- Import sorting and dependency validation

### Documentation

- **Development Setup**: [docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md)
- **AI Agent Instructions**: [docs/AI_AGENT_SETUP.md](docs/AI_AGENT_SETUP.md)
- **Open Source Licenses**: [docs/OPEN_SOURCE_LICENSES.md](docs/OPEN_SOURCE_LICENSES.md)

### Build and Deployment

**AppImage Build**: Legacy. Web-only delivery does not ship a desktop AppImage. This section is preserved for historical context if reintroduced.
```bash
./scripts/build-appimage.sh
```

**CI/CD Pipeline**: GitHub Actions workflows for:
- Multi-language code quality checks
- Automated testing and validation
- AppImage build and release
- Documentation quality assurance