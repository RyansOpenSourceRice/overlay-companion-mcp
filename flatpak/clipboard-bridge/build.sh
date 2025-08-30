#!/bin/bash
set -e

# Overlay Companion MCP - Clipboard Bridge Build Script
# Builds the Flatpak clipboard bridge for VM clipboard access

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
REPO_DIR="${SCRIPT_DIR}/repo"

echo "🔧 Building Overlay Companion Clipboard Bridge Flatpak..."

# Clean previous builds
rm -rf "${BUILD_DIR}" "${REPO_DIR}"
mkdir -p "${BUILD_DIR}" "${REPO_DIR}"

# Check dependencies
if ! command -v flatpak-builder &> /dev/null; then
    echo "❌ flatpak-builder not found. Please install it:"
    echo "   sudo dnf install flatpak-builder"
    exit 1
fi

if ! flatpak list --runtime | grep -q "org.freedesktop.Platform.*23.08"; then
    echo "📦 Installing required Flatpak runtime..."
    flatpak install -y flathub org.freedesktop.Platform//23.08
    flatpak install -y flathub org.freedesktop.Sdk//23.08
fi

# Build the Flatpak
echo "🏗️  Building Flatpak package..."
flatpak-builder \
    --force-clean \
    --repo="${REPO_DIR}" \
    "${BUILD_DIR}" \
    org.overlaycompanion.ClipboardBridge.yml

# Install locally for testing
echo "📦 Installing Flatpak locally..."
flatpak install -y --user "${REPO_DIR}" org.overlaycompanion.ClipboardBridge

echo "✅ Clipboard Bridge Flatpak built and installed successfully!"
echo ""
echo "🚀 To run the service:"
echo "   flatpak run org.overlaycompanion.ClipboardBridge"
echo ""
echo "🔍 To test the API:"
echo "   curl -H 'X-API-Key: overlay-companion-mcp' http://localhost:8765/health"
echo ""
echo "📋 To get clipboard content:"
echo "   curl -H 'X-API-Key: overlay-companion-mcp' http://localhost:8765/clipboard"
echo ""
echo "✏️  To set clipboard content:"
echo "   curl -X POST -H 'X-API-Key: overlay-companion-mcp' -H 'Content-Type: application/json' \\"
echo "        -d '{\"content\":\"Hello from API!\"}' http://localhost:8765/clipboard"