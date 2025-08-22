# Click-Through Overlay Analysis & Migration Plan

## Current Issue

The overlay windows are **transparent but not truly click-through**. This means:
- ✅ You can see through them (transparent background)
- ❌ But you **cannot click through** them to interact with underlying applications on Wayland
- ⚠️ Avalonia's `IsHitTestVisible = false` provides partial click-through but not true OS-level transparency

## Current Implementation (Avalonia)

Added basic click-through functionality:

1. **Hit Test Disabling**: Uses `IsHitTestVisible = false` to disable Avalonia-level mouse event capture
2. **Configurable**: Added `ClickThrough` property to `OverlayElement` (default: `true`)
3. **Cross-Platform**: Works on Windows/macOS/X11 but **limited on Wayland**

## The Wayland Problem

Avalonia cannot provide true click-through on native Wayland because:
- Wayland security model prevents arbitrary windows from becoming input-transparent
- Avalonia doesn't expose low-level Wayland compositor protocols
- `IsHitTestVisible = false` only affects Avalonia's hit testing, not OS-level input routing

## Recommended Solution: Migrate to GTK4

Based on external consultation with GPT-5, the best path forward for **Fedora Wayland + C#** is:

### GTK4 with Gtk4DotNet

**Why GTK4:**
- ✅ **Native Wayland Support**: First-class Wayland integration, no XWayland needed
- ✅ **True Click-Through**: `gtk_widget_set_can_target(FALSE)` provides OS-level input transparency
- ✅ **C# Bindings**: Gtk4DotNet provides modern .NET 8 bindings
- ✅ **Fedora Native**: GTK4 is the default GNOME/Fedora toolkit
- ✅ **AI-Friendly**: Extensive documentation and examples for AI assistance

**Installation:**
```bash
dotnet add package Gtk4DotNet
```

## Migration Plan

### Phase 1: Proof of Concept (2-3 days)
1. Create minimal GTK4 overlay window with click-through
2. Test on Fedora Wayland to verify true click-through works
3. Implement basic overlay drawing (colored rectangles)

### Phase 2: Core Migration (1-2 weeks)
1. Replace Avalonia UI components with GTK4 equivalents:
   - `AvaloniaOverlayWindow` → GTK4 `Window` with `ApplicationWindow`
   - `MainWindow.axaml` → GTK4 UI using `Builder` or code-behind
   - Avalonia controls → GTK4 widgets (`Button`, `Label`, `Grid`, etc.)

2. Update services:
   - `OverlayService` → Use GTK4 window management
   - Keep MCP server and HTTP transport unchanged
   - Update screenshot service for GTK4 integration

### Phase 3: Feature Parity (1 week)
1. Implement all current overlay features:
   - Multiple overlay windows
   - Color customization
   - Labels and text
   - Temporary overlays with timers
   - Batch overlay operations

2. Update build system:
   - Replace Avalonia dependencies with GTK4
   - Update AppImage build to include GTK4 runtime
   - Test packaging and distribution

### Phase 4: Testing & Polish (3-5 days)
1. Comprehensive testing on Fedora Wayland
2. Verify click-through functionality works perfectly
3. Performance testing and optimization
4. Update documentation and examples

## Effort Estimation

**Total Time**: 3-4 weeks
**Risk Level**: Medium (well-established migration path)
**Benefits**: True native Wayland click-through, better Fedora integration

## Alternative: Keep Avalonia + XWayland

If migration effort is too high:
1. Run application under XWayland instead of native Wayland
2. Use X11 input region APIs for click-through
3. Accept slightly higher resource usage and non-native feel

## Testing Current Implementation

To test the current Avalonia implementation:

1. **Start the application**: `./overlay-companion-mcp-2025.08.22-x86_64.AppImage`
2. **Create an overlay**: Use the MCP interface to draw an overlay over a web browser
3. **Test click-through**: Try clicking on buttons/links underneath the overlay
4. **Expected result**: Partial click-through (Avalonia-level only)

## API Usage (Current)

```json
{
  "method": "draw_overlay",
  "params": {
    "bounds": {"x": 100, "y": 100, "width": 200, "height": 50},
    "color": "red",
    "label": "Click through me!",
    "clickThrough": true
  }
}
```

## Decision Point

**Recommendation**: Proceed with GTK4 migration for true Wayland click-through support. The investment will provide:
- Native Fedora Wayland experience
- True OS-level click-through overlays
- Better long-term maintainability
- Alignment with Linux desktop standards