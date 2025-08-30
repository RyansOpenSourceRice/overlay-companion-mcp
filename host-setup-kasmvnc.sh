#!/bin/bash

# Overlay Companion MCP - KasmVNC Host Setup Script
# This script sets up the simplified KasmVNC-based container infrastructure
# Replaces the complex Guacamole stack with KasmVNC for better multi-monitor support
#
# Usage:
#   ./host-setup-kasmvnc.sh                       # Interactive port selection
#   ./host-setup-kasmvnc.sh 8080                  # Use specific port
#   ./host-setup-kasmvnc.sh --port 8080           # Use specific port (explicit)
#   OVERLAY_COMPANION_PORT=8080 ./host-setup-kasmvnc.sh  # Environment variable

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
DEFAULT_MCP_PORT=3001
DEFAULT_KASMVNC_PORT=6901
DEFAULT_WEB_PORT=8082
LOG_FILE="/tmp/${PROJECT_NAME}-kasmvnc-setup.log"

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
                    echo "   Usage: $0 --port 8080"
                    exit 1
                fi
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            --debug)
                set -x
                DEBUG=true
                shift
                ;;
            --use-registry)
                USE_REGISTRY=true
                shift
                ;;
            --build-from-source)
                BUILD_FROM_SOURCE=true
                shift
                ;;
            *)
                if [[ "$1" =~ ^[0-9]+$ ]]; then
                    port_from_args="$1"
                    shift
                else
                    error "❌ Unknown argument: $1"
                    echo "   Use --help for usage information"
                    exit 1
                fi
                ;;
        esac
    done

    # Determine final port (priority: args > env > default)
    if [[ -n "$port_from_args" ]]; then
        CONTAINER_PORT="$port_from_args"
    elif [[ -n "${OVERLAY_COMPANION_PORT:-}" ]]; then
        CONTAINER_PORT="$OVERLAY_COMPANION_PORT"
    else
        CONTAINER_PORT="$DEFAULT_CONTAINER_PORT"
    fi
}

show_help() {
    cat << EOF
Overlay Companion MCP - KasmVNC Host Setup

This script sets up a simplified container stack using KasmVNC instead of Guacamole.
Benefits: No database required, true multi-monitor support, simpler configuration.

USAGE:
    $0 [OPTIONS] [PORT]

OPTIONS:
    --port PORT         Specify the main container port (default: 8080)
    --use-registry      Use pre-built containers from GitHub Container Registry (default)
    --build-from-source Build containers from source code instead of using registry
    --debug             Enable debug mode with verbose output
    --help, -h          Show this help message

EXAMPLES:
    $0                  # Interactive setup with default port 8080
    $0 8081             # Use port 8081
    $0 --port 8081      # Use port 8081 (explicit)
    $0 --use-registry   # Use pre-built containers (faster)

PORTS:
    Main Interface:     PORT (default: 8080)
    MCP Server:         PORT+1 (default: 3001)
    KasmVNC:           PORT+21 (default: 6901)
    Web Interface:      PORT+2 (default: 8082)

WHAT GETS INSTALLED:
    ✅ 4 containers (vs 6 with Guacamole):
       - KasmVNC container (replaces postgres + guacd + guacamole + guac-init)
       - MCP server container
       - Web interface container
       - Caddy proxy container
    ✅ No database required
    ✅ True multi-monitor support
    ✅ Simplified configuration

EOF
}

# Utility functions
info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] $1" >> "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
    echo "$(date '+%Y-%m-%d %H:%M:%S') [SUCCESS] $1" >> "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
    echo "$(date '+%Y-%m-%d %H:%M:%S') [WARNING] $1" >> "$LOG_FILE"
}

error() {
    echo -e "${RED}❌ $1${NC}" >&2
    echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $1" >> "$LOG_FILE"
}

# Check if port is in use
is_port_in_use() {
    local port=$1
    if command -v ss >/dev/null 2>&1; then
        ss -tuln | grep -q ":${port} "
    elif command -v netstat >/dev/null 2>&1; then
        netstat -tuln | grep -q ":${port} "
    else
        # Fallback: try to bind to the port
        if command -v nc >/dev/null 2>&1; then
            ! nc -z localhost "$port" 2>/dev/null
        else
            return 1  # Assume port is available if we can't check
        fi
    fi
}

# Interactive port selection
select_port_interactive() {
    local suggested_port=$1

    if ! is_port_in_use "$suggested_port"; then
        info "Port $suggested_port is available"
        CONTAINER_PORT="$suggested_port"
        return 0
    fi

    warning "Port $suggested_port is already in use"

    # Find next available port
    local next_port=$((suggested_port + 1))
    while [[ $next_port -lt 65535 ]] && is_port_in_use "$next_port"; do
        ((next_port++))
    done

    if [[ $next_port -ge 65535 ]]; then
        error "Could not find an available port"
        exit 1
    fi

    echo
    echo "Available options:"
    echo "  1) Use port $next_port (next available)"
    echo "  2) Specify a custom port"
    echo "  3) Exit and resolve port conflict manually"
    echo

    while true; do
        read -p "Please select an option (1-3): " choice
        case $choice in
            1)
                CONTAINER_PORT="$next_port"
                info "Using port $CONTAINER_PORT"
                break
                ;;
            2)
                while true; do
                    read -p "Enter custom port (1024-65534): " custom_port
                    if [[ "$custom_port" =~ ^[0-9]+$ ]] && [[ $custom_port -ge 1024 ]] && [[ $custom_port -le 65534 ]]; then
                        if ! is_port_in_use "$custom_port"; then
                            CONTAINER_PORT="$custom_port"
                            info "Using custom port $CONTAINER_PORT"
                            break 2
                        else
                            warning "Port $custom_port is already in use. Please try another."
                        fi
                    else
                        warning "Please enter a valid port number between 1024 and 65534"
                    fi
                done
                ;;
            3)
                info "Exiting. Please resolve the port conflict and run the script again."
                exit 0
                ;;
            *)
                warning "Please enter 1, 2, or 3"
                ;;
        esac
    done
}

# Calculate derived ports
calculate_ports() {
    MCP_PORT=$((CONTAINER_PORT + 1))
    WEB_PORT=$((CONTAINER_PORT + 2))
    KASMVNC_PORT=$((CONTAINER_PORT + 21))  # 8080 -> 6901 pattern

    info "Port configuration:"
    info "  Main Interface: $CONTAINER_PORT"
    info "  MCP Server: $MCP_PORT"
    info "  Web Interface: $WEB_PORT"
    info "  KasmVNC: $KASMVNC_PORT"
}

# Check system requirements
check_requirements() {
    info "Checking system requirements..."

    # Check if running on Fedora
    if ! grep -q "Fedora" /etc/os-release 2>/dev/null; then
        warning "This script is designed for Fedora Linux. Other distributions may work but are not officially supported."
    fi

    # Check for Podman
    if ! command -v podman >/dev/null 2>&1; then
        info "Installing Podman..."
        sudo dnf install -y podman podman-compose
    fi

    # Check for git
    if ! command -v git >/dev/null 2>&1; then
        info "Installing Git..."
        sudo dnf install -y git
    fi

    success "System requirements satisfied"
}

# Clone or update repository
setup_repository() {
    local config_dir="$HOME/.config/$PROJECT_NAME"
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # Check if we're running from within the repository
    if [[ -f "$script_dir/infra/kasmvnc-compose.yml" ]]; then
        info "Running from repository directory, copying files..."
        [[ "${DEBUG:-false}" == "true" ]] && info "Script directory: $script_dir"
        [[ "${DEBUG:-false}" == "true" ]] && info "Config directory: $config_dir"

        mkdir -p "$config_dir"

        # Copy all necessary files to config directory
        [[ "${DEBUG:-false}" == "true" ]] && info "Copying files from $script_dir to $config_dir"
        cp -r "$script_dir"/* "$config_dir/" 2>/dev/null || true

        # Also copy hidden files that might be important
        cp -r "$script_dir"/.[^.]* "$config_dir/" 2>/dev/null || true

        # Ensure critical files are present
        if [[ ! -f "$config_dir/infra/kasmvnc-compose.yml" ]]; then
            error "❌ Failed to copy repository files"
            [[ "${DEBUG:-false}" == "true" ]] && ls -la "$config_dir/infra/" || true
            exit 1
        fi

        [[ "${DEBUG:-false}" == "true" ]] && info "Files in config directory:" && ls -la "$config_dir/"
        success "Repository files copied to $config_dir"
        return
    fi

    # Original git-based setup for when script is downloaded directly
    if [[ -d "$config_dir" ]]; then
        info "Updating existing repository..."
        cd "$config_dir"
        if git rev-parse --git-dir > /dev/null 2>&1; then
            git pull origin main || warning "Failed to update repository"
        else
            warning "Config directory exists but is not a git repository, recreating..."
            rm -rf "$config_dir"
            mkdir -p "$(dirname "$config_dir")"
            git clone "https://github.com/RyansOpenSauceRice/overlay-companion-mcp.git" "$config_dir"
        fi
    else
        info "Cloning repository..."
        mkdir -p "$(dirname "$config_dir")"
        git clone "https://github.com/RyansOpenSauceRice/overlay-companion-mcp.git" "$config_dir"
    fi

    cd "$config_dir"
    success "Repository ready at $config_dir"
}

# Create environment file
create_environment() {
    local config_dir="$HOME/.config/$PROJECT_NAME"
    local env_file="$config_dir/.env"

    info "Creating environment configuration..."

    cat > "$env_file" << EOF
# Overlay Companion MCP - KasmVNC Configuration
# Generated on $(date)

# Port Configuration
CONTAINER_PORT=$CONTAINER_PORT
MCP_PORT=$MCP_PORT
WEB_PORT=$WEB_PORT
KASMVNC_PORT=$KASMVNC_PORT

# KasmVNC Configuration
KASM_PORT=443
DOCKER_MTU=1500

# MCP Configuration
ASPNETCORE_URLS=http://0.0.0.0:$MCP_PORT

# Web Interface Configuration
PORT=$WEB_PORT
MCP_SERVER_URL=http://mcp-server:$MCP_PORT
KASMVNC_URL=http://kasmvnc:6901

# Docker Registry (if using pre-built images)
USE_REGISTRY=${USE_REGISTRY:-false}
EOF

    success "Environment file created: $env_file"
}

# Build or pull containers
setup_containers() {
    local config_dir="$HOME/.config/$PROJECT_NAME"

    # Validate we're in the right directory with required files
    if [[ ! -d "$config_dir" ]]; then
        error "❌ Config directory not found: $config_dir"
        exit 1
    fi

    cd "$config_dir"

    if [[ ! -f "infra/kasmvnc-compose.yml" ]]; then
        error "❌ Compose file not found: $config_dir/infra/kasmvnc-compose.yml"
        error "   This indicates a problem with repository setup."
        exit 1
    fi

    # Default to using registry images unless explicitly building from source
    if [[ "${BUILD_FROM_SOURCE:-false}" == "true" ]]; then
        info "Building containers from source..."
        podman-compose -f infra/kasmvnc-compose.yml build
    else
        info "Using pre-built containers from GitHub Container Registry..."
        # Use the registry compose file by default
        if [[ -f "infra/kasmvnc-compose-registry.yml" ]]; then
            podman-compose -f infra/kasmvnc-compose-registry.yml pull
        else
            warning "Registry compose file not found, falling back to source build"
            podman-compose -f infra/kasmvnc-compose.yml build
        fi
    fi

    success "Containers ready"
}

# Start services
start_services() {
    local config_dir="$HOME/.config/$PROJECT_NAME"

    if [[ ! -d "$config_dir" ]]; then
        error "❌ Config directory not found: $config_dir"
        exit 1
    fi

    cd "$config_dir"

    if [[ ! -f "infra/kasmvnc-compose.yml" ]]; then
        error "❌ Compose file not found: $config_dir/infra/kasmvnc-compose.yml"
        exit 1
    fi

    # Determine which compose file to use
    local compose_file="infra/kasmvnc-compose.yml"
    if [[ "${BUILD_FROM_SOURCE:-false}" != "true" ]] && [[ -f "infra/kasmvnc-compose-registry.yml" ]]; then
        compose_file="infra/kasmvnc-compose-registry.yml"
        info "Starting KasmVNC-based services using registry images..."
    else
        info "Starting KasmVNC-based services using source-built images..."
    fi

    podman-compose -f "$compose_file" up -d

    # Wait for services to start
    info "Waiting for services to initialize..."
    sleep 10

    # Check service health
    if podman-compose -f "$compose_file" ps | grep -q "Up"; then
        success "Services started successfully"
    else
        error "Some services failed to start. Check logs with: podman-compose -f $compose_file logs"
        return 1
    fi
}

# Display final information
show_completion_info() {
    local config_dir="$HOME/.config/$PROJECT_NAME"

    echo
    success "🎉 Overlay Companion MCP (KasmVNC) setup complete!"
    echo
    info "Access your system:"
    info "  📱 Main Interface: http://localhost:$CONTAINER_PORT"
    info "  🖥️  KasmVNC Desktop: http://localhost:$CONTAINER_PORT/vnc"
    info "  🤖 MCP Server: http://localhost:$MCP_PORT"
    info "  ⚙️  Web Interface: http://localhost:$CONTAINER_PORT/"
    echo
    info "Next steps:"
    info "  1. Open http://localhost:$CONTAINER_PORT in your browser"
    info "  2. Click 'Connect' to access the remote desktop"
    info "  3. Use the 'Add Display' button for multi-monitor support"
    info "  4. Copy MCP configuration for Cherry Studio integration"
    echo
    # Determine which compose file was used
    local compose_file="infra/kasmvnc-compose.yml"
    if [[ "${BUILD_FROM_SOURCE:-false}" != "true" ]] && [[ -f "$config_dir/infra/kasmvnc-compose-registry.yml" ]]; then
        compose_file="infra/kasmvnc-compose-registry.yml"
    fi

    info "Container management:"
    info "  📊 Status: cd $config_dir && podman-compose -f $compose_file ps"
    info "  📋 Logs: cd $config_dir && podman-compose -f $compose_file logs"
    info "  🔄 Restart: cd $config_dir && podman-compose -f $compose_file restart"
    info "  🛑 Stop: cd $config_dir && podman-compose -f $compose_file down"
    echo
    info "Advantages of KasmVNC over Guacamole:"
    info "  ✅ No database required (vs PostgreSQL)"
    info "  ✅ True multi-monitor support (vs single canvas)"
    info "  ✅ 4 containers instead of 6"
    info "  ✅ Simpler configuration and maintenance"
    echo
}

# Main execution
main() {
    echo -e "${BLUE}🚀 Overlay Companion MCP - KasmVNC Setup${NC}"
    echo "Setting up simplified container stack with KasmVNC..."
    echo

    # Initialize log file
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] Starting KasmVNC setup" > "$LOG_FILE"

    # Parse arguments
    parse_arguments "$@"

    # Interactive port selection if needed
    select_port_interactive "$CONTAINER_PORT"

    # Calculate derived ports
    calculate_ports

    # Setup steps
    check_requirements
    setup_repository
    create_environment
    setup_containers
    start_services
    show_completion_info

    success "Setup completed successfully! Log file: $LOG_FILE"
}

# Run main function with all arguments
main "$@"
