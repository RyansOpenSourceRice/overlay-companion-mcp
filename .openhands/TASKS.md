# Task List

1. ✅ Verify Fedora GTK4 environment and install dependencies
Build succeeds locally with GirCore; Fedora verification pending user run
2. ✅ Replace GTK4 stub implementations with real GirCore packages
Enabled GirCore packages, removed stubs, fixed API mismatches (SetDrawFunc, ApplicationFlags, IdleAdd). Build passes.
3. ✅ Update project configuration for real GTK4
csproj updated, headless mode intact, smoke-test ready file works.
4. ✅ Build and test with real GTK4 implementation
Release build OK. Headless smoke test passed; HTTP server starts and exits cleanly.
5. ⏳ Test true click-through functionality on Wayland
Requires running GUI on Fedora Wayland; validate SetInputRegion(null!).
6. ✅ Build final GTK4 AppImage with native libraries
AppImage built using extraction method without FUSE. Size ~41MB.

