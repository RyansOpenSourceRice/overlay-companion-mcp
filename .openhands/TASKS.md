# Task List

1. ✅ Set up GTK4 development environment and dependencies
GTK4 4.8.3 installed successfully. Identified GirCore.Gtk-4.0 as the best C# binding (mature, stable, used by major projects like DevToys and Pinta).
2. 🔄 Create minimal GTK4 overlay window with click-through
Phase 1: Build basic GTK4 overlay window to verify true click-through works on Wayland using GirCore.Gtk-4.0.
3. ⏳ Migrate overlay system from Avalonia to GTK4
Phase 2: Replace AvaloniaOverlayWindow with GTK4 equivalent, maintain same API.
4. ⏳ Migrate main UI from Avalonia to GTK4
Phase 2: Replace MainWindow.axaml with GTK4 UI, keep MCP server unchanged.
5. ⏳ Update build system for GTK4 dependencies
Phase 3: Update AppImage build to include GTK4 runtime and native libraries.
6. ⏳ Test GTK4 implementation on Fedora Wayland
Phase 4: Verify click-through works perfectly, test all overlay features.

