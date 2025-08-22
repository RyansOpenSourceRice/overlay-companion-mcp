# Task List

1. ✅ Analyze the libSkiaSharp.so missing dependency issue in AppImage
Identified that AppImage build process doesn't include native SkiaSharp libraries needed by Avalonia GUI. Found libSkiaSharp.so and libHarfBuzzSharp.so in dotnet publish output.
2. ✅ Complete GTK4 migration Phase 3 - Build system updates
Successfully migrated from Avalonia to GTK4 with stub implementations. Project now builds successfully with GTK4 architecture in place. All compilation errors resolved.
3. ✅ Test GTK4 application functionality in headless mode
Application runs successfully with --smoke-test --headless flags. HTTP server starts correctly and smoke test passes.
4. ⏳ Fix AppImage build script to include native SkiaSharp dependencies
Need to modify build-appimage.sh to copy native libraries from dotnet publish output to AppDir/usr/lib. This is now lower priority since we've migrated to GTK4.
5. ⏳ Replace GTK4 stub implementations with real GirCore packages
Once runtime environment supports GTK4, uncomment GirCore package references and remove stub implementations to enable full GTK4 functionality.
6. ⏳ Test true GTK4 click-through functionality on Wayland
Phase 4 testing - verify surface.SetInputRegion(null!) provides true OS-level click-through on actual Fedora Wayland system.
7. ⏳ Update AppImage packaging for GTK4 dependencies
Modify AppImage build to include GTK4 native libraries instead of Avalonia/Skia dependencies.

