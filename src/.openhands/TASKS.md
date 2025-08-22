# Task List

1. ✅ Analyze the libSkiaSharp.so missing dependency issue in AppImage
Identified that AppImage build process doesn't include native SkiaSharp libraries needed by Avalonia GUI. Found libSkiaSharp.so and libHarfBuzzSharp.so in dotnet publish output.
2. 🔄 Fix AppImage build script to include native SkiaSharp dependencies
Need to modify build-appimage.sh to copy native libraries from dotnet publish output to AppDir/usr/lib
3. ⏳ Test the fixed AppImage build and verify GUI initialization works
Build AppImage and test that Avalonia GUI starts without libSkiaSharp errors
4. ⏳ Add native library detection and bundling to build script
Ensure all required native dependencies are properly bundled in AppImage
5. ⏳ Update documentation with AppImage packaging fixes
Document the native dependency handling in build process

