# Overlay Companion (MCP) - Tool Specification

_A general-purpose, human-in-the-loop AI-assisted screen interaction toolkit._

---

## Architecture Overview

The Overlay Companion MCP is a containerized system that provides AI-assisted screen interaction through a **simplified multi-container architecture**. The system is built using the **official ModelContextProtocol C# SDK** with HTTP transport and deployed via Docker Compose/Podman for reliable container orchestration.

> **📋 Important**: The system has migrated from Guacamole to **KasmVNC architecture** for improved security, performance, and multi-monitor support. See [DEPRECATION_NOTICE.md](DEPRECATION_NOTICE.md) for migration details.

### System Components (Current - KasmVNC Architecture)

```text
AI Client → HTTP/MCP → Caddy Proxy → {MCP Server, Web Interface, KasmVNC} → VM
                           ↓
                    Web UI Configuration (No Database)
```

#### Core Architecture (Simplified)

1. **Container Stack** (Docker/Podman) - **4 Containers** (33% reduction):
   - **MCP Server Container**: C# application with HTTP transport, overlay tools, screen capture, KasmVNC integration
   - **Web Interface Container**: Node.js frontend with overlay visualization, connection management, and credential handling
   - **KasmVNC Container**: Web-native VNC server with multi-monitor support and WebSocket/WebRTC protocols
   - **Caddy Proxy**: Unified access point routing to all services

2. **Configuration Layer** (No Database Required):
   - **YAML-based configuration**: Simple file-based setup eliminates PostgreSQL complexity
   - **Environment variable credentials**: Secure credential injection via container environment
   - **Web UI credential management**: Browser-based connection management with encrypted localStorage
   - **Multi-VM configuration**: Web browser UI for managing multiple VM connections (not Docker config)

3. **Network Architecture**:
   - **Configurable ports**: All service ports configurable during installation
   - **Default ports**: Main interface (8080), MCP server (3000), KasmVNC (6901), Web interface (8082)
   - **Port conflict resolution**: Automatic detection with interactive alternatives
   - Caddy proxy as unified access point routing to all services
   - Internal container networking with service discovery
   - **Enhanced WebSocket support**: Real-time overlay events and KasmVNC communication

#### Security Architecture (Enhanced)

- **SSRF Protection**: Comprehensive Server-Side Request Forgery protection with multiple validation layers
- **POST over GET**: Network requests use POST method with fixed URL paths to prevent URL-based attacks
- **Host Validation**: Multi-layer host validation with allowlist/blocklist patterns
- **Input Sanitization**: Character filtering and normalization for all user inputs
- **Rate Limiting**: Connection testing limited to 10 requests/minute per IP
- **No Database Attack Surface**: Elimination of PostgreSQL removes SQL injection and database compromise risks

#### Network Architecture

- **Default**: Host-only access (localhost) for security
- **Optional**: LAN exposure with security warnings
- **Output**: Non-localhost IP URL (e.g., http://192.168.1.42:8080)

### Deployment Architecture

#### Container-Based Deployment (Current - KasmVNC)

```text
host-setup-kasmvnc.sh → Podman Compose → {4 Containers} → Web Interface + MCP Server
```

**Container Stack (Simplified):**
- **kasmvnc**: Web-native VNC server with multi-monitor support
- **mcp-server**: C# MCP server with HTTP transport and KasmVNC integration
- **overlay-web**: Node.js web interface with connection management
- **caddy**: Reverse proxy and load balancer

**Deployment Process:**
1. `host-setup-kasmvnc.sh` installs Podman and dependencies
2. **Port configuration**: Interactive setup with conflict resolution
3. **Environment variable credentials**: Simple VNC_PASSWORD and KASM_PASSWORD setup
4. Builds custom MCP server and web interface containers
5. Configures KasmVNC with YAML-based settings
6. **No database initialization required** - eliminates PostgreSQL complexity
7. Starts all containers with proper networking and environment variables

**Access Points:**
- **Main Interface**: http://localhost:8080 (Caddy proxy) - *configurable*
- **MCP Server**: http://localhost:3000 (direct access) - *configurable*
- **KasmVNC**: http://localhost:6901 (web-native interface) - *configurable*
- **Web Interface**: http://localhost:8080/ (connection management) - *configurable*
- **Multi-VM Configuration**: Web browser UI for managing connections (not Docker config)

#### Quality Assurance & Security

**Pre-commit Checks:**
- **Python**: Black formatting, isort imports, flake8 linting, bandit security scanning
- **C#**: dotnet-format code formatting and style validation
- **JavaScript Security**: ESLint with security plugins for SSRF, injection, and vulnerability detection
- **Multi-language Security**: Semgrep static analysis (CodeQL alternative) for JavaScript, TypeScript, and C#
- **Markdown**: markdownlint formatting with auto-fix
- **Spelling**: cspell spell checking for documentation
- **Credential Security**: detect-secrets for credential scanning with allowlist for development passwords
- **YAML/JSON**: Syntax validation for configuration files
- **Git**: Conventional commit message validation

**GitHub Actions Security:**
- **CodeQL**: Comprehensive static analysis for security vulnerabilities (enhanced by pre-commit security checks)
- **Container Security**: Vulnerability scanning for container images
- **Dependency Scanning**: Automated dependency vulnerability detection
- **SSRF Protection**: Multiple validation layers prevent Server-Side Request Forgery attacks

**Security Analysis Coverage:**
- **Pre-commit**: ESLint security rules + Semgrep static analysis for immediate feedback during development
- **GitHub Actions**: Full CodeQL analysis for comprehensive security scanning
- **Combined Coverage**: Local security checks catch common issues, CodeQL provides deep analysis
- **CodeQL-like Functionality**: Semgrep provides CodeQL-equivalent security analysis in pre-commit hooks

**Security Implementation:**
- **POST over GET**: Network requests use POST method with fixed URL paths
- **Host Validation**: Multi-layer validation with allowlist/blocklist patterns

## Pre-commit Hooks Configuration

The project uses comprehensive pre-commit hooks to ensure code quality, security, and consistency. Install with:

```bash
pip install pre-commit
pre-commit install
```

### Python Code Quality

| Hook | Purpose | Configuration |
|------|---------|---------------|
| **black** | Code formatting | Python 3, line length 88 |
| **isort** | Import sorting | Black-compatible profile |
| **flake8** | Linting | Max line 88, ignore E203/W503 |
| **bandit** | Security scanning | JSON output, excludes tests |

### File Validation

| Hook | Purpose | Files |
|------|---------|-------|
| **trailing-whitespace** | Remove trailing spaces | All except .md |
| **end-of-file-fixer** | Ensure newline at EOF | All except .md |
| **check-yaml** | YAML syntax validation | .yaml, .yml |
| **check-json** | JSON syntax validation | .json |
| **check-toml** | TOML syntax validation | .toml |
| **check-xml** | XML syntax validation | .xml |
| **check-merge-conflict** | Detect merge conflicts | All files |
| **check-case-conflict** | Case sensitivity issues | All files |
| **check-added-large-files** | Prevent large files | Max 1MB |
| **detect-private-key** | Prevent key commits | All files |

### Language-Specific Formatting

| Hook | Purpose | Configuration |
|------|---------|---------------|
| **dotnet-format** | C# code formatting | Minimal verbosity |

### Build and Deployment Validation

| Hook | Purpose | Validation |
|------|---------|------------|
| **check-build-scripts-executable** | Script permissions | scripts/*.sh executable |
| **validate-appimage-if-exists** | AppImage integrity | Runs validation if AppImage exists |
| **check-workflow-syntax** | GitHub Actions YAML | Syntax validation |
| **check-npm-cache-config** | npm configuration | Cache/package.json consistency |

### Documentation Quality

| Hook | Purpose | Configuration |
|------|---------|---------------|
| **markdownlint** | Markdown linting | Auto-fix enabled |
| **cspell** | Spell checking | Custom dictionary, .md files |

### Security Analysis (CodeQL-like)

| Hook | Purpose | Coverage |
|------|---------|----------|
| **eslint-security** | JavaScript security | SSRF, XSS, injection detection |
| **semgrep-security** | Multi-language static analysis | Format strings, insecure transport, WebSocket security |
| **detect-secrets** | Secret detection | Excludes .lock, .min.js, .min.css |

### Git Commit Standards

| Hook | Purpose | Format |
|------|---------|--------|
| **conventional-pre-commit** | Commit message format | feat, fix, docs, style, refactor, test, chore, ci |

### Security Hook Details

**ESLint Security Analysis:**
- Detects SSRF vulnerabilities
- Identifies XSS injection points
- Validates object injection sinks
- Checks for unsafe regex patterns
- Monitors format string vulnerabilities

**Semgrep Security Analysis:**
- Multi-language security scanning (JS, TS, C#)
- Detects insecure transport (HTTP vs HTTPS)
- Identifies insecure WebSocket connections
- Validates PostMessage origin handling
- Checks for CSRF protection
- Analyzes innerHTML usage for XSS risks

**Installation Requirements:**
```bash
# ESLint security (auto-installed)
cd infra/server
npm install --no-save eslint@8 eslint-plugin-security

# Semgrep (auto-installed)
pip install semgrep

# Spell checking
npm install -g cspell
```
- **Input Sanitization**: Character filtering and normalization
- **Rate Limiting**: Connection testing limited to 10 requests/minute per IP

#### Container Build Considerations

**Build Context & File Transfer:**
- **Docker Context**: All builds use root directory (`.`) as context for consistency
- **Multi-stage Builds**: Separate build and runtime stages for optimal image size
- **Layer Caching**: Package files copied separately from source code for better cache utilization
- **Fallback Mechanisms**: `npm ci || npm install` pattern handles missing package-lock.json gracefully

**Cross-Platform Compatibility:**
- **Multi-architecture**: AMD64 and ARM64 builds for broad compatibility
- **Alpine Linux Base**: Minimal attack surface with apk package manager
- **Node.js LTS**: Stable Node.js 20-alpine for web interface builds
- **.NET 8**: Latest LTS runtime for MCP server container

**Build Robustness:**
- **Explicit File Copying**: Individual package.json and package-lock.json copies prevent context issues
- **Verbose Logging**: `--verbose` flags for debugging build failures in CI/CD
- **Error Handling**: Graceful fallbacks when npm ci fails (falls back to npm install)
- **Security Scanning**: Trivy integration for vulnerability detection

**GitHub Actions Integration:**
- **Build Matrix**: Parallel builds for both MCP server and web interface containers
- **Cache Optimization**: GitHub Actions cache for Docker layers and npm packages
- **Registry Publishing**: Automated publishing to GitHub Container Registry (GHCR)
- **Version Tagging**: Date-based versioning (YYYY.MM.DD.quantity) with Git tag creation

### HTTP Transport Benefits

The native HTTP transport provides critical advantages for modern MCP deployments:

1. **Image Support**: Native handling of images and binary data (STDIO cannot handle images)
2. **Multi-Client Support**: Multiple AI clients can connect simultaneously
3. **Web Integration**: Direct browser access and web-based tooling
4. **Streaming**: Server-Sent Events for real-time updates
5. **Remote Deployment**: MCP server can run on different machines/containers
6. **Monitoring**: HTTP traffic can be logged, monitored, and audited
7. **Load Balancing**: Multiple MCP server instances with standard HTTP load balancers
8. **CORS Support**: Cross-origin requests for web applications

---

## MCP Tool Specification (JSON Format)

```json
{
  "mcp_spec_version": "1.0",
  "name": "overlay-companion-mcp",
  "description": "Public MCP server exposing overlay, screenshot, and input actions for human-in-the-loop UI automation.",
  "tools": [
    {
      "id": "draw_overlay",
      "title": "Draw overlay box",
      "mode": "async",
      "params": {
        "x": { "type": "number" },
        "y": { "type": "number" },
        "width": { "type": "number" },
        "height": { "type": "number" },
        "color": { "type": "string", "optional": true },
        "opacity": { "type": "number", "optional": true, "description": "0.0 to 1.0 (default 0.5)" },
        "label": { "type": "string", "optional": true },
        "temporary_ms": { "type": "number", "optional": true }
      },
      "returns": {
        "overlay_id": "string",
        "bounds": { "x": "number", "y": "number", "width": "number", "height": "number" },
        "monitor_index": "number"
      }
    },
    {
      "id": "remove_overlay",
      "title": "Remove overlay",
      "mode": "sync",
      "params": {
        "overlay_id": { "type": "string" }
      },
      "returns": {
        "removed": "boolean",
        "not_found": "boolean"
      }
    },
    {
      "id": "take_screenshot",
      "title": "Take screenshot",
      "mode": "async",
      "params": {
        "region": { "type": "object", "optional": true },
        "full_screen": { "type": "boolean", "optional": true },
        "scale": { "type": "number", "optional": true },
        "wait_for_stable_ms": { "type": "number", "optional": true }
      },
      "returns": {
        "image_base64": "string",
        "width": "number",
        "height": "number",
        "region": "object",
        "monitor_index": "number",
        "display_scale": "number",
        "viewport_scroll": { "x": "number", "y": "number" }
      }
    },
    {
      "id": "click_at",
      "title": "Simulate click",
      "mode": "sync",
      "params": {
        "x": { "type": "number" },
        "y": { "type": "number" },
        "button": { "type": "string", "enum": ["left","right","middle"], "optional": true },
        "clicks": { "type": "number", "optional": true },
        "require_user_confirmation": { "type": "boolean", "optional": true },
        "action_timing_hint": { "type": "object", "optional": true }
      },
      "returns": {
        "success": "boolean",
        "was_confirmed": "boolean"
      }
    },
    {
      "id": "type_text",
      "title": "Emulate typing",
      "mode": "async",
      "params": {
        "text": { "type": "string" },
        "typing_speed_wpm": { "type": "number", "optional": true },
        "require_user_confirmation": { "type": "boolean", "optional": true },
        "action_timing_hint": { "type": "object", "optional": true }
      },
      "returns": {
        "success": "boolean",
        "typed_length": "number"
      }
    },
    {
      "id": "set_mode",
      "title": "Set operational mode",
      "mode": "sync",
      "params": {
        "mode": { "type": "string", "enum": ["passive","assist","autopilot","composing","custom"] },
        "metadata": { "type": "object", "optional": true }
      },
      "returns": {
        "ok": "boolean",
        "active_mode": "string"
      }
    },
    {
      "id": "set_screenshot_frequency",
      "title": "Set screenshot frequency",
      "mode": "sync",
      "params": {
        "mode": { "type": "string" },
        "interval_ms": { "type": "number" },
        "only_on_change": { "type": "boolean", "optional": true }
      },
      "returns": {
        "ok": "boolean",
        "applied_interval_ms": "number"
      }
    },
    {
      "id": "get_clipboard",
      "title": "Get clipboard",
      "mode": "sync",
      "params": {},
      "returns": {
        "text": "string",
        "available": "boolean"
      }
    },
    {
      "id": "set_clipboard",
      "title": "Set clipboard",
      "mode": "sync",
      "params": {
        "text": { "type": "string" }
      },
      "returns": {
        "ok": "boolean"
      }
    },
    {
      "id": "batch_overlay",
      "title": "Draw multiple overlays",
      "mode": "async",
      "params": {
        "overlays": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "x": { "type": "number" },
              "y": { "type": "number" },
              "width": { "type": "number" },
              "height": { "type": "number" },
              "color": { "type": "string", "optional": true },
              "opacity": { "type": "number", "optional": true, "description": "0.0 to 1.0 (default 0.5)" },
              "label": { "type": "string", "optional": true },
              "temporary_ms": { "type": "number", "optional": true },
              "click_through": { "type": "boolean", "optional": true },
              "monitor_index": { "type": "number", "optional": true }
            }
          }
        },
        "one_at_a_time": { "type": "boolean", "optional": true }
      },
      "returns": {
        "overlay_ids": "array"
      }
    },
    {
      "id": "subscribe_events",
      "title": "Subscribe to UI events",
      "mode": "async",
      "params": {
        "events": { "type": "array", "items": { "type": "string" } },
        "debounce_ms": { "type": "number", "optional": true },
        "filter": { "type": "object", "optional": true }
      },
      "returns": {
        "subscription_id": "string",
        "subscribed": "array"
      }
    },
    {
      "id": "unsubscribe_events",
      "title": "Unsubscribe from events",
      "mode": "sync",
      "params": {
        "subscription_id": { "type": "string" }
      },
      "returns": {
        "ok": "boolean"
      }
    }
  ]
}
```

---

## Detailed Tool Descriptions

### 1. draw_overlay

**Purpose**: Draw a visual overlay box on the screen for highlighting or annotation.

**Parameters**:

- `x` (number, required): X coordinate in screen pixels
- `y` (number, required): Y coordinate in screen pixels
- `width` (number, required): Width of overlay in pixels
- `height` (number, required): Height of overlay in pixels
- `color` (string, optional): Color name or hex code (default: "red")
- `label` (string, optional): Text label to display on overlay
- `temporary_ms` (number, optional): Auto-remove after milliseconds

**Returns**:

- `overlay_id`: Unique identifier for the created overlay
- `bounds`: Actual bounds of the overlay (may be adjusted for screen boundaries)
- `monitor_index`: Index of the monitor where overlay was placed

**Example**:

```json
{
  "method": "draw_overlay",
  "params": {
    "x": 100,
    "y": 200,
    "width": 300,
    "height": 50,
    "color": "blue",
    "label": "Click here",
    "temporary_ms": 5000
  }
}
```

### 2. remove_overlay

**Purpose**: Remove a previously created overlay by its ID.

**Parameters**:

- `overlay_id` (string, required): ID of overlay to remove

**Returns**:

- `removed`: True if overlay was successfully removed
- `not_found`: True if overlay ID was not found

### 3. take_screenshot

**Purpose**: Capture a screenshot of the screen or a specific region.

**Parameters**:
- `region` (object, optional): Specific region to capture `{x, y, width, height}`
- `full_screen` (boolean, optional): Capture entire screen (default: true)
- `scale` (number, optional): Scale factor for image (default: 1.0)
- `wait_for_stable_ms` (number, optional): Wait for UI to stabilize before capture

**Returns**:
- `image_base64`: Base64-encoded PNG image data
- `width`: Image width in pixels
- `height`: Image height in pixels
- `region`: Actual captured region
- `monitor_index`: Monitor that was captured
- `display_scale`: Display scaling factor
- `viewport_scroll`: Current scroll position if applicable

### 4. click_at

**Purpose**: Simulate a mouse click at specified coordinates.

**Parameters**:
- `x` (number, required): X coordinate to click
- `y` (number, required): Y coordinate to click
- `button` (string, optional): Mouse button ("left", "right", "middle", default: "left")
- `clicks` (number, optional): Number of clicks (default: 1)
- `require_user_confirmation` (boolean, optional): Require user confirmation
- `action_timing_hint` (object, optional): Timing hints for the action

**Returns**:
- `success`: True if click was executed successfully
- `was_confirmed`: True if user confirmation was required and given

### 5. type_text

**Purpose**: Simulate keyboard typing of text.

**Parameters**:
- `text` (string, required): Text to type
- `typing_speed_wpm` (number, optional): Typing speed in words per minute (default: 60)
- `require_user_confirmation` (boolean, optional): Require user confirmation
- `action_timing_hint` (object, optional): Timing hints for the action

**Returns**:
- `success`: True if typing was executed successfully
- `typed_length`: Number of characters actually typed

### 6. set_mode

**Purpose**: Set the operational mode of the system.

**Parameters**:
- `mode` (string, required): Mode name ("passive", "assist", "autopilot", "composing", "custom")
- `metadata` (object, optional): Additional mode-specific configuration

**Returns**:
- `ok`: True if mode was set successfully
- `active_mode`: Currently active mode name

**Modes**:
- **passive**: Read-only operations (screenshots, overlays)
- **assist**: Suggests actions, requires confirmation
- **autopilot**: Automated actions with safety checks
- **composing**: Specialized for text composition
- **custom**: User-defined behavior

### 7. set_screenshot_frequency

**Purpose**: Configure automatic screenshot capture frequency.

**Parameters**:
- `mode` (string, required): Frequency mode ("manual", "periodic", "on_change")
- `interval_ms` (number, required): Interval in milliseconds
- `only_on_change` (boolean, optional): Only capture when screen changes

**Returns**:
- `ok`: True if frequency was set successfully
- `applied_interval_ms`: Actual interval applied (may be rate-limited)

### 8. get_clipboard

**Purpose**: Get the current clipboard content.

**Parameters**: None

**Returns**:
- `text`: Current clipboard text content
- `available`: True if clipboard content is available

### 9. set_clipboard

**Purpose**: Set the clipboard content.

**Parameters**:
- `text` (string, required): Text to set in clipboard

**Returns**:
- `ok`: True if clipboard was set successfully

### 10. batch_overlay

**Purpose**: Create multiple overlays in a single operation.

**Parameters**:
- `overlays` (array, required): Array of overlay specifications
- `one_at_a_time` (boolean, optional): Create overlays sequentially vs. simultaneously

**Returns**:
- `overlay_ids`: Array of created overlay IDs

### 11. subscribe_events

**Purpose**: Subscribe to UI events for monitoring.

**Parameters**:
- `events` (array, required): Array of event types to subscribe to
- `debounce_ms` (number, optional): Debounce interval for events
- `filter` (object, optional): Event filter criteria

**Event Types**:
- `mouse_move`: Mouse movement events
- `mouse_click`: Mouse click events
- `key_press`: Keyboard events
- `window_focus`: Window focus changes
- `screen_change`: Screen content changes

**Returns**:
- `subscription_id`: Unique subscription identifier
- `subscribed`: Array of successfully subscribed event types

### 12. unsubscribe_events

**Purpose**: Unsubscribe from previously subscribed events.

**Parameters**:
- `subscription_id` (string, required): Subscription ID to cancel

**Returns**:
- `ok`: True if unsubscription was successful

---

## Error Handling

All tools return standard MCP error responses for:

- **Invalid parameters**: Missing or invalid parameter values
- **Permission denied**: Operation not allowed in current mode
- **System error**: Underlying system operation failed
- **Rate limited**: Too many requests in time window

---

## Security & Safety

### Human-in-the-Loop Controls

- Input simulation requires confirmation in most modes
- Mode-based permission system
- Rate limiting on all operations
- User override capabilities

### Privacy & Networking

- Local-first operation; HTTP transport enables remote deployment when required
- Screenshot data can be scrubbed before sharing
- Clipboard access requires explicit permission
- Use TLS and authentication when exposing over a network

### Platform Integration

#### Linux: Wayland-first with X11 fallback
- Clipboard: wl-clipboard (wl-copy/wl-paste) preferred; fallback: xclip
- Typing/input: wtype preferred; fallback: xdotool
- Screenshots: grim (+ slurp for region) or gnome-screenshot/spectacle; fallback: scrot/maim/ImageMagick import
- Display/monitors: swaymsg, hyprctl; fallback: xrandr, xdpyinfo
- Cursor/position queries: compositor-native where available; fallback via xdotool

#### General
- Respects system accessibility settings
- Works with screen readers and assistive technology
- Follows platform-specific UI guidelines
- Handles multi-monitor setups correctly

---

## Implementation Roadmap

### High Priority (Core Functionality)

- **Web overlay client + WS bridge** - Browser-rendered overlays with pointer-events: none
- **Session Stop implementation** - Critical safety feature  
- **Color and text rendering** - Basic overlay functionality

### Medium Priority (Enhanced Features)

- **Overlay management UI (web)** - User control and monitoring
- **Multi-monitor viewport sync** - Two-window cropping and coordinate transforms
- **Advanced overlay shapes** - Enhanced AI interaction capabilities

### Low Priority (Polish)

- **Overlay animations** - Visual enhancement
- **Interactive overlays** - Advanced interaction modes
- **Overlay templates** - Predefined overlay styles

---

## Versioning Schema

The project follows a **date-based versioning schema** for releases:

### Format: `YYYY.MM.DD[.N]`

- **YYYY**: 4-digit year
- **MM**: 2-digit month (01-12)
- **DD**: 2-digit day (01-31)
- **N**: Optional build number for multiple releases in the same day (starting from 1)

### Examples

- `2024.08.18` - First release on August 18, 2024
- `2024.08.18.1` - Second release on August 18, 2024
- `2024.08.18.2` - Third release on August 18, 2024
- `2024.12.25` - First release on December 25, 2024

### Release Automation

- **Automatic versioning**: GitHub Actions automatically calculate the next version
- **Daily builds**: Each day gets a new base version
- **Multiple builds**: Same-day builds increment the build number
- **GitHub releases**: Automatically created with AppImage artifacts

---

## GitHub Actions & CI/CD

The project includes comprehensive automation through GitHub Actions:

### 1. **Markdown Linting** (`markdown-lint.yml`)
- **Purpose**: Documentation quality assurance
- **Triggers**: Push/PR to main/develop branches (markdown files)
- **Checks**:
  - Markdown syntax and style consistency
  - Spelling accuracy with cspell
  - Link validity verification
  - Table of contents synchronization
- **Tools**: markdownlint-cli, cspell, markdown-link-check

### 2. **C# Linting** (`csharp-lint.yml`)
- **Purpose**: Code quality and build verification
- **Triggers**: Push/PR to main/develop branches (C# files)
- **Checks**:
  - Code formatting verification (`dotnet format`)
  - Build success validation
  - Static analysis
  - Security vulnerability scanning
  - Deprecated package detection
  - Code metrics analysis
- **Artifacts**: Build outputs for verification

### 3. **AppImage Build** (`build-appimage.yml`)
- **Purpose**: Linux distribution package creation
- **Triggers**:
  - Push to main/develop (source changes)
  - Manual workflow dispatch
  - GitHub releases
- **Features**:
  - Automatic version calculation
  - AppImage creation with proper metadata
  - Desktop integration files
  - Artifact upload and testing
  - Automatic GitHub release creation
- **Outputs**: Distributable AppImage files

### 4. **CI/CD Pipeline** (`ci-cd.yml`)
- **Purpose**: Comprehensive continuous integration and deployment
- **Triggers**: Push/PR to main/develop, manual dispatch
- **Stages**:
  - **Quality Gates**: Deployment condition checks
  - **Markdown Quality**: Documentation validation
  - **C# Quality**: Code quality and build verification
  - **Unit Tests**: Automated test execution (when available)
  - **Integration Tests**: Application startup and MCP server testing
  - **Security Scan**: Vulnerability scanning with Trivy
  - **Build AppImage**: Production-ready package creation
  - **Deploy**: Environment-specific deployment
  - **Notify**: Status notifications
- **Environments**: Staging and production deployment support

### Workflow Dependencies

```mermaid
graph TD
    A[Push/PR] --> B[Quality Gates]
    A --> C[Markdown Quality]
    A --> D[C# Quality]
    
    B --> E[Should Deploy?]
    D --> F[Unit Tests]
    D --> G[Integration Tests]
    D --> H[Security Scan]
    
    E --> I[Build AppImage]
    F --> I
    G --> I
    
    I --> J[Deploy]
    J --> K[Notify]
```

### Quality Standards

- **Zero tolerance**: All quality checks must pass
- **Security first**: Vulnerability scanning on every build
- **Documentation**: Markdown quality enforced
- **Code style**: Consistent formatting required
- **Build verification**: Must compile without errors
- **Testing**: Automated validation where possible

### CI/CD Best Practices & Timeout Management

Based on extensive optimization work, the project implements comprehensive timeout protection across all workflows:

#### Multi-Layered Timeout Strategy

1. **Job-Level Timeouts**: Every workflow job has `timeout-minutes` to prevent runaway processes
2. **Step-Level Timeouts**: Critical build/test steps have individual timeout limits
3. **Command-Level Timeouts**: Shell commands use `timeout` utility for granular control
4. **Process-Level Timeouts**: Long-running processes have built-in timeout mechanisms

#### Timeout Configuration by Workflow

- **ci-cd.yml**: 5-20 minutes per job, with step-level timeouts for builds (10min) and tests (8min)
- **csharp-lint.yml**: 20 minutes total, with granular timeouts for restore (5min), format (3min), build (10min)
- **markdown-lint.yml**: 10 minutes per job, with timeouts for npm installs (3min) and checks (3-5min)
- **python-lint.yml**: 25 minutes total, with dependency installation (8min) and analysis timeouts (3-8min)
- **build-appimage.yml**: 5 minutes for main tests, 3 minutes for smoke tests, with 60s/30s/180s command timeouts
- **merge-ready.yml**: 15 minutes total, with build (8min) and test (3min) step timeouts

#### Error Classification & Recovery

- **Timeout Detection**: Exit code 124 indicates timeout vs. critical failure
- **Smart Continuation**: Non-critical timeouts allow workflow continuation
- **Progress Indicators**: All long-running operations show time limits and progress
- **Graceful Degradation**: Tests continue when possible, failing only on critical errors

#### Resource Management

- **GitHub Actions Efficiency**: Prevents 8+ minute hangs that waste CI/CD resources
- **Parallel Execution**: Jobs run concurrently where dependencies allow
- **Artifact Caching**: NuGet packages, npm modules, and build outputs cached appropriately
- **Early Termination**: Fast-fail on critical errors, continue on warnings

#### Monitoring & Observability

- **Structured Logging**: Clear progress indicators with time limits
- **Error Context**: Timeout vs. failure distinction in all error messages
- **Performance Tracking**: Build and test duration monitoring
- **Resource Usage**: Memory and CPU usage awareness in timeout settings

This timeout strategy ensures reliable CI/CD execution while maximizing resource efficiency and providing clear feedback on build/test performance.

---

## Packaging Artifacts & Ignored Paths

To keep the repository clean and reproducible, packaging outputs are generated at build time and must not be committed.

- The build system writes all packaging outputs under build/ (AppDir tree, AppImage file, publish/ outputs). These are ignored via .gitignore.
- The desktop entry and AppStream metadata are generated by scripts/build-appimage.sh during the build:
  - Desktop file path: AppDir/usr/share/applications/overlay-companion-mcp.desktop
  - AppStream file path: AppDir/usr/share/metainfo/overlay-companion-mcp.appdata.xml
  - Source of truth: Variables and heredoc content inside scripts/build-appimage.sh (APP_NAME, APP_DISPLAY_NAME, APP_DESCRIPTION, APP_CATEGORY, versioning, etc.).
- If you need to edit metadata, update scripts/build-appimage.sh. Optionally, introduce checked-in templates (e.g., packaging/linux/overlay-companion-mcp.desktop.tmpl and packaging/linux/overlay-companion-mcp.appdata.xml.tmpl) and have the script copy them into AppDir at build time.
- Trimming: Disabled by default in src/OverlayCompanion.csproj for stability. Do not pass /p:PublishTrimmed or TrimMode in workflows or scripts unless you explicitly re-enable trimming in the project.
- AppImage build notes:
  - The script auto-detects dotnet or installs SDK 8 locally via dotnet-install.sh if missing.
  - FUSE-less environments are supported via the extraction-based fallback.
  - You can set APP_VERSION=YYYY.MM.DD prior to running the script to control the output filename.

This policy prevents accidental commits of generated binaries and ensures the build remains deterministic across environments.

---

## AI GUI Tests (AllHands-only)

Purpose: provide a simple, key-free GUI test harness that runs inside the AllHands cloud environment and is not tied to GitHub Actions.

- Location: tests/ai-gui/
- Runner: tests/ai-gui/run.sh (invokes setup, builds app, launches under Xvfb, runs harness)
- Evidence: tests/ai-gui/artifacts/ (screenshots, logs, JSON summary)
- No API keys: uses stdio MCP when available or performs visual smoke tests until MCP is fully wired
- Not part of GitHub Actions by design; run manually in AllHands cloud

