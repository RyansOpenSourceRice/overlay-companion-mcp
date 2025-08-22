# Task List

1. ✅ Phase 2: Migrate overlay system from Avalonia to GTK4
✅ Converted overlay rendering, window management, and transparency from Avalonia to GTK4
2. ✅ Phase 2: Migrate main UI from Avalonia to GTK4
✅ Converted 4-tab interface (Screenshot, Overlay, Settings, MCP) from Avalonia to GTK4
3. ✅ Phase 2: Preserve MCP server integration during migration
✅ MCP tools and HTTP/stdio transport continue working with GTK4 UI
4. 🔄 Phase 3: Update build system for GTK4 dependencies
Modify AppImage build to include GTK4 native libraries instead of Avalonia/Skia
5. 🔄 Phase 3: Update project structure and dependencies
Replace Avalonia packages with GirCore.Gtk-4.0, update project files
6. ⏳ Phase 4: Test true click-through functionality
Verify OS-level click-through works on Wayland with real overlay scenarios
7. ⏳ Phase 4: Comprehensive testing on Fedora Wayland
Test all MCP tools, UI functionality, and AppImage deployment

