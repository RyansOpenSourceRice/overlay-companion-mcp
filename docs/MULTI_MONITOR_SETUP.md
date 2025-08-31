# Multi-Monitor Setup Guide

This guide explains how to configure and use multi-monitor support with the Overlay Companion MCP system using KasmVNC.

## Overview


## Architecture Comparison

- **Single Canvas**: All monitors rendered as one large canvas
- **Limited Control**: No individual monitor management
- **Scaling Issues**: Difficult to handle different resolutions
- **Browser Limitations**: Single window/tab for all displays

### KasmVNC (Recommended)
- **Separate Windows**: Each monitor opens in its own browser window
- **Individual Control**: Independent resolution and scaling per monitor
- **Native Support**: Built-in Display Manager for monitor configuration
- **Flexible Layout**: Horizontal, vertical, or custom arrangements

## Prerequisites

### Hardware Requirements
- **Physical Displays**: At least 2 physical monitors connected to your system
- **Graphics Card**: Support for multiple display outputs
- **System RAM**: Additional 2GB RAM per extra monitor (recommended)

### Software Requirements
- **Modern Browser**: Chrome, Firefox, or Edge with popup support enabled
- **Network**: Stable connection for multiple video streams

## Configuration

### 1. Host Container Setup

Use the KasmVNC setup script:
```bash
# Install KasmVNC-based containers
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/host-setup-kasmvnc.sh | bash
```

### 2. Remote System Configuration

Configure the remote system with KasmVNC server:
```bash
# Install KasmVNC server on remote system
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/vm-setup-kasmvnc.sh | bash
```

### 3. KasmVNC Display Manager Configuration

Edit the KasmVNC configuration file (`~/.vnc/kasmvnc.yaml`) on the remote system:

```yaml
# Multi-monitor configuration
display_manager:
  enabled: true
  max_displays: 4  # Maximum number of displays to support
  default_layout: horizontal  # horizontal, vertical, or custom
  
  # Individual display settings
  displays:
    - id: 1
      resolution:
        width: 1920
        height: 1080
      position:
        x: 0
        y: 0
    - id: 2
      resolution:
        width: 1920
        height: 1080
      position:
        x: 1920
        y: 0
    - id: 3
      resolution:
        width: 1920
        height: 1080
      position:
        x: 3840
        y: 0

# Performance optimization for multiple displays
encoding:
  max_frame_rate: 30  # Reduce for multiple displays
  jpeg_quality: 7     # Balance quality vs bandwidth
  prefer_bandwidth: 80  # Prioritize bandwidth efficiency

# Network configuration
network:
  websocket_port: 6901
  max_connections: 10  # Allow multiple display connections
```

### 4. Virtual Display Configuration

For headless systems, configure virtual displays using Xvfb:

```bash
# Create startup script with multiple virtual displays
cat > ~/.vnc/start-multi-display.sh << 'EOF'
#!/bin/bash

# Start Xvfb with multiple screens
Xvfb :1 -screen 0 1920x1080x24 -screen 1 1920x1080x24 -screen 2 1920x1080x24 -ac -nolisten tcp -dpi 96 &
XVFB_PID=$!

# Wait for Xvfb to start
sleep 3

# Set display environment
export DISPLAY=:1

# Start window manager on each screen
DISPLAY=:1.0 openbox &
DISPLAY=:1.1 openbox &
DISPLAY=:1.2 openbox &

# Start applications on different screens
DISPLAY=:1.0 gnome-terminal &
DISPLAY=:1.1 firefox &
DISPLAY=:1.2 gedit &

# Start KasmVNC with multi-display support
kasmvnc -geometry 1920x1080 -depth 24 -websocket 6901 -httpd /usr/share/kasmvnc/www -config ~/.vnc/kasmvnc.yaml :1

# Cleanup on exit
trap "kill $XVFB_PID" EXIT
EOF

chmod +x ~/.vnc/start-multi-display.sh
```

## Usage

### 1. Accessing the Primary Display

1. Open your browser and navigate to: `http://localhost:8080/vnc`
2. Click "Connect" to access the primary display
3. The main desktop will appear in your browser

### 2. Adding Additional Displays

**Method A: Using the Web Interface**
1. In the KasmVNC client, click the "Add Display" button
2. A new browser window will open for the second display
3. Repeat for additional displays (up to configured maximum)

**Method B: Direct URL Access**
1. Open new browser tabs/windows
2. Navigate to:
   - Display 1: `http://localhost:8080/vnc?display=1`
   - Display 2: `http://localhost:8080/vnc?display=2`
   - Display 3: `http://localhost:8080/vnc?display=3`

### 3. Managing Multiple Displays

**Window Arrangement:**
- Arrange browser windows to match your physical monitor layout
- Use browser fullscreen mode (F11) for immersive experience
- Enable browser popup permissions for automatic window opening

**Display Switching:**
- Use the display selector dropdown in the KasmVNC interface
- Alt+Tab between browser windows for quick switching
- Use browser bookmarks for quick access to specific displays

## Overlay System Integration

### Multi-Monitor Overlay Support

The MCP overlay system automatically detects and supports multiple displays:

```javascript
// Overlay system detects multiple KasmVNC displays
const displays = kasmvncClient.getDisplays();
console.log(`Found ${displays.length + 1} displays`);

// Create overlay canvas for each display
displays.forEach((display, index) => {
    const overlay = new OverlayCanvas(`display-${index + 1}`);
    overlay.attachToDisplay(display.window);
});
```

### AI Interaction Across Displays

The AI can interact with elements across all displays:

```json
{
  "type": "multi_display_annotation",
  "displays": [
    {
      "display_id": 1,
      "annotations": [
        {"type": "highlight", "x": 100, "y": 200, "width": 300, "height": 50}
      ]
    },
    {
      "display_id": 2,
      "annotations": [
        {"type": "arrow", "from": {"x": 500, "y": 300}, "to": {"x": 600, "y": 400}}
      ]
    }
  ]
}
```

## Troubleshooting

### Common Issues

**Issue: Second display window doesn't open**
- Check browser popup blocker settings
- Manually allow popups for the KasmVNC domain
- Try opening displays manually using direct URLs

**Issue: Poor performance with multiple displays**
- Reduce frame rate in KasmVNC configuration
- Lower JPEG quality settings
- Check network bandwidth capacity
- Consider reducing resolution for secondary displays

**Issue: Displays appear in wrong positions**
- Verify Xvfb screen configuration matches KasmVNC settings
- Check display position settings in `kasmvnc.yaml`
- Restart KasmVNC service after configuration changes

**Issue: Overlay annotations appear on wrong display**
- Verify display ID mapping in overlay system
- Check browser window focus and active display
- Ensure MCP server correctly identifies target display

### Performance Optimization

**Network Optimization:**
```yaml
# Optimize for multiple displays
encoding:
  max_frame_rate: 24        # Reduce from 60fps
  jpeg_quality: 6           # Balance quality vs bandwidth
  webp_quality: 6           # Use WebP for better compression
  prefer_bandwidth: 90      # Prioritize bandwidth over quality
  
# Connection limits
network:
  max_connections: 8        # Limit concurrent connections
  connection_timeout: 30    # Reduce timeout for faster failover
```

**System Resource Optimization:**
```bash
# Limit CPU usage per display
systemctl --user edit kasmvnc.service

# Add resource limits
[Service]
CPUQuota=200%           # Limit to 2 CPU cores
MemoryMax=4G            # Limit RAM usage
```

### Testing Multi-Monitor Setup

**Note**: Multi-monitor functionality requires physical displays or advanced virtual display configuration. Testing in headless environments is limited.

**Virtual Testing Setup:**
```bash
# Create test script for multi-display validation
cat > test-multi-display.sh << 'EOF'
#!/bin/bash

echo "Testing multi-display configuration..."

# Check Xvfb screens
xrandr --display :1 --listmonitors

# Test KasmVNC display manager
curl -s http://localhost:6901/api/displays | jq .

# Verify overlay system detection
curl -s http://localhost:3001/api/displays | jq .

echo "Multi-display test complete"
EOF

chmod +x test-multi-display.sh
./test-multi-display.sh
```

## Best Practices

### 1. Display Layout Planning
- Plan your virtual display layout to match physical monitors
- Use consistent resolutions when possible
- Consider bandwidth limitations for remote access

### 2. Browser Configuration
- Use dedicated browser profiles for each display
- Enable hardware acceleration in browser settings
- Configure appropriate zoom levels for each display

### 3. Network Considerations
- Ensure sufficient bandwidth for multiple video streams
- Use wired connections when possible
- Consider Quality of Service (QoS) configuration

### 4. Security
- Limit KasmVNC access to trusted networks
- Use VPN for remote multi-monitor access
- Regularly update KasmVNC and container images

## Advanced Configuration

### Custom Display Layouts

Create custom display arrangements:

```yaml
# Custom L-shaped layout
display_manager:
  enabled: true
  max_displays: 3
  custom_layout:
    - id: 1
      position: {x: 0, y: 0}
      resolution: {width: 1920, height: 1080}
    - id: 2
      position: {x: 1920, y: 0}
      resolution: {width: 1920, height: 1080}
    - id: 3
      position: {x: 0, y: 1080}
      resolution: {width: 1920, height: 1080}
```

### Integration with External Tools

Connect with external monitoring and management tools:

```bash
# Export display configuration for external tools
kasmvnc-config export --format json > displays.json

# Import configuration from external source
kasmvnc-config import --file external-displays.json
```

## Conclusion

KasmVNC's multi-monitor support provides a significant improvement over traditional VNC solutions, offering true multi-display capabilities that integrate seamlessly with the Overlay Companion MCP system. While testing requires physical displays, the configuration and setup process is straightforward and well-documented.

For additional support or advanced configurations, refer to the [KasmVNC documentation](https://kasmweb.com/kasmvnc) or open an issue in the project repository.