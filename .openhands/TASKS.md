# Task List

1. ✅ Review all Markdown documentation in repository
Reviewed 19 markdown files (~4011 lines). Summarized key elements relevant to GTK4, MCP transport, build, testing, and packaging.
2. 🔄 Replace GTK4 stub implementations with real GirCore packages
Enable GirCore packages in csproj, remove Gtk4Stubs.cs, adjust code if API differences cause build errors.
3. ⏳ Test true GTK4 click-through functionality on Wayland
After enabling GirCore and building, validate on Fedora Wayland that surface.SetInputRegion(null!) provides click-through.
4. ⏳ Update AppImage packaging for GTK4 dependencies
Modify AppImage build to include GTK4 native libraries instead of Avalonia/Skia dependencies.

