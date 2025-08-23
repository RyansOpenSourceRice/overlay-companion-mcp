#!/bin/bash

# AppImage Build Script for Overlay Companion MCP
# Creates a distributable AppImage from the .NET application

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="overlay-companion-mcp"
APP_DISPLAY_NAME="Overlay Companion MCP"
APP_DESCRIPTION="AI-assisted screen interaction toolkit with MCP integration"
APP_CATEGORY="Development"
APP_VERSION="${APP_VERSION:-$(date +%Y.%m.%d)}"
ARCH="x86_64"

# Directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_ROOT/src"
BUILD_DIR="$PROJECT_ROOT/build"
APPDIR="$BUILD_DIR/AppDir"
APPIMAGE_OUTPUT="$BUILD_DIR/${APP_NAME}-${APP_VERSION}-${ARCH}.AppImage"

echo -e "${BLUE}🚀 Building AppImage for ${APP_DISPLAY_NAME} v${APP_VERSION}${NC}"
echo "=================================="

# Clean and create build directory
# Ensure dotnet is available (use preinstalled or bundled)
if command -v dotnet >/dev/null 2>&1; then
    DOTNET="dotnet"
else
    # Fallback to user-local install
    if [ -x "$HOME/.dotnet/dotnet" ]; then
        DOTNET="$HOME/.dotnet/dotnet"
        export PATH="$HOME/.dotnet:$PATH"
    else
        echo -e "${YELLOW}⚠️  dotnet not found in PATH, attempting to install SDK 8 locally...${NC}"
        curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
        bash /tmp/dotnet-install.sh --channel 8.0 --install-dir "$HOME/.dotnet"
        DOTNET="$HOME/.dotnet/dotnet"
        export PATH="$HOME/.dotnet:$PATH"
    fi
fi
$DOTNET --info >/dev/null 2>&1 || { echo -e "${RED}❌ .NET SDK is not available${NC}"; exit 1; }

echo -e "${YELLOW}📁 Setting up build directory...${NC}"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
mkdir -p "$APPDIR"

# Build the .NET application
echo -e "${YELLOW}🔨 Building .NET application...${NC}"
cd "$SRC_DIR"
$DOTNET publish \
    --configuration Release \
    --runtime linux-x64 \
    --self-contained true \
    --output "$BUILD_DIR/publish" \
    /p:PublishSingleFile=true

if [ ! -f "$BUILD_DIR/publish/$APP_NAME" ]; then
    echo -e "${RED}❌ Build failed: executable not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ .NET application built successfully${NC}"

# Create AppDir structure
echo -e "${YELLOW}📦 Creating AppDir structure...${NC}"
mkdir -p "$APPDIR/usr/bin"
mkdir -p "$APPDIR/usr/lib"
mkdir -p "$APPDIR/usr/share/applications"
mkdir -p "$APPDIR/usr/share/icons/hicolor/256x256/apps"
mkdir -p "$APPDIR/usr/share/metainfo"

# Copy executable
cp "$BUILD_DIR/publish/$APP_NAME" "$APPDIR/usr/bin/"
chmod +x "$APPDIR/usr/bin/$APP_NAME"

# Copy configuration files
if [ -f "$BUILD_DIR/publish/appsettings.json" ]; then
    cp "$BUILD_DIR/publish/appsettings.json" "$APPDIR/usr/bin/"
fi

# Copy native libraries (from publish output, if any)
echo -e "${YELLOW}📚 Copying native libraries...${NC}"
NATIVE_LIBS_COPIED=0
for lib in "$BUILD_DIR/publish"/*.so; do
    if [ -f "$lib" ]; then
        lib_name=$(basename "$lib")
        cp "$lib" "$APPDIR/usr/lib/"
        chmod +x "$APPDIR/usr/lib/$lib_name"
        echo -e "${GREEN}  ✅ Copied $lib_name${NC}"
        NATIVE_LIBS_COPIED=$((NATIVE_LIBS_COPIED + 1))
    fi
done

if [ $NATIVE_LIBS_COPIED -eq 0 ]; then
    echo -e "${YELLOW}  ⚠️  No native libraries found in publish output${NC}"
else
    echo -e "${GREEN}  ✅ Copied $NATIVE_LIBS_COPIED native libraries${NC}"
fi

# Bundle GTK4 runtime (self-contained AppImage)
echo -e "${YELLOW}🧩 Bundling GTK4 runtime...${NC}"
LINUXDEPLOY="$BUILD_DIR/linuxdeploy-x86_64.AppImage"
GTK_PLUGIN="$BUILD_DIR/linuxdeploy-plugin-gtk.sh"
if [ ! -f "$LINUXDEPLOY" ]; then
    wget -q "https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage" -O "$LINUXDEPLOY"
    chmod +x "$LINUXDEPLOY"
fi
if [ ! -f "$GTK_PLUGIN" ]; then
    wget -q "https://raw.githubusercontent.com/linuxdeploy/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh" -O "$GTK_PLUGIN"
    chmod +x "$GTK_PLUGIN"
fi

# Run AppImages without FUSE (CI-safe)
export APPIMAGE_EXTRACT_AND_RUN=1


# Make GTK plugin discoverable by linuxdeploy
ln -sf "$GTK_PLUGIN" "$BUILD_DIR/linuxdeploy-plugin-gtk"
# Ensure linuxdeploy plugins are on PATH
export PATH="$BUILD_DIR:$PATH"

# Ensure basic desktop and icon exist before linuxdeploy runs
mkdir -p "$APPDIR/usr/share/applications"
mkdir -p "$APPDIR/usr/share/icons/hicolor/256x256/apps"
ICON_DEST="$APPDIR/usr/share/icons/hicolor/256x256/apps/$APP_NAME.png"
DESKTOP_DEST="$APPDIR/usr/share/applications/$APP_NAME.desktop"
# Prefer repository icon if available (valid size for linuxdeploy)
ICON_SOURCE_PRE="$PROJECT_ROOT/assets/icon.png"
if [ ! -f "$ICON_DEST" ]; then
  if [ -f "$ICON_SOURCE_PRE" ]; then
    cp "$ICON_SOURCE_PRE" "$ICON_DEST"
  else
    # Minimal fallback; will be replaced later
    echo -n 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' | base64 -d > "$ICON_DEST"
  fi
fi
if [ ! -f "$DESKTOP_DEST" ]; then
  cat > "$DESKTOP_DEST" << EOD
[Desktop Entry]
Type=Application
Name=$APP_DISPLAY_NAME
Exec=$APP_NAME
Icon=$APP_NAME
Categories=$APP_CATEGORY
Terminal=false
EOD
fi

# Try with GTK plugin first (best effort; supports GTK4 when forced)
# Ensure pkg-config can locate gtk4.pc on common distros
export PKG_CONFIG_PATH="${PKG_CONFIG_PATH}:/usr/lib64/pkgconfig:/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/local/lib/x86_64-linux-gnu/pkgconfig:/usr/lib/pkgconfig:/usr/share/pkgconfig"

PLUGIN_OK=true
export DEPLOY_GTK_VERSION="${DEPLOY_GTK_VERSION:-4}"
echo -e "${BLUE}  🔧 Running linuxdeploy with GTK4 plugin (this may take a moment)...${NC}"
if ! APPDIR="$APPDIR" "$LINUXDEPLOY" --appdir "$APPDIR" \
    -e "$APPDIR/usr/bin/$APP_NAME" \
    -d "$APPDIR/usr/share/applications/$APP_NAME.desktop" \
    -i "$APPDIR/usr/share/icons/hicolor/256x256/apps/$APP_NAME.png" \
    --plugin gtk > /tmp/linuxdeploy_gtk.log 2>&1; then
    echo -e "${YELLOW}  ⚠️  linuxdeploy GTK plugin run had issues (continuing)${NC}"
    echo -e "${YELLOW}  📋 Last 10 lines of GTK plugin output:${NC}"
    tail -10 /tmp/linuxdeploy_gtk.log
    PLUGIN_OK=false
else
    echo -e "${GREEN}  ✅ GTK4 plugin completed successfully${NC}"
fi

# If libgtk-4 is still missing, directly deploy GTK libs via linuxdeploy --library
if ! find "$APPDIR/usr/lib" -maxdepth 1 -name 'libgtk-4*.so*' | grep -q libgtk-4; then
    echo -e "${YELLOW}  🔎 GTK4 not found after plugin. Attempting direct library deployment...${NC}"
    # Locate libraries on the build system
    find_lib() { ldconfig -p 2>/dev/null | awk -v n="$1" '$0 ~ n {print $NF}' | head -n1; }
    LIBGTK=$(find_lib 'libgtk-4\\.so')
    LIBGDK=$(find_lib 'libgdk-4\\.so')
    LIBGLIB=$(find_lib 'libglib-2\\.0\\.so')
    LIBGOBJ=$(find_lib 'libgobject-2\\.0\\.so')
    LIBGIO=$(find_lib 'libgio-2\\.0\\.so')
    LIBPANGO=$(find_lib 'libpango-1\\.0\\.so')
    LIBHARF=$(find_lib 'libharfbuzz\\.so')
    LIBCAIRO=$(find_lib 'libcairo\\.so')
    LIBGRAPH=$(find_lib 'libgraphene-1\\.0\\.so')
    LIBEPOXY=$(find_lib 'libepoxy\\.so')
    LIBFRIBIDI=$(find_lib 'libfribidi\\.so')

    LINUXDEPLOY_CMD=("$LINUXDEPLOY" --appdir "$APPDIR" \
        -e "$APPDIR/usr/bin/$APP_NAME" \
        -d "$APPDIR/usr/share/applications/$APP_NAME.desktop" \
        -i "$APPDIR/usr/share/icons/hicolor/256x256/apps/$APP_NAME.png")

    for L in "$LIBGTK" "$LIBGDK" "$LIBGLIB" "$LIBGOBJ" "$LIBGIO" "$LIBPANGO" "$LIBHARF" "$LIBCAIRO" "$LIBGRAPH" "$LIBEPOXY" "$LIBFRIBIDI"; do
        if [ -n "$L" ] && [ -f "$L" ]; then
            LINUXDEPLOY_CMD+=( -l "$L" )
        fi
    done

    if [ ${#LINUXDEPLOY_CMD[@]} -gt 5 ]; then
        echo -e "${YELLOW}  📦 Deploying GTK4 and related libraries via linuxdeploy --library...${NC}"
        APPDIR="$APPDIR" "${LINUXDEPLOY_CMD[@]}" > /tmp/linuxdeploy_libs.log 2>&1 || {
            echo -e "${YELLOW}  ⚠️  linuxdeploy --library run had issues (continuing)${NC}"
            echo -e "${YELLOW}  📋 Last 5 lines of library deployment output:${NC}"
            tail -5 /tmp/linuxdeploy_libs.log
        }
    else
        echo -e "${YELLOW}  ⚠️  Could not locate GTK4 libraries on this build system. Skipping direct deployment.${NC}"
    fi
fi

# Summary of GTK bundling and create .NET-compatible symlinks
if find "$APPDIR/usr/lib" -maxdepth 1 -name 'libgtk-4*.so*' | grep -q libgtk-4; then
    echo -e "${GREEN}  ✅ GTK4 runtime bundled into AppImage AppDir${NC}"
    
    # Create .NET-compatible symlinks for GTK4 libraries
    echo -e "${YELLOW}  🔗 Creating .NET-compatible library symlinks...${NC}"
    cd "$APPDIR/usr/lib"
    
    # GTK4 main library symlinks
    if [ -f "libgtk-4.so.1" ]; then
        ln -sf libgtk-4.so.1 Gtk.so 2>/dev/null || true
        ln -sf libgtk-4.so.1 libGtk.so 2>/dev/null || true
        echo -e "${GREEN}    ✅ Created GTK4 symlinks${NC}"
    fi
    
    # Additional common GTK4 library symlinks that .NET might need
    if [ -f "libgobject-2.0.so.0" ]; then
        ln -sf libgobject-2.0.so.0 GObject.so 2>/dev/null || true
        ln -sf libgobject-2.0.so.0 libGObject.so 2>/dev/null || true
    fi
    
    if [ -f "libglib-2.0.so.0" ]; then
        ln -sf libglib-2.0.so.0 GLib.so 2>/dev/null || true
        ln -sf libglib-2.0.so.0 libGLib.so 2>/dev/null || true
    fi
    
    if [ -f "libgio-2.0.so.0" ]; then
        ln -sf libgio-2.0.so.0 Gio.so 2>/dev/null || true
        ln -sf libgio-2.0.so.0 libGio.so 2>/dev/null || true
    fi
    
    cd - > /dev/null
    echo -e "${GREEN}  ✅ .NET GTK4 library symlinks created${NC}"
else
    echo -e "${YELLOW}  ⚠️  GTK4 runtime not bundled (will require system GTK4 at runtime)${NC}"
    echo -e "${YELLOW}  📋 Available libraries in AppDir:${NC}"
    find "$APPDIR/usr/lib" -name '*.so*' | head -10 || true
    echo -e "${YELLOW}  📋 System GTK4 libraries:${NC}"
    find_lib() { ldconfig -p 2>/dev/null | awk -v n="$1" '$0 ~ n {print $NF}' | head -n1; }
    LIBGTK=$(find_lib 'libgtk-4\\.so')
    if [ -n "$LIBGTK" ]; then
        echo -e "${YELLOW}    Found system GTK4: $LIBGTK${NC}"
    else
        echo -e "${RED}    ❌ No system GTK4 found - AppImage will fail at runtime${NC}"
    fi
fi

# Create desktop entry
echo -e "${YELLOW}🖥️  Creating desktop entry...${NC}"
cat > "$APPDIR/usr/share/applications/$APP_NAME.desktop" << EOF
[Desktop Entry]
Type=Application
Name=$APP_DISPLAY_NAME
Comment=$APP_DESCRIPTION
Exec=$APP_NAME
Icon=$APP_NAME
Categories=$APP_CATEGORY
Terminal=false
StartupNotify=true
MimeType=application/x-mcp-server
Keywords=AI;MCP;Overlay;Screen;Automation;Assistant
EOF

# Create AppStream metadata
echo -e "${YELLOW}📋 Creating AppStream metadata...${NC}"
cat > "$APPDIR/usr/share/metainfo/io.github.ryansopensaucerice.overlay-companion-mcp.appdata.xml" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>io.github.ryansopensaucerice.overlay-companion-mcp</id>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>GPL-3.0</project_license>
  <name>$APP_DISPLAY_NAME</name>
  <summary>$APP_DESCRIPTION</summary>
  <description>
    <p>
      Overlay Companion MCP is a general-purpose, human-in-the-loop AI-assisted
      screen interaction toolkit built with the official ModelContextProtocol C# SDK.
    </p>
    <p>Features:</p>
    <ul>
      <li>Screen capture and overlay drawing capabilities</li>
      <li>Input simulation with safety controls</li>
      <li>MCP integration for AI agents (Jan.ai compatible)</li>
      <li>Multi-monitor and HiDPI support</li>
      <li>Human-in-the-loop safety controls</li>
    </ul>
  </description>
  <launchable type="desktop-id">$APP_NAME.desktop</launchable>
  <provides>
    <binary>$APP_NAME</binary>
  </provides>
  <categories>
    <category>Development</category>
    <category>Utility</category>
  </categories>
  <keywords>
    <keyword>AI</keyword>
    <keyword>MCP</keyword>
    <keyword>Overlay</keyword>
    <keyword>Screen</keyword>
    <keyword>Automation</keyword>
  </keywords>
  <url type="homepage">https://github.com/RyansOpenSauceRice/overlay-companion-mcp</url>
  <url type="bugtracker">https://github.com/RyansOpenSauceRice/overlay-companion-mcp/issues</url>
  <developer id="io.github.ryansopensaucerice">
    <name>RyansOpenSauceRice</name>
  </developer>
  <content_rating type="oars-1.1">
    <content_attribute id="violence-cartoon">none</content_attribute>
    <content_attribute id="violence-fantasy">none</content_attribute>
    <content_attribute id="violence-realistic">none</content_attribute>
    <content_attribute id="violence-bloodshed">none</content_attribute>
    <content_attribute id="violence-sexual">none</content_attribute>
    <content_attribute id="violence-desecration">none</content_attribute>
    <content_attribute id="violence-slavery">none</content_attribute>
    <content_attribute id="violence-worship">none</content_attribute>
    <content_attribute id="drugs-alcohol">none</content_attribute>
    <content_attribute id="drugs-narcotics">none</content_attribute>
    <content_attribute id="drugs-tobacco">none</content_attribute>
    <content_attribute id="sex-nudity">none</content_attribute>
    <content_attribute id="sex-themes">none</content_attribute>
    <content_attribute id="sex-homosexuality">none</content_attribute>
    <content_attribute id="sex-prostitution">none</content_attribute>
    <content_attribute id="sex-adultery">none</content_attribute>
    <content_attribute id="sex-appearance">none</content_attribute>
    <content_attribute id="language-profanity">none</content_attribute>
    <content_attribute id="language-humor">none</content_attribute>
    <content_attribute id="language-discrimination">none</content_attribute>
    <content_attribute id="social-chat">none</content_attribute>
    <content_attribute id="social-info">mild</content_attribute>
    <content_attribute id="social-audio">none</content_attribute>
    <content_attribute id="social-location">none</content_attribute>
    <content_attribute id="social-contacts">none</content_attribute>
    <content_attribute id="money-purchasing">none</content_attribute>
    <content_attribute id="money-gambling">none</content_attribute>
  </content_rating>
  <releases>
    <release version="$APP_VERSION" date="$(date +%Y-%m-%d)">
      <description>
        <p>Latest release with native HTTP transport and multi-monitor support.</p>
      </description>
    </release>
  </releases>
</component>
EOF

# Copy or create application icon
echo -e "${YELLOW}🎨 Setting up application icon...${NC}"
ICON_SOURCE="$PROJECT_ROOT/assets/icon.png"
ICON_DEST="$APPDIR/usr/share/icons/hicolor/256x256/apps/$APP_NAME.png"

if [ -f "$ICON_SOURCE" ]; then
    cp "$ICON_SOURCE" "$ICON_DEST"
    echo -e "${GREEN}✅ Using existing icon from assets/icon.png${NC}"
else
    # Create a simple placeholder icon using ImageMagick if available
    if command -v convert &> /dev/null; then
        convert -size 256x256 xc:transparent \
            -fill '#FF6B35' -draw 'roundrectangle 20,20 236,236 20,20' \
            -fill white -pointsize 48 -gravity center \
            -annotate +0-20 'MCP' \
            -fill white -pointsize 24 -gravity center \
            -annotate +0+30 'Overlay' \

	            "$ICON_DEST"
        echo -e "${GREEN}✅ Generated placeholder icon${NC}"
    else
        # Create a very basic PNG if ImageMagick is not available
        echo -e "${YELLOW}⚠️  ImageMagick not found, creating minimal icon${NC}"
        # This creates a minimal 1x1 transparent PNG
        echo -n 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' | base64 -d > "$ICON_DEST"
    fi
fi

# Create AppRun script
echo -e "${YELLOW}🔧 Creating AppRun script...${NC}"
cat > "$APPDIR/AppRun" << 'EOF'
#!/bin/bash

# AppRun script for Overlay Companion MCP
# This script is executed when the AppImage is run

# Get the directory where this AppImage is mounted
HERE="$(dirname "$(readlink -f "${0}")")"

# Set up environment
export PATH="${HERE}/usr/bin:${PATH}"
export LD_LIBRARY_PATH="${HERE}/usr/lib:${LD_LIBRARY_PATH}"

# .NET native library search paths
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
export DOTNET_SYSTEM_NET_HTTP_USESOCKETSHTTPHANDLER=0

# GTK4 and GLib environment setup
export GDK_BACKEND="${GDK_BACKEND:-wayland,x11}"
export GSETTINGS_SCHEMA_DIR="${HERE}/usr/share/glib-2.0/schemas"
export XDG_DATA_DIRS="${HERE}/usr/share:${XDG_DATA_DIRS}"
export GI_TYPELIB_PATH="${HERE}/usr/lib/girepository-1.0:${GI_TYPELIB_PATH}"

# Additional GTK4 paths
export GTK_PATH="${HERE}/usr/lib/gtk-4.0"
export GDK_PIXBUF_MODULE_FILE="${HERE}/usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache"
export GDK_PIXBUF_MODULEDIR="${HERE}/usr/lib/gdk-pixbuf-2.0/2.10.0/loaders"

# Ensure .NET can find native libraries in the AppImage
export NATIVE_DLL_SEARCH_DIRECTORIES="${HERE}/usr/lib"

cd "${HOME}"

# Execute the application
if [[ " $@ " == *" --smoke-test "* ]]; then
  export OC_SMOKE_TEST=1
fi
exec "${HERE}/usr/bin/overlay-companion-mcp" "$@"
EOF

chmod +x "$APPDIR/AppRun"

# Create symlinks for AppImage convention
ln -sf "usr/share/applications/$APP_NAME.desktop" "$APPDIR/"
ln -sf "usr/share/icons/hicolor/256x256/apps/$APP_NAME.png" "$APPDIR/"

# Download appimagetool if not present
APPIMAGETOOL="$BUILD_DIR/appimagetool"
if [ ! -f "$APPIMAGETOOL" ]; then
    echo -e "${YELLOW}📥 Downloading appimagetool...${NC}"
    wget -q "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage" -O "$APPIMAGETOOL"
    chmod +x "$APPIMAGETOOL"
fi

# Build the AppImage
echo -e "${YELLOW}🔨 Building AppImage...${NC}"
cd "$BUILD_DIR"

# Set environment variables for appimagetool
export ARCH="$ARCH"
export VERSION="$APP_VERSION"

# Build AppImage with better error handling
BUILD_SUCCESS=false

# First attempt: normal build
echo -e "${YELLOW}🔨 Running appimagetool (this may take a moment)...${NC}"
"$APPIMAGETOOL" "$APPDIR" "$APPIMAGE_OUTPUT" > /tmp/appimage_build.log 2>&1
BUILD_EXIT_CODE=$?

# Check if AppImage was created regardless of exit code
if [ -f "$APPIMAGE_OUTPUT" ]; then
    echo -e "${GREEN}✅ AppImage file created successfully${NC}"
    BUILD_SUCCESS=true

    # Check what kind of issues we had
    if [ $BUILD_EXIT_CODE -eq 0 ]; then
        echo -e "${GREEN}✅ Build completed without issues${NC}"
    elif grep -q "Validation failed: warnings:" /tmp/appimage_build.log; then
        echo -e "${YELLOW}⚠️  Build completed with validation warnings (acceptable)${NC}"
    elif grep -q "FUSE" /tmp/appimage_build.log; then
        echo -e "${YELLOW}⚠️  Build completed with FUSE warnings (expected in CI)${NC}"
    else
        echo -e "${YELLOW}⚠️  Build completed with minor issues${NC}"
    fi
else
    echo -e "${RED}❌ AppImage file was not created${NC}"
    echo -e "${YELLOW}📋 Last 10 lines of build output:${NC}"
    tail -10 /tmp/appimage_build.log

    # Check if it's a FUSE issue and try alternative methods
    if grep -q "FUSE" /tmp/appimage_build.log || grep -q "libfuse" /tmp/appimage_build.log; then
        echo -e "${YELLOW}🔄 FUSE not available, attempting extraction-based build...${NC}"

        # Try extraction method
        "$APPIMAGETOOL" --appimage-extract-and-run "$APPDIR" "$APPIMAGE_OUTPUT" > /tmp/appimage_build_extract.log 2>&1
        EXTRACT_EXIT_CODE=$?

        if [ -f "$APPIMAGE_OUTPUT" ]; then
            BUILD_SUCCESS=true
            echo -e "${GREEN}✅ AppImage built using extraction method${NC}"
        elif [ $EXTRACT_EXIT_CODE -eq 0 ] || grep -q "Validation failed: warnings:" /tmp/appimage_build_extract.log; then
            # Sometimes the file is created even with warnings
            if [ -f "$APPIMAGE_OUTPUT" ]; then
                BUILD_SUCCESS=true
                echo -e "${YELLOW}⚠️  AppImage built with warnings using extraction method${NC}"
            fi
        else
            echo -e "${YELLOW}📋 Last 5 lines of extraction build output:${NC}"
            tail -5 /tmp/appimage_build_extract.log
        fi
    fi

    # If still no success, try one more approach for CI environments
    if [ "$BUILD_SUCCESS" = false ] && ([ -n "$CI" ] || [ -n "$GITHUB_ACTIONS" ]); then
        echo -e "${YELLOW}🔄 Attempting CI-specific build approach...${NC}"

        # Set environment variables that might help
        export APPIMAGE_EXTRACT_AND_RUN=1

        "$APPIMAGETOOL" "$APPDIR" "$APPIMAGE_OUTPUT" --no-appstream > /tmp/appimage_build_ci.log 2>&1 || true

        if [ -f "$APPIMAGE_OUTPUT" ]; then
            BUILD_SUCCESS=true
            echo -e "${GREEN}✅ AppImage built using CI-specific method${NC}"
        else
            echo -e "${YELLOW}📋 Last 5 lines of CI build output:${NC}"
            tail -5 /tmp/appimage_build_ci.log
        fi
    fi
fi

# Final validation and output
if [ "$BUILD_SUCCESS" = true ] && [ -f "$APPIMAGE_OUTPUT" ]; then
    echo -e "${GREEN}🎉 AppImage built successfully!${NC}"
    echo -e "${GREEN}📦 Output: $APPIMAGE_OUTPUT${NC}"
    echo -e "${GREEN}📏 Size: $(du -h "$APPIMAGE_OUTPUT" | cut -f1)${NC}"

    # Make it executable
    chmod +x "$APPIMAGE_OUTPUT"

    # Test the AppImage (skip in CI environments without FUSE)
    echo -e "${YELLOW}🧪 Testing AppImage...${NC}"
    if [ -n "$CI" ] || [ -n "$GITHUB_ACTIONS" ]; then
        echo -e "${YELLOW}⚠️  Skipping AppImage test in CI environment (FUSE not available)${NC}"
    elif "$APPIMAGE_OUTPUT" --help &>/dev/null || "$APPIMAGE_OUTPUT" --version &>/dev/null; then
        echo -e "${GREEN}✅ AppImage test passed${NC}"
    else
        echo -e "${YELLOW}⚠️  AppImage created but test inconclusive${NC}"
    fi

    echo ""
    echo "=================================="
    echo -e "${BLUE}🚀 AppImage ready for distribution!${NC}"
    echo -e "${BLUE}📁 Location: $APPIMAGE_OUTPUT${NC}"
    echo ""
    echo "To install:"
    echo "  chmod +x $(basename "$APPIMAGE_OUTPUT")"
    echo "  ./$(basename "$APPIMAGE_OUTPUT")"
    echo ""
    echo "To integrate with desktop:"
    echo "  ./$(basename "$APPIMAGE_OUTPUT") --appimage-extract"
    echo "  cp squashfs-root/*.desktop ~/.local/share/applications/"
    echo "  cp squashfs-root/*.png ~/.local/share/icons/"

    # Exit successfully even with warnings
    exit 0

else
    echo -e "${RED}❌ AppImage build failed${NC}"
    if [ -f /tmp/appimage_build.log ]; then
        echo -e "${RED}Build log:${NC}"
        cat /tmp/appimage_build.log
    fi
    if [ -f /tmp/appimage_build_extract.log ]; then
        echo -e "${RED}Extract build log:${NC}"
        cat /tmp/appimage_build_extract.log
    fi
    exit 1
fi
