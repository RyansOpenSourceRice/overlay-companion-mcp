# Task List

1. ✅ Research GTK4/Wayland click-through overlays and validate approach
Use empty input region on GdkSurface after realize. Consider gtk4-layer-shell for stable z-order.
2. ✅ Implement true click-through in Gtk4OverlayWindow using empty input region
Set empty Cairo.Region in OnWindowRealized, keep fullscreen transparent window, draw only requested rectangle.
3. 🔄 Add overlay opacity support end-to-end
Added OverlayElement.Opacity, wired into draw path; still need to expose to UI and MCP tool (done), and validate color parsing including hex with alpha.
4. ✅ Fix DrawOverlayTool parameter handling and id/label mapping
Now constructs OverlayElement with Id=id, preserves ClickThrough, Opacity.
5. ✅ Ensure batch overlay APIs preserve overlay properties
Batch methods now call DrawOverlayAsync(OverlayElement).
6. ⏳ Add optional gtk4-layer-shell integration for robust z-order
Consider adding GirCore bindings or P/Invoke; guard behind feature flag.
7. ⏳ Ensure overlay never grabs keyboard focus
Investigate Gtk.ApplicationWindow focusable flags in GTK4 C# bindings; set to non-focusable if available.
8. ⏳ Install dotnet SDK, build and run tests locally
Environment currently lacks dotnet; required to validate functionality end-to-end.
9. 🔄 Improve color parsing to accept hex and apply alpha properly
Implement hex parsing (#RRGGBB/#RRGGBBAA/#RGB) and use overlay.Opacity for default alpha; replace named color table.

