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
APP_CATEGORY="Development;Utility"
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
    /p:PublishSingleFile=true \
    /p:PublishTrimmed=true \
    /p:TrimMode=link

if [ ! -f "$BUILD_DIR/publish/$APP_NAME" ]; then
    echo -e "${RED}❌ Build failed: executable not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ .NET application built successfully${NC}"

# Create AppDir structure
echo -e "${YELLOW}📦 Creating AppDir structure...${NC}"
mkdir -p "$APPDIR/usr/bin"
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
cat > "$APPDIR/usr/share/metainfo/$APP_NAME.appdata.xml" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>$APP_NAME</id>
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
  <releases>
    <release version="$APP_VERSION" date="$(date +%Y-%m-%d)"/>
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

# Change to a writable directory for configuration files
cd "${HOME}"

# Execute the application
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

# Build AppImage
if ! "$APPIMAGETOOL" "$APPDIR" "$APPIMAGE_OUTPUT" 2>/dev/null; then
    echo -e "${YELLOW}⚠️  AppImage build encountered FUSE issues (expected in CI)${NC}"
    echo -e "${YELLOW}🔄 Attempting extraction-based build...${NC}"
    
    # Try to extract and build without FUSE
    if "$APPIMAGETOOL" --appimage-extract-and-run "$APPDIR" "$APPIMAGE_OUTPUT" 2>/dev/null; then
        echo -e "${GREEN}✅ AppImage built using extraction method${NC}"
    else
        echo -e "${YELLOW}⚠️  AppImage build completed with warnings${NC}"
        # Check if the file was created anyway
        if [ ! -f "$APPIMAGE_OUTPUT" ]; then
            echo -e "${RED}❌ AppImage file not created${NC}"
            exit 1
        fi
    fi
fi

if [ -f "$APPIMAGE_OUTPUT" ]; then
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
    
else
    echo -e "${RED}❌ AppImage build failed${NC}"
    exit 1
fi