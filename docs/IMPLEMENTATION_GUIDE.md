# Implementation Guide

## Technology Stack

### Core Framework
- **.NET 8.0** - Latest LTS version for cross-platform support
- **C# 12** - Modern language features and performance
- **Avalonia UI** - Cross-platform UI framework for overlay windows

### MCP Integration
- **ModelContextProtocol SDK** - Official Microsoft/Anthropic MCP C# SDK
- **Microsoft.Extensions.Hosting** - .NET hosting and dependency injection
- **Microsoft.Extensions.DependencyInjection** - Service container
- **Cherry Studio Client** - AI model integration via MCP protocol

### Linux Integration
- **Wayland-first (X11 fallback)** - Linux window management and compositors
- **wtype/ydotool (Wayland) / xdotool (X11)** - Mouse and keyboard automation
- **grim/spectacle/gnome-screenshot (Wayland) / scrot/maim (X11)** - Screen capture utilities
- **swaymsg/hyprctl/wayland-info (Wayland) / xrandr (X11)** - Multi-monitor support
- **gsettings** - HiDPI detection

## Project Structure

```
overlay-companion-mcp/
├── src/
│   ├── mcp/                    # MCP Server Implementation
│   │   ├── server.cs          # Main MCP server
│   │   ├── tools/             # MCP tool implementations
│   │   └── protocol/          # MCP protocol handling
│   ├── core/                  # Core screen interaction
│   │   ├── screenshot.cs      # Screenshot capture
│   │   ├── overlay.cs         # Overlay management
│   │   ├── input.cs           # Input simulation
│   │   └── display.cs         # Multi-monitor support
│   ├── modes/                 # Operational modes
│   │   ├── passive.cs         # Passive mode
│   │   ├── assist.cs          # Assist mode
│   │   ├── autopilot.cs       # Autopilot mode
│   │   └── composing.cs       # Composing mode
│   └── utils/                 # Utilities
│       ├── privacy.cs         # Screenshot scrubbing
│       ├── performance.cs     # Rate limiting
│       └── config.cs          # Configuration
├── tests/                     # Unit tests
├── docs/                      # Documentation
└── build/                     # Build scripts
```

## Implementation Phases

### Phase 1: Core MCP Server
1. **MCP Protocol Implementation**
   - JSON-RPC 2.0 communication
   - Tool registration and discovery
   - Error handling and validation

2. **Basic Tools Implementation**
   - `take_screenshot`
   - `draw_overlay`
   - `remove_overlay`
   - `set_mode`

### Phase 2: Screen Interaction Core
1. **Screenshot System**
   - Multi-monitor capture
   - Region-specific capture
   - Performance optimization
   - Privacy scrubbing

2. **Overlay System**
   - Transparent window management
   - Multi-monitor positioning
   - DPI awareness
   - Temporary overlays

### Phase 3: Input Simulation
1. **Safe Input Handling**
   - User confirmation mechanisms
   - Mode-based restrictions
   - Rate limiting

2. **Advanced Tools**
   - `click_at`
   - `type_text`
   - `get_clipboard`
   - `set_clipboard`

### Phase 4: Advanced Features
1. **Element Anchoring**
   - Visual element tracking
   - Coordinate stability
   - Re-anchoring system

2. **Batch Operations**
   - `batch_overlay`
   - Performance optimization

## Code Extraction Guidelines

### From Previous Project - EXTRACT:
- **Screen capture mechanisms** (remove job context)
- **Overlay drawing code** (generalize labels)
- **Input simulation** (remove job-specific actions)
- **Multi-monitor handling**
- **DPI scaling logic**
- **Performance optimizations**

### From Previous Project - AVOID:
- Job application logic
- Resume/cover letter handling
- Job site specific code
- Hiring-related terminology
- Application form logic

## MCP Tool Implementation Example

```csharp
public class TakeScreenshotTool : IMcpTool
{
    public string Name => "take_screenshot";
    
    public async Task<McpResult> ExecuteAsync(McpRequest request)
    {
        var parameters = request.Parameters;
        var region = parameters.GetValueOrDefault("region");
        var fullScreen = parameters.GetValueOrDefault("full_screen", true);
        
        // Extract screenshot logic from previous project
        var screenshot = await _screenshotService.CaptureAsync(
            region: region,
            fullScreen: fullScreen
        );
        
        return new McpResult
        {
            ImageBase64 = screenshot.ToBase64(),
            Width = screenshot.Width,
            Height = screenshot.Height,
            MonitorIndex = screenshot.MonitorIndex,
            DisplayScale = screenshot.DisplayScale
        };
    }
}
```

## Mode System Implementation

```csharp
public enum OperationalMode
{
    Passive,    // View only, no actions
    Assist,     // Suggest actions, require confirmation
    Autopilot,  // Execute actions with user oversight
    Composing,  // Content creation mode
    Custom      // User-defined mode
}

public class ModeManager
{
    private OperationalMode _currentMode = OperationalMode.Passive;
    
    public bool CanExecuteAction(string actionType)
    {
        return _currentMode switch
        {
            OperationalMode.Passive => false,
            OperationalMode.Assist => RequiresConfirmation(actionType),
            OperationalMode.Autopilot => true,
            OperationalMode.Composing => IsComposingAction(actionType),
            _ => false
        };
    }
}
```

## Integration with Cherry Studio

The MCP server should be designed to work with Cherry Studio:

```csharp
public class McpServer
{
    // Cherry Studio will connect to this server via JSON-RPC
    public async Task HandleRequest(string jsonRpcRequest)
    {
        var request = JsonSerializer.Deserialize<McpRequest>(jsonRpcRequest);
        var tool = _toolRegistry.GetTool(request.Method);
        var result = await tool.ExecuteAsync(request);
        
        return JsonSerializer.Serialize(result);
    }
}
```

## Privacy and Security

Implement privacy controls from the start:

```csharp
public class PrivacyManager
{
    public async Task<Screenshot> ScrubScreenshot(Screenshot original)
    {
        // Remove sensitive information
        // Blur personal data
        // Redact confidential content
        return scrubbed;
    }
}
```

## Next Steps

1. **Set up C# project structure**
2. **Implement basic MCP server**
3. **Extract reusable screen interaction code**
4. **Remove all job-specific references**
5. **Implement mode system**
6. **Add privacy controls**
7. **Create comprehensive tests**

## Testing Strategy

- **Unit tests** for each MCP tool
- **Integration tests** with Cherry Studio
- **Multi-monitor testing**
- **DPI scaling tests**
- **Privacy scrubbing validation**
- **Performance benchmarks**