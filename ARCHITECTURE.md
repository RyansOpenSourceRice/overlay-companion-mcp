# Overlay Companion MCP - Architecture Specification

> **📋 Architecture Update**: This specification reflects the new KasmVNC-based architecture, eliminating database complexity and providing true multi-monitor support.

## Vision

A single-user, lightweight system where users download a small release package, run an install script, and get a local IP URL to access a Fedora Silverblue VM through a web interface with AI-assisted overlay capabilities.

## User Flow

1. **Download**: Small release package from GitHub (no large VM images)
2. **Install**: Run `install.sh` → auto-installs Podman + OpenTofu + libvirt
3. **Provision**: OpenTofu creates 4 containers + Fedora Silverblue VM (no database required)
4. **Access**: Script prints local IP URL (e.g., `http://192.168.1.42:8080`)
5. **Configure**: Click URL → Web interface → "Copy MCP Config" → Paste into Cherry Studio
6. **Use**: Access VM through KasmVNC with AI overlay assistance

## System Architecture

### Core Components

```text
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   Cherry Studio │───▶│ 4 Containers     │───▶│ Fedora Silverblue   │
│   (AI Client)   │    │ (Simplified)     │    │ VM (KVM/libvirt)    │
└─────────────────┘    │                  │    └─────────────────────┘
                       │ • KasmVNC        │              │
                       │ • MCP Server     │              │
                       │ • Web Frontend   │              │
                       │ • Caddy Proxy    │              │
                       └──────────────────┘              │
                                │                        │
                       ┌──────────────────┐              │
                       │ Web Interface    │◀─────────────┘
                       │ (Browser)        │
                       │ • KasmVNC Client │
                       │ • Click-through  │
                       │ • Multi-Monitor  │
                       │ • AI Overlays    │
                       └──────────────────┘
```

### Technology Stack

#### Infrastructure Layer
- **OpenTofu**: Infrastructure as Code for provisioning
- **Podman**: Rootless container runtime (OCI compliant)
- **libvirt/KVM**: VM virtualization platform
- **Fedora Linux**: Host OS (target platform)

#### Container Stack (4 Containers - 33% Reduction)
- **KasmVNC Container**:
  - Web-native VNC server with WebSocket/WebRTC support
  - Multi-monitor support with separate browser windows
  - No database required for configuration
- **MCP Server Container**: C# WebSocket bridge for overlay broadcasting
- **Web Frontend Container**: Static assets + KasmVNC web client
- **Caddy Proxy Container**: Unified access point and reverse proxy

#### Virtual Machine
- **OS**: Fedora Silverblue (immutable, container-focused)
- **Display**: Wayland (future-proof, with X11 fallback)
- **Remote Access**: KasmVNC server for web-native connectivity
- **Isolation**: Full VM isolation for security

#### Client Integration
- **Cherry Studio**: AI client with MCP support
- **Web Browser**: KasmVNC web client + overlay rendering
- **Overlay System**: Click-through annotations with `pointer-events: none`

## Network Architecture

### Default Configuration (Secure)
```text
Host Machine (Fedora)
├── Management Container: localhost:8080
├── Fedora VM: 192.168.122.x (libvirt default network)
└── Access: Host-only (127.0.0.1)
```

### Optional LAN Exposure (With Warnings)
```text
Host Machine (Fedora)
├── Management Container: 0.0.0.0:8080
├── Fedora VM: 192.168.1.x (bridged network)
└── Access: LAN IP (192.168.1.42:8080)
```

### Security Considerations
- **Default**: Host-only access for security
- **Optional**: LAN exposure with explicit user consent + security warnings
- **Future**: HTTPS via self-signed certificates or Let's Encrypt
- **Authentication**: CORS headers + session-based access control

## Release Package Structure

### Lightweight Release (Primary)
```text
overlay-companion-release.tar.gz
├── install.sh                    # Main installer script
├── opentofu/                     # Infrastructure modules
│   ├── main.tf                   # Root module
│   ├── modules/
│   │   ├── management-container/ # Container provisioning
│   │   ├── fedora-vm/           # VM provisioning
│   │   └── networking/          # Network configuration
│   └── variables.tf             # Configuration variables
├── containers/                   # Container definitions
│   ├── Dockerfile.management    # Management container
│   └── compose/                 # Podman compose files
├── vm/                          # VM configuration
│   ├── cloud-init/              # VM initialization
│   └── kickstart/               # Automated installation
└── README.md                    # Installation instructions
```

### Installation Process
1. **Dependency Check**: Verify/install Podman + OpenTofu + libvirt
2. **Image Caching**: Download/cache Fedora Silverblue ISO (first run only)
3. **Infrastructure**: `opentofu apply` provisions containers + VM
4. **Network Discovery**: Detect and configure network access
5. **Service Start**: Launch management container + VM
6. **URL Output**: Print access URL for user

## Development Phases

### Phase 1: Core Infrastructure (MVP)
- [x] Disable AppImage builds
- [ ] Create install.sh script with dependency management
- [ ] Build OpenTofu modules for container + VM provisioning
- [ ] Setup Fedora Silverblue VM with XRDP

### Phase 2: Integration & Polish
- [ ] Integrate existing C# MCP server with WebSocket broadcasting
- [ ] Implement overlay system with click-through functionality
- [ ] Add "Copy MCP Config" one-click functionality
- [ ] Setup VM image caching to avoid re-downloads
- [ ] Add network configuration options (host-only vs LAN)

### Phase 3: Production Readiness
- [ ] Add HTTPS/TLS support via Caddy
- [ ] Implement proper authentication and session management
- [ ] Add monitoring and logging capabilities
- [ ] Create comprehensive documentation
- [ ] Setup CI/CD for release packaging

## Platform Support Policy

### Supported Platforms
- **Primary**: Fedora Linux (latest stable)
- **Secondary**: Other RPM-based distributions (RHEL, CentOS Stream)

### Explicitly Out of Scope
- **Windows**: Complex virtualization requirements, different container ecosystem
- **macOS**: Limited KVM support, licensing restrictions
- **Debian/Ubuntu**: Different package management, testing overhead

**Rationale**: Focus on single platform ensures reliability, reduces support burden, and enables faster iteration. Future multi-platform support can be evaluated based on user demand.

## Resource Requirements

### Minimum (Development/Testing)
- **CPU**: 4 vCPU
- **RAM**: 8 GB
- **Storage**: 80 GB SSD
- **Network**: 100 Mbps

### Recommended (Production Use)
- **CPU**: 8 vCPU
- **RAM**: 16 GB
- **Storage**: 200 GB SSD
- **Network**: 1 Gbps

### Resource Allocation
- **Host OS**: 2 GB RAM, 2 vCPU
- **Management Container**: 2 GB RAM, 2 vCPU
- **Fedora VM**: 4-8 GB RAM, 2-4 vCPU
- **Storage**: 40 GB VM disk, 40 GB container images/data

## Security Model

### Isolation Boundaries
1. **VM Isolation**: Full hardware virtualization via KVM
2. **Container Isolation**: Rootless Podman with user namespaces
3. **Network Isolation**: Default host-only access
4. **Process Isolation**: Separate processes for each component

### Access Control
- **Default**: Local access only (127.0.0.1)
- **Optional**: LAN access with explicit user consent
- **Authentication**: Session-based with CORS protection
- **Future**: OAuth/OIDC integration for multi-user scenarios

### Data Protection
- **VM State**: Encrypted VM disk images (future)
- **Network Traffic**: HTTPS for external access (future)
- **Secrets**: OpenTofu state encryption
- **Logs**: Structured logging with sensitive data filtering

## Future Enhancements

### Short Term
- **Multi-Monitor Support**: Two-window cropping for dual displays
- **Performance Optimization**: GPU passthrough for better VM performance
- **Update Management**: Automated updates for VM and containers

### Long Term
- **Multi-User Support**: Multiple concurrent VM sessions
- **Cloud Deployment**: AWS/GCP/Azure deployment options
- **Advanced Overlays**: 3D annotations, video recording
- **API Extensions**: REST API for programmatic control

## Integration Points

### Cherry Studio Integration
```json
{
  "mcpServers": {
    "overlay_companion": {
      "url": "http://192.168.1.42:8080/mcp",
      "transport": "http",
      "description": "AI-assisted screen interaction with VM overlay"
    }
  }
}
```

### MCP Protocol Extensions
- **Overlay Commands**: `draw_overlay`, `clear_overlays`, `batch_overlay`
- **VM Control**: `screenshot`, `click`, `type`, `scroll`
- **Session Management**: `start_session`, `stop_session`, `get_status`
- **Multi-Monitor**: `set_viewport`, `get_monitors`, `crop_display`

This architecture provides a solid foundation for the single-user, lightweight release while maintaining extensibility for future enhancements.

---
# Appendix: MCP communication analysis (consolidated)
# MCP Server Communication Analysis

## Current Architecture Overview

The Overlay Companion MCP system uses a **dual-server architecture** with WebSocket communication between components:

1. **C# MCP Server** (`src/Program.cs`) - Core overlay functionality
2. **Node.js Management Server** (`infra/server/server.js`) - Web interface and proxy
3. **WebSocket Communication** - Real-time overlay broadcasting

## C# MCP Server (Primary)

### Core Functionality
- **HTTP Transport**: Primary MCP protocol implementation using official SDK
- **WebSocket Hub**: Real-time overlay event broadcasting to web clients
- **Overlay Services**: Screen capture, overlay rendering, input monitoring
- **Multi-Monitor Support**: Native display detection and management

### Key Components

#### 1. HTTP MCP Server
```csharp
// Native HTTP transport with streaming support
builder.Services
    .AddMcpServer()
    .WithHttpTransport()  // Primary transport
    .WithToolsFromAssembly();

// Listens on http://0.0.0.0:3000/ by default
```

#### 2. WebSocket Hub (`OverlayWebSocketHub.cs`)
```csharp
public class OverlayWebSocketHub : IDisposable
{
    // Manages WebSocket clients for real-time updates
    private readonly ConcurrentDictionary<Guid, WebSocket> _clients = new();
    
    // Broadcasts overlay events to all connected clients
    public async Task BroadcastAsync(object message)
    {
        var json = JsonSerializer.Serialize(message, JsonOpts);
        var buffer = Encoding.UTF8.GetBytes(json);
        
        foreach (var client in _clients.Values)
        {
            if (client.State == WebSocketState.Open)
            {
                await client.SendAsync(buffer, WebSocketMessageType.Text, true, ct);
            }
        }
    }
}
```

#### 3. WebSocket Endpoints (`WebSocketEndpoints.cs`)
```csharp
// WebSocket endpoint for overlay synchronization
app.Map("/ws/overlays", async (HttpContext context, IOverlayEventBroadcaster broadcaster) =>
{
    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    var id = broadcaster.AddClient(socket);
    
    // Sync current overlay state to new client
    var current = await overlayService.GetActiveOverlaysAsync();
    await socket.SendAsync(syncMessage, WebSocketMessageType.Text, true, ct);
});
```

### MCP Tools Available
- `ClickAtTool` - Click at screen coordinates
- `TypeTextTool` - Type text input
- `GetClipboardTool` / `SetClipboardTool` - Clipboard operations
- `GetDisplayInfoTool` - Multi-monitor information
- `GetOverlayCapabilitiesTool` - System capabilities
- `SubscribeEventsTool` / `UnsubscribeEventsTool` - Event management
- `RemoveOverlayTool` - Overlay cleanup

## Node.js Management Server (Secondary)

### Purpose
- **Web Interface Hosting**: Serves the frontend application
- **MCP Proxy**: Forwards requests to C# MCP server
- **WebSocket Bridge**: Additional WebSocket layer for web integration
- **Configuration Management**: MCP config generation for Cherry Studio

### Key Features

#### 1. MCP Server Proxy
```javascript
// Forward /mcp requests to C# server
app.use('/mcp', createProxyMiddleware({
  target: config.mcpServerUrl, // http://localhost:3001 (C# server)
  changeOrigin: true,
  pathRewrite: {
    '^/mcp': '' // Remove /mcp prefix when forwarding
  }
}));
```

#### 2. WebSocket Bridge
```javascript
// Additional WebSocket layer for web clients
const wss = new WebSocket.Server({
  server,
  path: '/ws',
  clientTracking: true
});

// Handles overlay commands and viewport updates
wss.on('connection', (ws, req) => {
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    switch (message.type) {
      case 'overlay_command':
        broadcastOverlay(message.payload, clientId);
        break;
      case 'viewport_update':
        handleViewportUpdate(message.payload, clientId);
        break;
    }
  });
});
```

#### 3. MCP Configuration Endpoint
```javascript
// Generates MCP config for Cherry Studio integration
app.get('/mcp-config', (req, res) => {
  const mcpConfig = {
    mcp_version: '1.0',
    mcp_ws_url: `ws://${hostHeader}/ws`,
    mcp_http_url: `http://${hostHeader}/mcp`,
    capabilities: {
      overlay_system: true,
      multi_monitor: true,
      click_through: true,
      websocket_streaming: true
    }
  };
  res.json(mcpConfig);
});
```

## Communication Flow

### 1. MCP Tool Execution
```
AI Client → Node.js Server (/mcp) → C# MCP Server → Tool Execution → Response
```

### 2. Overlay Event Broadcasting
```
C# Overlay Service → WebSocket Hub → Connected Web Clients
```

### 3. Web Interface Integration
```
Web UI → Node.js WebSocket (/ws) → Overlay Commands → C# Server
```

## KasmVNC Integration Requirements

### Current State

### Required Changes

#### 1. Update Node.js Server Configuration
```javascript
const config = {
  kasmvncUrl: process.env.KASMVNC_URL || 'http://localhost:6901',
};
```

#### 2. Update MCP Configuration Generation
```javascript
app.get('/mcp-config', (req, res) => {
  const mcpConfig = {
    desktop: {
      target: 'kasmvnc-session',  // Changed from 'fedora-silverblue'
      kasmvnc_url: config.kasmvncUrl,
      multi_monitor: true,  // KasmVNC native support
      viewport: {
        w: 1920,
        h: 1080,
        devicePixelRatio: 1.0
      }
    }
  };
});
```

#### 3. WebSocket Integration with KasmVNC
```javascript
// Bridge between MCP WebSocket and KasmVNC web interface
function bridgeToKasmVNC(overlayCommand) {
  // Forward overlay commands to KasmVNC web interface
  // KasmVNC provides native WebSocket API for overlays
  const kasmvncWs = new WebSocket(`${config.kasmvncUrl}/websockify`);
  kasmvncWs.send(JSON.stringify({
    type: 'overlay_command',
    payload: overlayCommand
  }));
}
```

## Container Communication

### Current Container Network
```yaml
# KasmVNC Architecture (4 containers)
services:
  kasmvnc:
    ports:
      - "6901:6901"   # KasmVNC web interface
    networks:
      - overlay-network

  mcp-server:
    environment:
      KASMVNC_URL: http://kasmvnc:6901  # Internal container communication
    ports:
      - "3001:3000"   # C# MCP server
    networks:
      - overlay-network

  overlay-web:
    environment:
      MCP_SERVER_URL: http://mcp-server:3000  # Internal communication
      KASMVNC_URL: http://kasmvnc:6901
    ports:
      - "8080:8080"   # Node.js management server
    networks:
      - overlay-network

  caddy:
    ports:
      - "80:80"       # Unified proxy
    networks:
      - overlay-network
```

### Communication Paths
1. **External → Caddy → Services**: Unified entry point
2. **Web UI → Node.js → C# MCP**: Tool execution
3. **C# MCP → WebSocket → Web UI**: Overlay events
4. **Web UI → KasmVNC**: Direct VNC connection
5. **MCP → KasmVNC**: Overlay rendering integration

## Security Considerations

### Current Security
- **CORS Configuration**: Configurable allowed origins
- **WebSocket Authentication**: Token-based (development mode)
- **Container Isolation**: Network-level separation

### KasmVNC Security Integration
- **VNC Password**: Environment variable injection
- **Web Authentication**: KasmVNC built-in auth
- **SSL/TLS**: KasmVNC native SSL support
- **Session Management**: KasmVNC handles user sessions

## Performance Characteristics

### WebSocket Performance
- **C# Server**: High-performance concurrent WebSocket handling
- **Node.js Bridge**: Additional layer adds ~1-2ms latency
- **Overlay Broadcasting**: Real-time updates to multiple clients

### Multi-Monitor Support
- **C# Server**: Native multi-monitor detection via `IScreenCaptureService`
- **KasmVNC**: Native multi-monitor with separate browser windows
- **WebSocket Sync**: Overlay coordinates mapped to correct monitors

## Development and Testing

### Local Development
```bash
# Start C# MCP server
cd src && dotnet run --urls http://0.0.0.0:3000

# Start Node.js management server
cd infra/server && npm start

# Start KasmVNC container
podman-compose -f kasmvnc-compose.yml up kasmvnc
```

### Health Monitoring
```javascript
// Health check includes all services
app.get('/health', async (req, res) => {
  const health = {
    services: {
      webServer: 'running',
      websocket: config.mcpWsEnabled ? 'enabled' : 'disabled',
      mcpServer: await checkMcpServerHealth(),
      kasmvnc: await checkKasmVNCHealth(),
      connectedClients: overlayClients.size
    }
  };
});
```

## Recommendations

### 1. Simplify Architecture
Consider **consolidating** the Node.js management server functionality into the C# server to reduce complexity:
- Serve static files from C# server
- Handle MCP configuration generation in C#
- Eliminate proxy layer

### 2. Direct KasmVNC Integration
Implement **direct WebSocket communication** between C# MCP server and KasmVNC:
- Use KasmVNC's native WebSocket API
- Eliminate Node.js bridge layer
- Reduce latency and complexity

### 3. Enhanced Multi-Monitor Support
Leverage KasmVNC's **native multi-monitor capabilities**:
- Map overlay coordinates to specific displays
- Support display-specific overlay commands
- Sync display configuration changes

### 4. Improved Security
Implement **production-ready security**:
- JWT-based WebSocket authentication
- Encrypted overlay command transmission
- Rate limiting for overlay operations
- Audit logging for MCP tool usage

This analysis provides the foundation for implementing proper MCP server integration with the new KasmVNC architecture.

---
# Appendix: KasmVNC integration design (consolidated)
# MCP-KasmVNC Integration Design

## Overview


## Architecture Changes

```
                ↓
```

### After (KasmVNC - Current)
```
AI Client → C# MCP Server → KasmVNC Native API
                ↓
         Web Interface → KasmVNC Web → Multi-Monitor Windows
```

## Integration Components

### 1. KasmVNC Service Integration

#### Update C# MCP Server Configuration
```csharp
// Program.cs - Add KasmVNC service registration
builder.Services.AddSingleton<IKasmVNCService, KasmVNCService>();
builder.Services.Configure<KasmVNCOptions>(options =>
{
    options.BaseUrl = Environment.GetEnvironmentVariable("KASMVNC_URL") ?? "http://kasmvnc:6901";
    options.WebSocketUrl = Environment.GetEnvironmentVariable("KASMVNC_WS_URL") ?? "ws://kasmvnc:6901/websockify";
    options.AdminPort = int.Parse(Environment.GetEnvironmentVariable("KASMVNC_ADMIN_PORT") ?? "3000");
});
```

#### KasmVNC Service Implementation
```csharp
// Services/KasmVNCService.cs
public interface IKasmVNCService
{
    Task<bool> IsConnectedAsync();
    Task<DisplayInfo[]> GetDisplaysAsync();
    Task SendOverlayCommandAsync(OverlayCommand command);
    Task<string> GetSessionStatusAsync();
    Task<bool> TestConnectionAsync();
}

public class KasmVNCService : IKasmVNCService
{
    private readonly HttpClient _httpClient;
    private readonly KasmVNCOptions _options;
    private readonly ILogger<KasmVNCService> _logger;
    private ClientWebSocket? _webSocket;

    public async Task<DisplayInfo[]> GetDisplaysAsync()
    {
        // Query KasmVNC for current display configuration
        var response = await _httpClient.GetAsync($"{_options.BaseUrl}/api/displays");
        if (response.IsSuccessStatusCode)
        {
            var json = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<DisplayInfo[]>(json) ?? Array.Empty<DisplayInfo>();
        }
        return Array.Empty<DisplayInfo>();
    }

    public async Task SendOverlayCommandAsync(OverlayCommand command)
    {
        if (_webSocket?.State == WebSocketState.Open)
        {
            var message = JsonSerializer.Serialize(new
            {
                type = "overlay_command",
                command = command.Type,
                x = command.X,
                y = command.Y,
                width = command.Width,
                height = command.Height,
                color = command.Color,
                opacity = command.Opacity,
                monitor_index = command.MonitorIndex,
                click_through = command.ClickThrough
            });
            
            var buffer = Encoding.UTF8.GetBytes(message);
            await _webSocket.SendAsync(buffer, WebSocketMessageType.Text, true, CancellationToken.None);
        }
    }
}
```

### 2. Updated MCP Tools for KasmVNC

#### Enhanced Display Info Tool
```csharp
// MCP/Tools/GetDisplayInfoTool.cs - Updated for KasmVNC
[Tool("get_display_info")]
public class GetDisplayInfoTool : IMcpTool<GetDisplayInfoRequest, GetDisplayInfoResponse>
{
    private readonly IKasmVNCService _kasmvncService;
    private readonly IScreenCaptureService _screenCaptureService;

    public async Task<GetDisplayInfoResponse> ExecuteAsync(GetDisplayInfoRequest request)
    {
        // Get displays from both local capture service and KasmVNC
        var localDisplays = await _screenCaptureService.GetMonitorsAsync();
        var kasmDisplays = await _kasmvncService.GetDisplaysAsync();
        
        return new GetDisplayInfoResponse
        {
            Displays = localDisplays.Select((display, index) => new DisplayInfo
            {
                Index = index,
                X = display.X,
                Y = display.Y,
                Width = display.Width,
                Height = display.Height,
                IsPrimary = display.IsPrimary,
                KasmVNCSupported = kasmDisplays.Any(k => k.Index == index),
                ScaleFactor = display.ScaleFactor
            }).ToArray(),
            TotalWidth = localDisplays.Any() ? localDisplays.Max(d => d.X + d.Width) : 1920,
            TotalHeight = localDisplays.Any() ? localDisplays.Max(d => d.Y + d.Height) : 1080,
            KasmVNCConnected = await _kasmvncService.IsConnectedAsync()
        };
    }
}
```

#### KasmVNC-Aware Overlay Tool
```csharp
// MCP/Tools/CreateOverlayTool.cs - New tool for KasmVNC integration
[Tool("create_overlay")]
public class CreateOverlayTool : IMcpTool<CreateOverlayRequest, CreateOverlayResponse>
{
    private readonly IOverlayService _overlayService;
    private readonly IKasmVNCService _kasmvncService;

    public async Task<CreateOverlayResponse> ExecuteAsync(CreateOverlayRequest request)
    {
        // Create overlay locally
        var overlay = new OverlayElement
        {
            Bounds = new ScreenRegion(request.X, request.Y, request.Width, request.Height),
            Color = request.Color ?? "#ff0000",
            Opacity = request.Opacity ?? 0.5,
            Label = request.Label,
            ClickThrough = request.ClickThrough ?? true,
            MonitorIndex = request.MonitorIndex ?? 0,
            TemporaryMs = request.TemporaryMs
        };

        var overlayId = await _overlayService.DrawOverlayAsync(overlay);

        // Send to KasmVNC for web display
        await _kasmvncService.SendOverlayCommandAsync(new OverlayCommand
        {
            Type = "create",
            Id = overlayId,
            X = request.X,
            Y = request.Y,
            Width = request.Width,
            Height = request.Height,
            Color = request.Color,
            Opacity = request.Opacity,
            MonitorIndex = request.MonitorIndex,
            ClickThrough = request.ClickThrough
        });

        return new CreateOverlayResponse
        {
            OverlayId = overlayId,
            Success = true,
            KasmVNCSync = await _kasmvncService.IsConnectedAsync()
        };
    }
}
```

### 3. Web Interface Updates

#### KasmVNC Client Integration
```javascript
// infra/web/src/components/KasmVNCClient.js - Enhanced with MCP integration
export class KasmVNCClient {
    constructor(options) {
        this.kasmvncUrl = options.kasmvncUrl || 'http://localhost:6901';
        this.mcpWebSocket = null;
        this.overlayCanvas = null;
        this.displays = [];
    }

    async connect() {
        // Connect to KasmVNC web interface
        this.iframe = document.createElement('iframe');
        this.iframe.src = `${this.kasmvncUrl}/vnc.html`;
        this.iframe.style.width = '100%';
        this.iframe.style.height = '100%';
        
        // Create overlay canvas for MCP overlays
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.style.position = 'absolute';
        this.overlayCanvas.style.top = '0';
        this.overlayCanvas.style.left = '0';
        this.overlayCanvas.style.pointerEvents = 'none';
        this.overlayCanvas.style.zIndex = '1000';
        
        // Connect to MCP WebSocket for overlay commands
        await this.connectMCPWebSocket();
        
        return true;
    }

    async connectMCPWebSocket() {
        const wsUrl = `ws://${window.location.host}/ws/overlays`;
        this.mcpWebSocket = new WebSocket(wsUrl);
        
        this.mcpWebSocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleMCPMessage(message);
        };
    }

    handleMCPMessage(message) {
        switch (message.type) {
            case 'overlay_created':
                this.drawOverlay(message.overlay);
                break;
            case 'overlay_removed':
                this.removeOverlay(message.overlayId);
                break;
            case 'overlay_updated':
                this.updateOverlay(message.overlay);
                break;
            case 'sync_state':
                this.syncOverlays(message.overlays);
                break;
        }
    }

    drawOverlay(overlay) {
        const ctx = this.overlayCanvas.getContext('2d');
        
        // Map overlay coordinates to display
        const display = this.displays[overlay.monitor_index] || this.displays[0];
        const x = display ? display.x + overlay.x : overlay.x;
        const y = display ? display.y + overlay.y : overlay.y;
        
        // Draw overlay with specified properties
        ctx.globalAlpha = overlay.opacity;
        ctx.fillStyle = overlay.color;
        ctx.fillRect(x, y, overlay.width, overlay.height);
        
        // Add label if provided
        if (overlay.label) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px Arial';
            ctx.fillText(overlay.label, x + 5, y + 15);
        }
    }

    async getDisplayInfo() {
        // Query KasmVNC for display configuration
        try {
            const response = await fetch(`${this.kasmvncUrl}/api/displays`);
            if (response.ok) {
                this.displays = await response.json();
                return this.displays;
            }
        } catch (error) {
            console.warn('Could not get KasmVNC display info:', error);
        }
        
        // Fallback to single display
        return [{ index: 0, x: 0, y: 0, width: 1920, height: 1080, isPrimary: true }];
    }
}
```

### 4. Container Configuration Updates

#### Updated Docker Compose
```yaml
# infra/kasmvnc-compose.yml - Enhanced MCP integration
services:
  kasmvnc:
    build:
      context: ..
      dockerfile: infra/Dockerfile.kasmvnc
    container_name: overlay-companion-kasmvnc
    environment:
      VNC_PASSWORD: ${VNC_PASSWORD:-changeme}
      KASM_PASSWORD: ${KASM_PASSWORD:-admin}
      # Enable API endpoints for MCP integration
      KASM_API_ENABLED: "true"
      KASM_OVERLAY_SUPPORT: "true"
    volumes:
      - ./kasmvnc-config:/etc/kasmvnc:ro
      - /dev/shm:/dev/shm
    ports:
      - "${KASMVNC_PORT:-6901}:6901"
      - "${KASMVNC_API_PORT:-6902}:6902"  # API endpoint
    restart: unless-stopped
    networks:
      - overlay-network

  mcp-server:
    build:
      context: ..
      dockerfile: infra/Dockerfile.mcp
    container_name: overlay-companion-mcp
    environment:
      ASPNETCORE_URLS: http://0.0.0.0:3000
      # KasmVNC integration
      KASMVNC_URL: http://kasmvnc:6901
      KASMVNC_WS_URL: ws://kasmvnc:6901/websockify
      KASMVNC_API_URL: http://kasmvnc:6902
    ports:
      - "${MCP_PORT:-3001}:3000"
    depends_on:
      - kasmvnc
    restart: unless-stopped
    networks:
      - overlay-network
```

#### Enhanced KasmVNC Configuration
```yaml
# infra/kasmvnc-config/kasmvnc.yaml - API and overlay support
desktop:
  resolution:
    width: 1920
    height: 1080
  allow_resize: true

network:
  interface: 0.0.0.0
  websocket_port: 6901
  vnc_port: 5901
  api_port: 6902  # New API endpoint
  ssl:
    pem: /etc/ssl/certs/self.pem
    require_ssl: false

# API configuration for MCP integration
api:
  enabled: true
  endpoints:
    - /api/displays
    - /api/overlays
    - /api/session
  cors:
    enabled: true
    origins: ["*"]  # Restrict in production

# Enhanced overlay support
overlay:
  enabled: true
  click_through: true
  transparency: 0.5
  websocket_commands: true  # Enable WebSocket overlay commands
  multi_monitor: true

# Multi-monitor configuration
display_manager:
  enabled: true
  max_displays: 4
  default_layout: horizontal
  api_integration: true  # Expose display info via API
```

### 5. Health Monitoring and Status

#### Enhanced Health Check
```csharp
// Add to Program.cs - KasmVNC health monitoring
app.MapGet("/health", async (IKasmVNCService kasmvnc, IOverlayService overlay) =>
{
    var health = new
    {
        status = "healthy",
        timestamp = DateTime.UtcNow,
        services = new
        {
            mcp_server = "running",
            overlay_service = "running",
            kasmvnc_connection = await kasmvnc.IsConnectedAsync(),
            kasmvnc_session = await kasmvnc.GetSessionStatusAsync(),
            active_overlays = (await overlay.GetActiveOverlaysAsync()).Count(),
            websocket_clients = /* get from hub */ 0
        },
        capabilities = new
        {
            multi_monitor = true,
            overlay_system = true,
            click_through = true,
            kasmvnc_integration = true
        }
    };
    
    return Results.Json(health);
});
```

## Migration Steps

### 1. Update MCP Server Dependencies
```bash
# Add KasmVNC integration packages
dotnet add package System.Net.WebSockets.Client
dotnet add package Microsoft.Extensions.Http
```

### 2. Implement KasmVNC Service
- Create `IKasmVNCService` interface
- Implement WebSocket communication
- Add display detection integration
- Update MCP tools to use KasmVNC service

### 3. Update Web Interface
- Add overlay canvas management
- Implement multi-monitor display mapping
- Update WebSocket message handling

### 4. Container Configuration
- Update environment variables
- Add KasmVNC API endpoints
- Configure overlay support
- Test container communication

### 5. Testing and Validation
- Test MCP tool execution with KasmVNC
- Validate multi-monitor overlay placement
- Test WebSocket communication
- Verify health monitoring

## Benefits of New Integration

### Simplified Architecture
- **Eliminated PostgreSQL**: No database complexity
- **Direct API Integration**: Native KasmVNC API usage
- **Reduced Latency**: Fewer proxy layers

### Enhanced Functionality
- **True Multi-Monitor**: Native KasmVNC multi-monitor support
- **Better Performance**: WebSocket-based overlay commands
- **Improved Reliability**: Direct service communication

### Developer Experience
- **Easier Setup**: No database initialization
- **Better Debugging**: Direct API responses
- **Cleaner Code**: Fewer abstraction layers

This integration design provides a robust foundation for MCP-KasmVNC communication while maintaining the system's core overlay and multi-monitor capabilities.