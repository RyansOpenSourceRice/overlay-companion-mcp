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