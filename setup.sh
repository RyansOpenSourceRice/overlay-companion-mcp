#!/bin/bash

# Overlay Companion MCP - Container Setup Script
# This script sets up the containerized overlay companion infrastructure
# Run this inside any Fedora VM created with your preferred platform

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="overlay-companion-mcp"
DEFAULT_CONTAINER_PORT=8080
LOG_FILE="/tmp/${PROJECT_NAME}-setup.log"

# Logging functions
log() {
    echo -e "${GREEN}[INFO]${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [INFO] $1" >> "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WARN] $1" >> "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] $1" >> "$LOG_FILE"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
    error "This script should not be run as root. Please run as a regular user."
    exit 1
fi

# Check platform compatibility
check_platform() {
    log "Checking platform compatibility..."
    
    if [[ ! -f /etc/os-release ]]; then
        error "❌ Cannot detect operating system"
        exit 1
    fi
    
    . /etc/os-release
    
    if [[ "$ID" != "fedora" ]]; then
        error "❌ This script requires Fedora Linux"
        error "   Detected: $PRETTY_NAME"
        error "   Please create a Fedora VM and run this script inside it"
        exit 1
    fi
    
    log "✅ Fedora detected (version $VERSION_ID)"
}

# Install system dependencies
install_dependencies() {
    log "Installing system dependencies..."
    log "Updating package cache..."
    sudo dnf update -y >> "$LOG_FILE" 2>&1
    
    log "Installing packages: podman podman-compose curl wget unzip jq git"
    sudo dnf install -y podman podman-compose curl wget unzip jq git >> "$LOG_FILE" 2>&1
    
    # Enable user session for rootless podman
    log "Enabling user session for rootless podman..."
    loginctl enable-linger "$USER" || true
    
    log "✅ System dependencies installed"
}

# Setup project directory
setup_project() {
    log "Setting up project directory..."
    
    local project_dir="$HOME/$PROJECT_NAME"
    
    if [[ -d "$project_dir" ]]; then
        warn "Project directory already exists. Updating..."
        cd "$project_dir"
        git pull origin main >> "$LOG_FILE" 2>&1 || true
    else
        log "Cloning repository..."
        git clone https://github.com/RyansOpenSauceRice/overlay-companion-mcp.git "$project_dir" >> "$LOG_FILE" 2>&1
        cd "$project_dir"
    fi
    
    log "✅ Project directory ready: $project_dir"
}

# Setup containers
setup_containers() {
    log "Setting up containers..."
    
    # Create container configuration directory
    local config_dir="$HOME/.config/$PROJECT_NAME"
    mkdir -p "$config_dir"
    
    # Copy container configurations
    cp -r release/containers/* "$config_dir/"
    cd "$config_dir"
    
    # Build unified container (includes both MCP server and web interface)
    log "Building unified overlay companion container..."
    podman build -f Dockerfile.unified -t overlay-companion . >> "$LOG_FILE" 2>&1
    
    log "✅ Container built and configured"
}

# Start services
start_services() {
    log "Starting services..."
    
    local config_dir="$HOME/.config/$PROJECT_NAME"
    cd "$config_dir"
    
    # Start containers with podman-compose
    podman-compose up -d >> "$LOG_FILE" 2>&1
    
    log "✅ Services started"
}

# Wait for services to be ready
wait_for_services() {
    log "Waiting for services to start..."
    
    local vm_ip
    vm_ip=$(hostname -I | awk '{print $1}' || echo "localhost")
    local management_url="http://$vm_ip:$DEFAULT_CONTAINER_PORT"
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        log "Checking services... (attempt $attempt/$max_attempts)"
        
        if curl -s --connect-timeout 5 "$management_url/health" >/dev/null 2>&1; then
            log "✅ Services are ready"
            return 0
        fi
        
        sleep 10
        ((attempt++))
    done
    
    warn "⚠️  Services may still be starting. Check logs if needed."
}

# Show completion message
show_completion() {
    local vm_ip
    vm_ip=$(hostname -I | awk '{print $1}' || echo "localhost")
    
    echo -e "${GREEN}"
    echo "🎉 Installation Complete!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${NC}"
    echo "🌐 Web Interface: http://$vm_ip:$DEFAULT_CONTAINER_PORT"
    echo "🔧 Management API: http://$vm_ip:$DEFAULT_CONTAINER_PORT/api"
    echo "🤖 MCP Server: http://$vm_ip:$DEFAULT_CONTAINER_PORT/mcp"
    echo ""
    echo "📋 Next Steps:"
    echo "1. Access the web interface to verify everything is working"
    echo "2. Configure your AI client (Cherry Studio, etc.) to use the MCP server"
    echo "3. Start using overlay functionality through your AI assistant"
    echo ""
    echo "📊 Service Management:"
    echo "• Check status: podman ps"
    echo "• View logs: podman logs overlay-companion"
    echo "• Restart: cd ~/.config/$PROJECT_NAME && podman-compose restart"
    echo "• Stop: cd ~/.config/$PROJECT_NAME && podman-compose down"
    echo ""
    echo "🔧 Configuration files are in: ~/.config/$PROJECT_NAME"
    echo "📋 Setup log file: $LOG_FILE"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Main installation function
main() {
    echo -e "${BLUE}"
    echo "🚀 Overlay Companion MCP - Container Setup"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${NC}"
    
    # Initialize log file
    echo "Starting Overlay Companion MCP setup at $(date)" > "$LOG_FILE"
    
    check_platform
    install_dependencies
    setup_project
    setup_containers
    start_services
    wait_for_services
    show_completion
}

# Run main function
main "$@"