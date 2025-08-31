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