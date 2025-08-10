# Overlay Companion (MCP) - Tool Specification

*A general-purpose, human-in-the-loop AI-assisted screen interaction toolkit.*

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
              "label": { "type": "string", "optional": true },
              "temporary_ms": { "type": "number", "optional": true }
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

### Privacy Protection

- All operations are local-only
- Screenshot data can be scrubbed before sharing
- Clipboard access requires explicit permission
- No network communication

### Platform Integration

- Respects system accessibility settings
- Works with screen readers and assistive technology
- Follows platform-specific UI guidelines
- Handles multi-monitor setups correctly