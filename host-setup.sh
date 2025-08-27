#!/bin/bash

# Overlay Companion MCP - Host Container Setup Script
# This script sets up the container infrastructure on your HOST Fedora Linux system
# The containers will connect to VMs you create separately
#
# Usage:
#   ./host-setup.sh                           # Interactive port selection
#   ./host-setup.sh 8081                      # Use specific port
#   ./host-setup.sh --port 8081               # Use specific port (explicit)
#   OVERLAY_COMPANION_PORT=8081 ./host-setup.sh  # Environment variable
#
# Port Configuration:
#   Default port: 8080
#   If port is in use, script will offer alternatives
#   Command line argument takes precedence over environment variable

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

# Parse command line arguments
parse_arguments() {
    local port_from_args=""
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --port)
                if [[ -n "${2:-}" ]] && [[ "$2" =~ ^[0-9]+$ ]]; then
                    port_from_args="$2"
                    shift 2
                else
                    error "❌ --port requires a numeric argument"
                    echo "   Usage: $0 --port 8081"
                    exit 1
                fi
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            -*)
                error "❌ Unknown option: $1"
                echo "   Use --help for usage information"
                exit 1
                ;;
            *)
                # Assume it's a port number
                if [[ "$1" =~ ^[0-9]+$ ]]; then
                    port_from_args="$1"
                    shift
                else
                    error "❌ Invalid argument: $1"
                    echo "   Expected port number or --port option"
                    exit 1
                fi
                ;;
        esac
    done
    
    # Validate port if provided
    if [[ -n "$port_from_args" ]]; then
        if [[ $port_from_args -lt 1024 ]] || [[ $port_from_args -gt 65535 ]]; then
            error "❌ Invalid port number: $port_from_args"
            echo "   Port must be between 1024 and 65535"
            exit 1
        fi
        echo "$port_from_args"
    fi
}

# Show help information
show_help() {
    cat << 'EOF'
Overlay Companion MCP - Host Container Setup Script

USAGE:
  ./host-setup.sh                    # Interactive port selection
  ./host-setup.sh 8081               # Use port 8081
  ./host-setup.sh --port 8081        # Use port 8081 (explicit)
  ./host-setup.sh --help             # Show this help

ENVIRONMENT VARIABLES:
  OVERLAY_COMPANION_PORT=8081 ./host-setup.sh    # Set port via environment

PORT CONFIGURATION:
  • Default port: 8080
  • Valid range: 1024-65535
  • Command line argument takes precedence over environment variable
  • If port is in use, script offers interactive alternatives

EXAMPLES:
  ./host-setup.sh                    # Use default port 8080 (interactive if conflict)
  ./host-setup.sh 8081               # Use port 8081 specifically
  ./host-setup.sh --port 8082        # Use port 8082 specifically

INTERACTIVE FEATURES:
  • Automatic port conflict detection
  • Clear prompts with labeled options
  • Input validation with helpful error messages
  • Auto-suggestion of available ports
  • Process identification for port conflicts

WHAT THIS SCRIPT DOES:
  1. Checks system compatibility (Fedora Linux)
  2. Detects and resolves port conflicts
  3. Installs required packages (podman, podman-compose, etc.)
  4. Downloads and configures container setup
  5. Builds and starts all required containers
  6. Provides access URLs and next steps

CONTAINERS INSTALLED:
  • PostgreSQL database (for Guacamole)
  • Guacamole web-based RDP client
  • MCP server (AI overlay functionality)
  • Management web interface

ACCESS AFTER INSTALLATION:
  • Web Interface: http://localhost:PORT
  • MCP Server: http://localhost:PORT/mcp
  • Management API: http://localhost:PORT/api

EOF
}

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

# Handle --help before any other checks
for arg in "$@"; do
    if [[ "$arg" == "--help" ]] || [[ "$arg" == "-h" ]]; then
        show_help
        exit 0
    fi
done

# Check if running as root
if [[ $EUID -eq 0 ]]; then
    echo -e "\033[0;31m[ERROR]\033[0m This script should not be run as root. Please run as a regular user."
    exit 1
fi

# Parse command line arguments
CONTAINER_PORT_FROM_ARGS=$(parse_arguments "$@")
CONTAINER_PORT=${CONTAINER_PORT_FROM_ARGS:-${OVERLAY_COMPANION_PORT:-$DEFAULT_CONTAINER_PORT}}

# Check if port is in use
check_port() {
    local port=$1
    if ss -tuln | grep -q ":$port "; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Get available port
get_available_port() {
    local start_port=${1:-$DEFAULT_CONTAINER_PORT}
    local port=$start_port
    
    while check_port "$port"; do
        log "Port $port is already in use, trying $((port + 1))..."
        ((port++))
        if [[ $port -gt 65535 ]]; then
            error "❌ No available ports found"
            exit 1
        fi
    done
    
    echo "$port"
}

# Interactive port selection
select_port() {
    log "Checking port availability..."
    
    # If user specified a port via command line or environment variable, use it
    if [[ -n "${CONTAINER_PORT_FROM_ARGS:-}" ]] || [[ -n "${OVERLAY_COMPANION_PORT:-}" ]]; then
        local specified_port="$CONTAINER_PORT"
        local source="command line"
        [[ -z "${CONTAINER_PORT_FROM_ARGS:-}" ]] && source="environment variable"
        
        if check_port "$specified_port"; then
            error "❌ Specified port $specified_port (from $source) is already in use"
            echo "   Processes using port $specified_port:"
            ss -tulnp | grep ":$specified_port " || true
            echo ""
            echo "   You can:"
            echo "   1. Stop the service using that port"
            echo "   2. Choose a different port by running: $0 8081"
            echo "   3. Let the script auto-select an available port"
            echo ""
            read -p "   Auto-select available port? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
            CONTAINER_PORT=$(get_available_port)
        else
            CONTAINER_PORT=$specified_port
            log "Using port $specified_port (from $source)"
        fi
    else
        # Check if default port is available
        if check_port "$DEFAULT_CONTAINER_PORT"; then
            warn "⚠️  Default port $DEFAULT_CONTAINER_PORT is already in use"
            echo "   Processes using port $DEFAULT_CONTAINER_PORT:"
            ss -tulnp | grep ":$DEFAULT_CONTAINER_PORT " || true
            echo ""
            echo "   Options:"
            echo "   1. Auto-select next available port"
            echo "   2. Specify custom port"
            echo "   3. Exit and stop conflicting service"
            echo ""
            read -p "   Choose option (1/2/3): " -n 1 -r
            echo
            
            case $REPLY in
                1)
                    CONTAINER_PORT=$(get_available_port)
                    ;;
                2)
                    read -p "   Enter port number (1024-65535): " custom_port
                    if [[ ! "$custom_port" =~ ^[0-9]+$ ]] || [[ $custom_port -lt 1024 ]] || [[ $custom_port -gt 65535 ]]; then
                        error "❌ Invalid port number"
                        exit 1
                    fi
                    if check_port "$custom_port"; then
                        error "❌ Port $custom_port is already in use"
                        exit 1
                    fi
                    CONTAINER_PORT=$custom_port
                    ;;
                3)
                    exit 1
                    ;;
                *)
                    error "❌ Invalid option"
                    exit 1
                    ;;
            esac
        else
            CONTAINER_PORT=$DEFAULT_CONTAINER_PORT
        fi
    fi
    
    log "✅ Using port: $CONTAINER_PORT"
}

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
    
    # Update port configuration in podman-compose.yml
    log "Configuring port $CONTAINER_PORT in container setup..."
    sed -i "s/\"8080:8080\"/\"$CONTAINER_PORT:8080\"/g" podman-compose.yml
    sed -i "s/PORT=8080/PORT=8080/g" podman-compose.yml  # Internal port stays 8080
    
    # Build unified container (includes both MCP server and web interface)
    log "Building unified overlay companion container..."
    podman build -f Dockerfile.unified -t overlay-companion . >> "$LOG_FILE" 2>&1
    
    log "✅ Container built and configured for port $CONTAINER_PORT"
}

# Start services
start_services() {
    log "Starting services..."
    
    local config_dir="$HOME/.config/$PROJECT_NAME"
    cd "$config_dir"
    
    # Start database first
    log "Starting PostgreSQL database..."
    podman-compose up -d postgres >> "$LOG_FILE" 2>&1
    
    # Wait for database to be ready
    log "Waiting for PostgreSQL to be ready..."
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if podman exec overlay-companion-postgres pg_isready -U guacamole >/dev/null 2>&1; then
            log "✅ PostgreSQL is ready"
            break
        fi
        
        if [[ $attempt -eq $max_attempts ]]; then
            error "❌ PostgreSQL failed to start"
            return 1
        fi
        
        sleep 2
        ((attempt++))
    done
    
    # Initialize Guacamole database schema
    log "Initializing Guacamole database schema..."
    podman run --rm --network container:overlay-companion-postgres \
        docker.io/guacamole/guacamole:1.5.4 \
        /opt/guacamole/bin/initdb.sh --postgresql > /tmp/guacamole-schema.sql 2>>"$LOG_FILE"
    
    podman exec -i overlay-companion-postgres \
        psql -U guacamole -d guacamole < /tmp/guacamole-schema.sql >> "$LOG_FILE" 2>&1 || true
    
    rm -f /tmp/guacamole-schema.sql
    
    # Start all services
    log "Starting all services..."
    podman-compose up -d >> "$LOG_FILE" 2>&1
    
    log "✅ Services started"
}

# Wait for services to be ready
wait_for_services() {
    log "Waiting for services to start..."
    
    local vm_ip
    vm_ip=$(hostname -I | awk '{print $1}' || echo "localhost")
    local management_url="http://$vm_ip:$CONTAINER_PORT"
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
    echo "🌐 Web Interface: http://$vm_ip:$CONTAINER_PORT"
    echo "🔧 Management API: http://$vm_ip:$CONTAINER_PORT/api"
    echo "🤖 MCP Server: http://$vm_ip:$CONTAINER_PORT/mcp"
    echo ""
    echo "📋 Next Steps:"
    echo "1. Create a Fedora Silverblue VM on your preferred platform"
    echo "2. Run vm-setup.sh inside the VM to install RDP services"
    echo "3. Add the VM to this management interface using its IP address"
    echo "4. Configure your AI client to use the MCP server"
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
    echo "🚀 Overlay Companion MCP - Host Container Setup"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${NC}"
    echo ""
    echo "This sets up containers on your HOST Fedora Linux system."
    echo "Create VMs separately and connect them via the web interface."
    echo ""
    
    # Initialize log file
    echo "Starting Overlay Companion MCP setup at $(date)" > "$LOG_FILE"
    
    check_platform
    select_port
    install_dependencies
    setup_project
    setup_containers
    start_services
    wait_for_services
    show_completion
}

# Run main function
main "$@"