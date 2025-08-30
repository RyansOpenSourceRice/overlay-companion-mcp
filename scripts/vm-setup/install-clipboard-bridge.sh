#!/bin/bash
set -e

# Overlay Companion MCP - VM Clipboard Bridge Installation Script
# Installs and configures the Flatpak clipboard bridge in the VM

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FLATPAK_DIR="${PROJECT_ROOT}/flatpak/clipboard-bridge"

echo "🔧 Installing Overlay Companion Clipboard Bridge in VM..."

# Check if we're running in the VM
if [ ! -f "/etc/fedora-release" ]; then
    echo "❌ This script should be run inside the Fedora VM"
    exit 1
fi

# Install Flatpak if not already installed
if ! command -v flatpak &> /dev/null; then
    echo "📦 Installing Flatpak..."
    sudo dnf install -y flatpak
fi

# Add Flathub repository if not already added
if ! flatpak remotes | grep -q flathub; then
    echo "🌐 Adding Flathub repository..."
    flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
fi

# Install required runtime and SDK
echo "📦 Installing Flatpak runtime and SDK..."
flatpak install -y flathub org.freedesktop.Platform//23.08
flatpak install -y flathub org.freedesktop.Sdk//23.08

# Install flatpak-builder if not available
if ! command -v flatpak-builder &> /dev/null; then
    echo "🔧 Installing flatpak-builder..."
    sudo dnf install -y flatpak-builder
fi

# Install clipboard tools if not available
echo "📋 Installing clipboard utilities..."
sudo dnf install -y wl-clipboard xclip xsel

# Copy Flatpak source files to VM
TEMP_BUILD_DIR="/tmp/overlay-companion-clipboard-bridge"
rm -rf "${TEMP_BUILD_DIR}"
mkdir -p "${TEMP_BUILD_DIR}"

# Copy files from host (assuming they're mounted or available)
if [ -d "${FLATPAK_DIR}" ]; then
    cp -r "${FLATPAK_DIR}"/* "${TEMP_BUILD_DIR}/"
else
    echo "❌ Flatpak source directory not found: ${FLATPAK_DIR}"
    echo "Please ensure the project files are available in the VM"
    exit 1
fi

cd "${TEMP_BUILD_DIR}"

# Make build script executable
chmod +x build.sh

# Build and install the Flatpak
echo "🏗️  Building clipboard bridge Flatpak..."
./build.sh

# Create systemd user service for auto-start
echo "⚙️  Creating systemd user service..."
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/clipboard-bridge.service << 'EOF'
[Unit]
Description=Overlay Companion Clipboard Bridge
After=graphical-session.target

[Service]
Type=simple
ExecStart=flatpak run org.overlaycompanion.ClipboardBridge
Restart=always
RestartSec=5
Environment=CLIPBOARD_BRIDGE_HOST=0.0.0.0
Environment=CLIPBOARD_BRIDGE_PORT=8765
Environment=CLIPBOARD_BRIDGE_API_KEY=overlay-companion-mcp

[Install]
WantedBy=default.target
EOF

# Enable and start the service
systemctl --user daemon-reload
systemctl --user enable clipboard-bridge.service
systemctl --user start clipboard-bridge.service

# Wait a moment for service to start
sleep 3

# Test the service
echo "🧪 Testing clipboard bridge service..."
if curl -s -H "X-API-Key: overlay-companion-mcp" http://localhost:8765/health > /dev/null; then
    echo "✅ Clipboard bridge service is running successfully!"
    
    # Test clipboard functionality
    echo "📋 Testing clipboard functionality..."
    
    # Set test content
    TEST_CONTENT="Overlay Companion MCP Clipboard Bridge Test - $(date)"
    if curl -s -X POST -H "X-API-Key: overlay-companion-mcp" -H "Content-Type: application/json" \
           -d "{\"content\":\"${TEST_CONTENT}\"}" http://localhost:8765/clipboard > /dev/null; then
        echo "✅ Clipboard write test successful"
        
        # Read back content
        RETRIEVED_CONTENT=$(curl -s -H "X-API-Key: overlay-companion-mcp" http://localhost:8765/clipboard | jq -r '.content')
        if [ "$RETRIEVED_CONTENT" = "$TEST_CONTENT" ]; then
            echo "✅ Clipboard read test successful"
            echo "🎉 Clipboard bridge is fully functional!"
        else
            echo "⚠️  Clipboard read test failed - content mismatch"
        fi
    else
        echo "⚠️  Clipboard write test failed"
    fi
else
    echo "❌ Clipboard bridge service failed to start"
    echo "📋 Service status:"
    systemctl --user status clipboard-bridge.service
    exit 1
fi

# Configure firewall to allow clipboard bridge access from host
echo "🔥 Configuring firewall for clipboard bridge access..."
if command -v firewall-cmd &> /dev/null; then
    sudo firewall-cmd --permanent --add-port=8765/tcp
    sudo firewall-cmd --reload
    echo "✅ Firewall configured to allow clipboard bridge access"
fi

# Clean up temporary build directory
rm -rf "${TEMP_BUILD_DIR}"

echo ""
echo "🎉 Clipboard Bridge Installation Complete!"
echo ""
echo "📋 Service Information:"
echo "   • Service: clipboard-bridge.service (user)"
echo "   • URL: http://localhost:8765"
echo "   • API Key: overlay-companion-mcp"
echo "   • Status: $(systemctl --user is-active clipboard-bridge.service)"
echo ""
echo "🔧 Management Commands:"
echo "   • Status: systemctl --user status clipboard-bridge.service"
echo "   • Logs: journalctl --user -u clipboard-bridge.service -f"
echo "   • Restart: systemctl --user restart clipboard-bridge.service"
echo "   • Stop: systemctl --user stop clipboard-bridge.service"
echo ""
echo "🧪 Test Commands:"
echo "   • Health: curl -H 'X-API-Key: overlay-companion-mcp' http://localhost:8765/health"
echo "   • Get clipboard: curl -H 'X-API-Key: overlay-companion-mcp' http://localhost:8765/clipboard"
echo "   • Set clipboard: curl -X POST -H 'X-API-Key: overlay-companion-mcp' -H 'Content-Type: application/json' -d '{\"content\":\"test\"}' http://localhost:8765/clipboard"