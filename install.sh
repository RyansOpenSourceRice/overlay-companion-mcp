#!/bin/bash

# Overlay Companion MCP - Simple Installation Script
# Download, build, and run in one command

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Overlay Companion MCP - Simple Installation${NC}"
echo "=============================================="

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check .NET installation
echo -e "${YELLOW}🔷 Checking .NET installation...${NC}"
if command_exists dotnet; then
    DOTNET_VERSION=$(dotnet --version)
    echo -e "${GREEN}✅ .NET $DOTNET_VERSION found${NC}"
else
    echo -e "${RED}❌ .NET not found${NC}"
    echo -e "${YELLOW}Installing .NET 8.0...${NC}"

    # Detect OS and install .NET
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Ubuntu/Debian
        if command_exists apt-get; then
            wget https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb -O packages-microsoft-prod.deb
            sudo dpkg -i packages-microsoft-prod.deb
            rm packages-microsoft-prod.deb
            sudo apt-get update
            sudo apt-get install -y dotnet-sdk-8.0
        # RHEL/CentOS/Fedora
        elif command_exists dnf; then
            sudo dnf install -y dotnet-sdk-8.0
        elif command_exists yum; then
            sudo yum install -y dotnet-sdk-8.0
        else
            echo -e "${RED}❌ Unsupported Linux distribution${NC}"
            echo -e "${YELLOW}Please install .NET 8.0 manually: https://dotnet.microsoft.com/download${NC}"
            exit 1
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command_exists brew; then
            brew install --cask dotnet
        else
            echo -e "${RED}❌ Homebrew not found${NC}"
            echo -e "${YELLOW}Please install .NET 8.0 manually: https://dotnet.microsoft.com/download${NC}"
            exit 1
        fi
    else
        echo -e "${RED}❌ Unsupported operating system${NC}"
        echo -e "${YELLOW}Please install .NET 8.0 manually: https://dotnet.microsoft.com/download${NC}"
        exit 1
    fi

    # Verify installation
    if command_exists dotnet; then
        DOTNET_VERSION=$(dotnet --version)
        echo -e "${GREEN}✅ .NET $DOTNET_VERSION installed successfully${NC}"
    else
        echo -e "${RED}❌ .NET installation failed${NC}"
        exit 1
    fi
fi

# Get current directory
INSTALL_DIR="$(pwd)"
echo -e "${YELLOW}📁 Installation directory: $INSTALL_DIR${NC}"

# Check if we're already in the project directory
if [ -f "src/OverlayCompanion.csproj" ]; then
    echo -e "${GREEN}✅ Already in project directory${NC}"
    PROJECT_DIR="$INSTALL_DIR"
else
    # Clone the repository if not already present
    if [ -d "overlay-companion-mcp" ]; then
        echo -e "${GREEN}✅ Project directory already exists${NC}"
        PROJECT_DIR="$INSTALL_DIR/overlay-companion-mcp"
    else
        echo -e "${YELLOW}📥 Cloning repository...${NC}"
        git clone https://github.com/RyansOpenSauceRice/overlay-companion-mcp.git
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Repository cloned successfully${NC}"
            PROJECT_DIR="$INSTALL_DIR/overlay-companion-mcp"
        else
            echo -e "${RED}❌ Failed to clone repository${NC}"
            exit 1
        fi
    fi
fi

cd "$PROJECT_DIR"

# Build the project
echo -e "${YELLOW}🔨 Building project...${NC}"
dotnet build -c Release src/OverlayCompanion.csproj -o build/publish
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Build successful${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

# Make executable
chmod +x build/publish/overlay-companion-mcp

# Create simple run script
echo -e "${YELLOW}📝 Creating run script...${NC}"
cat > run.sh << 'EOF'
#!/bin/bash

# Simple run script for Overlay Companion MCP
cd "$(dirname "$0")"

echo "🚀 Starting Overlay Companion MCP..."
echo "📍 Web UI: http://localhost:3000/setup"
echo "🔧 Config: http://localhost:3000/config"
echo "⏹️  Press Ctrl+C to stop"
echo ""

./build/publish/overlay-companion-mcp
EOF

chmod +x run.sh

# Create systemd service file (optional)
echo -e "${YELLOW}📋 Creating systemd service file...${NC}"
cat > overlay-companion-mcp.service << EOF
[Unit]
Description=Overlay Companion MCP Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/build/publish/overlay-companion-mcp
Restart=always
RestartSec=10
Environment=ASPNETCORE_ENVIRONMENT=Production

[Install]
WantedBy=multi-user.target
EOF

echo ""
echo "=============================================="
echo -e "${GREEN}🎉 Installation Complete!${NC}"
echo "=============================================="
echo ""
echo -e "${BLUE}📋 What was installed:${NC}"
echo -e "${GREEN}✅ Overlay Companion MCP server built and ready${NC}"
echo -e "${GREEN}✅ Simple run script created (./run.sh)${NC}"
echo -e "${GREEN}✅ Systemd service file created (optional)${NC}"
echo ""
echo -e "${BLUE}🚀 Quick Start:${NC}"
echo -e "${YELLOW}1. Start the server:${NC}"
echo -e "   ${GREEN}./run.sh${NC}"
echo ""
echo -e "${YELLOW}2. Open your browser:${NC}"
echo -e "   ${GREEN}http://localhost:3000/setup${NC}"
echo ""
echo -e "${YELLOW}3. Copy the MCP configuration to your AI client${NC}"
echo ""
echo -e "${BLUE}🔧 Advanced Options:${NC}"
echo -e "${YELLOW}• Custom port:${NC} PORT=8080 ./run.sh"
echo -e "${YELLOW}• Install as service:${NC} sudo cp overlay-companion-mcp.service /etc/systemd/system/"
echo -e "${YELLOW}• Enable service:${NC} sudo systemctl enable --now overlay-companion-mcp"
echo ""
echo -e "${BLUE}📚 Documentation:${NC}"
echo -e "${YELLOW}• README.md - Basic usage${NC}"
echo -e "${YELLOW}• MCP_SPECIFICATION.md - Available tools${NC}"
echo -e "${YELLOW}• docs/ - Detailed documentation${NC}"
echo ""
echo -e "${GREEN}Happy automating! 🤖${NC}"
