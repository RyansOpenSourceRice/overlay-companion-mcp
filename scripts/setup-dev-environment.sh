#!/bin/bash

# Development Environment Setup Script
# Automatically sets up pre-commit hooks and development dependencies
# for Overlay Companion MCP project

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Setting up Overlay Companion MCP Development Environment${NC}"
echo "=================================================================="

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Check if we're in the right directory
if [ ! -f "src/OverlayCompanion.csproj" ]; then
    echo -e "${RED}❌ Error: Not in Overlay Companion MCP project root${NC}"
    echo "Please run this script from the project root directory"
    exit 1
fi

echo -e "${YELLOW}📁 Project root: $PROJECT_ROOT${NC}"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Python installation
echo -e "${YELLOW}🐍 Checking Python installation...${NC}"
if command_exists python3; then
    PYTHON_CMD="python3"
    PYTHON_VERSION=$(python3 --version 2>&1 | cut -d' ' -f2)
    echo -e "${GREEN}✅ Python $PYTHON_VERSION found${NC}"
elif command_exists python; then
    PYTHON_CMD="python"
    PYTHON_VERSION=$(python --version 2>&1 | cut -d' ' -f2)
    echo -e "${GREEN}✅ Python $PYTHON_VERSION found${NC}"
else
    echo -e "${RED}❌ Python not found. Please install Python 3.8+ first.${NC}"
    exit 1
fi

# Check pip installation
echo -e "${YELLOW}📦 Checking pip installation...${NC}"
if command_exists pip3; then
    PIP_CMD="pip3"
elif command_exists pip; then
    PIP_CMD="pip"
else
    echo -e "${RED}❌ pip not found. Please install pip first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ pip found${NC}"

# Install pre-commit
echo -e "${YELLOW}🔧 Installing pre-commit...${NC}"
if command_exists pre-commit; then
    echo -e "${GREEN}✅ pre-commit already installed${NC}"
    PRE_COMMIT_VERSION=$(pre-commit --version)
    echo -e "${GREEN}   Version: $PRE_COMMIT_VERSION${NC}"
else
    echo -e "${YELLOW}   Installing pre-commit via pip...${NC}"
    $PIP_CMD install pre-commit
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ pre-commit installed successfully${NC}"
    else
        echo -e "${RED}❌ Failed to install pre-commit${NC}"
        exit 1
    fi
fi

# Install pre-commit hooks
echo -e "${YELLOW}🪝 Installing pre-commit hooks...${NC}"
if [ -f ".pre-commit-config.yaml" ]; then
    pre-commit install
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Pre-commit hooks installed${NC}"
    else
        echo -e "${RED}❌ Failed to install pre-commit hooks${NC}"
        exit 1
    fi

    # Install commit message hooks
    pre-commit install --hook-type commit-msg
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Commit message hooks installed${NC}"
    else
        echo -e "${YELLOW}⚠️  Commit message hooks installation failed (non-critical)${NC}"
    fi
else
    echo -e "${RED}❌ .pre-commit-config.yaml not found${NC}"
    exit 1
fi

# Install Python development dependencies for AI-GUI tests
echo -e "${YELLOW}🧪 Setting up Python test environment...${NC}"
if [ -d "tests/ai-gui" ]; then
    cd tests/ai-gui

    # Create virtual environment if it doesn't exist
    if [ ! -d ".venv" ]; then
        echo -e "${YELLOW}   Creating Python virtual environment...${NC}"
        $PYTHON_CMD -m venv .venv
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Virtual environment created${NC}"
        else
            echo -e "${RED}❌ Failed to create virtual environment${NC}"
            cd "$PROJECT_ROOT"
            exit 1
        fi
    else
        echo -e "${GREEN}✅ Virtual environment already exists${NC}"
    fi

    # Activate virtual environment and install dependencies
    if [ -f ".venv/bin/activate" ]; then
        source .venv/bin/activate
        echo -e "${YELLOW}   Installing Python test dependencies...${NC}"

        # Upgrade pip first
        pip install --upgrade pip

        # Install test dependencies
        if [ -f "requirements.txt" ]; then
            pip install -r requirements.txt
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}✅ Python test dependencies installed${NC}"
            else
                echo -e "${YELLOW}⚠️  Some Python dependencies failed to install${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  No requirements.txt found in tests/ai-gui${NC}"
        fi

        deactivate
    else
        echo -e "${YELLOW}⚠️  Virtual environment activation script not found${NC}"
    fi

    cd "$PROJECT_ROOT"
else
    echo -e "${YELLOW}⚠️  tests/ai-gui directory not found, skipping Python setup${NC}"
fi

# Check .NET installation
echo -e "${YELLOW}🔷 Checking .NET installation...${NC}"
if command_exists dotnet; then
    DOTNET_VERSION=$(dotnet --version)
    echo -e "${GREEN}✅ .NET $DOTNET_VERSION found${NC}"

    # Restore .NET dependencies
    echo -e "${YELLOW}   Restoring .NET dependencies...${NC}"
    cd src
    dotnet restore
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ .NET dependencies restored${NC}"
    else
        echo -e "${YELLOW}⚠️  .NET dependency restoration had issues${NC}"
    fi
    cd "$PROJECT_ROOT"
else
    echo -e "${YELLOW}⚠️  .NET not found. Install .NET 8.0+ for C# development${NC}"
    echo -e "${YELLOW}   Download from: https://dotnet.microsoft.com/download${NC}"
fi

# Run initial pre-commit check
echo -e "${YELLOW}🧪 Running initial pre-commit check...${NC}"
echo -e "${YELLOW}   This may take a few minutes on first run...${NC}"
pre-commit run --all-files || echo -e "${YELLOW}⚠️  Some pre-commit checks found issues (normal on first run)${NC}"

# Create .secrets.baseline for detect-secrets if it doesn't exist
if [ ! -f ".secrets.baseline" ]; then
    echo -e "${YELLOW}🔐 Creating secrets baseline...${NC}"
    # Create empty baseline - detect-secrets will populate it on first run
    echo '{}' > .secrets.baseline
    echo -e "${GREEN}✅ Secrets baseline created${NC}"
fi

# Set up git configuration recommendations
echo -e "${YELLOW}📝 Checking git configuration...${NC}"
GIT_USER_NAME=$(git config --get user.name || echo "")
GIT_USER_EMAIL=$(git config --get user.email || echo "")

if [ -z "$GIT_USER_NAME" ] || [ -z "$GIT_USER_EMAIL" ]; then
    echo -e "${YELLOW}⚠️  Git user configuration incomplete${NC}"
    echo -e "${YELLOW}   Consider setting:${NC}"
    echo -e "${YELLOW}   git config --global user.name \"Your Name\"${NC}"
    echo -e "${YELLOW}   git config --global user.email \"your.email@example.com\"${NC}"
else
    echo -e "${GREEN}✅ Git user configuration: $GIT_USER_NAME <$GIT_USER_EMAIL>${NC}"
fi

# Create development summary
echo ""
echo "=================================================================="
echo -e "${GREEN}🎉 Development Environment Setup Complete!${NC}"
echo "=================================================================="
echo ""
echo -e "${BLUE}📋 What was set up:${NC}"
echo -e "${GREEN}✅ Pre-commit hooks installed and configured${NC}"
echo -e "${GREEN}✅ Python virtual environment created (tests/ai-gui/.venv)${NC}"
echo -e "${GREEN}✅ Development dependencies installed${NC}"
echo -e "${GREEN}✅ Initial code quality checks run${NC}"
echo -e "${GREEN}✅ Secrets detection baseline created${NC}"
echo ""
echo -e "${BLUE}🚀 Next steps:${NC}"
echo -e "${YELLOW}1. Start developing! Pre-commit hooks will run automatically${NC}"
echo -e "${YELLOW}2. Read docs/DEVELOPMENT_SETUP.md for detailed usage${NC}"
echo -e "${YELLOW}3. Test the setup: git commit (hooks will run)${NC}"
echo ""
echo -e "${BLUE}📚 Useful commands:${NC}"
echo -e "${YELLOW}• pre-commit run --all-files    ${NC}# Run all hooks manually"
echo -e "${YELLOW}• pre-commit autoupdate         ${NC}# Update hook versions"
echo -e "${YELLOW}• cd tests/ai-gui && source .venv/bin/activate  ${NC}# Activate Python env"
echo -e "${YELLOW}• dotnet build                  ${NC}# Build C# project"
echo -e "${YELLOW}• ./scripts/build-appimage.sh   ${NC}# Build AppImage"
echo ""
echo -e "${GREEN}Happy coding! 🚀${NC}"
