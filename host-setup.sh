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
DEFAULT_MCP_PORT=3000
DEFAULT_GUACAMOLE_PORT=8081
DEFAULT_WEB_PORT=8082
DEFAULT_POSTGRES_PORT=5432
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
  OVERLAY_COMPANION_PORT=8081 ./host-setup.sh    # Set main port via environment
  MCP_PORT=3001 ./host-setup.sh                  # Set MCP server port
  GUACAMOLE_PORT=8082 ./host-setup.sh            # Set Guacamole port
  WEB_PORT=8083 ./host-setup.sh                  # Set web interface port

PORT CONFIGURATION:
  • Main Interface (Caddy): 8080 (default)
  • MCP Server: 3000 (default)
  • Guacamole: 8081 (default)
  • Web Interface: 8082 (default)
  • PostgreSQL: 5432 (internal only)
  • All ports are configurable during installation
  • Interactive conflict resolution available

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
  2. Detects and resolves port conflicts for all services
  3. Installs required packages (podman, podman-compose, etc.)
  4. Downloads and configures container setup
  5. Generates cryptographically secure credentials
  6. Builds and starts all required containers
  7. Provides access URLs, credentials, and next steps

CONTAINERS INSTALLED:
  • PostgreSQL database (for Guacamole)
  • Guacamole web-based RDP client
  • MCP server (AI overlay functionality)
  • Management web interface

ACCESS AFTER INSTALLATION:
  • Main Interface: http://localhost:8080 (Caddy proxy)
  • MCP Server: http://localhost:3000 (direct access)
  • Guacamole: http://localhost:8080/guac/ (with generated credentials)
  • Web Interface: http://localhost:8080/ (overlay management)
  • All ports are configurable during installation

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

# Configure all service ports
configure_service_ports() {
    log "Configuring service ports..."
    
    # Set defaults if not already set
    MCP_PORT=${MCP_PORT:-$DEFAULT_MCP_PORT}
    GUACAMOLE_PORT=${GUACAMOLE_PORT:-$DEFAULT_GUACAMOLE_PORT}
    WEB_PORT=${WEB_PORT:-$DEFAULT_WEB_PORT}
    POSTGRES_PORT=${POSTGRES_PORT:-$DEFAULT_POSTGRES_PORT}
    
    # Check for port conflicts and offer alternatives
    local ports_to_check=("$CONTAINER_PORT:Main Interface" "$MCP_PORT:MCP Server" "$GUACAMOLE_PORT:Guacamole" "$WEB_PORT:Web Interface")
    local conflicts=()
    
    for port_info in "${ports_to_check[@]}"; do
        local port="${port_info%%:*}"
        local service="${port_info##*:}"
        
        if check_port "$port"; then
            conflicts+=("$port:$service")
        fi
    done
    
    if [[ ${#conflicts[@]} -gt 0 ]]; then
        warn "⚠️  Port conflicts detected:"
        for conflict in "${conflicts[@]}"; do
            local port="${conflict%%:*}"
            local service="${conflict##*:}"
            echo "   • Port $port ($service) is already in use"
        done
        echo ""
        
        echo "Options:"
        echo "1. Auto-resolve conflicts (recommended)"
        echo "2. Manually specify ports"
        echo "3. Exit and resolve conflicts manually"
        echo ""
        read -p "Choose option (1-3): " -n 1 -r choice
        echo ""
        
        case $choice in
            1)
                log "Auto-resolving port conflicts..."
                for conflict in "${conflicts[@]}"; do
                    local port="${conflict%%:*}"
                    local service="${conflict##*:}"
                    local new_port=$(find_available_port $((port + 1)))
                    
                    case $service in
                        "Main Interface") CONTAINER_PORT=$new_port ;;
                        "MCP Server") MCP_PORT=$new_port ;;
                        "Guacamole") GUACAMOLE_PORT=$new_port ;;
                        "Web Interface") WEB_PORT=$new_port ;;
                    esac
                    
                    log "   $service: $port → $new_port"
                done
                ;;
            2)
                echo "Enter custom ports (press Enter for default):"
                read -p "Main Interface [$CONTAINER_PORT]: " custom_main
                read -p "MCP Server [$MCP_PORT]: " custom_mcp
                read -p "Guacamole [$GUACAMOLE_PORT]: " custom_guac
                read -p "Web Interface [$WEB_PORT]: " custom_web
                
                [[ -n "$custom_main" ]] && CONTAINER_PORT="$custom_main"
                [[ -n "$custom_mcp" ]] && MCP_PORT="$custom_mcp"
                [[ -n "$custom_guac" ]] && GUACAMOLE_PORT="$custom_guac"
                [[ -n "$custom_web" ]] && WEB_PORT="$custom_web"
                ;;
            3)
                error "❌ Installation cancelled. Please resolve port conflicts and try again."
                exit 1
                ;;
            *)
                error "❌ Invalid choice. Exiting."
                exit 1
                ;;
        esac
    fi
    
    log "✅ Service ports configured:"
    log "   🌐 Main Interface (Caddy): $CONTAINER_PORT"
    log "   🤖 MCP Server: $MCP_PORT"
    log "   🖥️  Guacamole: $GUACAMOLE_PORT"
    log "   📱 Web Interface: $WEB_PORT"
    log "   🗄️  PostgreSQL: $POSTGRES_PORT (internal)"
    
    # Export for use in other functions
    export CONTAINER_PORT MCP_PORT GUACAMOLE_PORT WEB_PORT POSTGRES_PORT
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

# Generate cryptographically secure credentials
generate_credentials() {
    log "Generating cryptographically secure credentials..."
    
    local project_dir="$HOME/$PROJECT_NAME"
    local creds_file="$project_dir/.credentials"
    local env_file="$project_dir/infra/.env"
    
    # Generate secure random passwords (32 characters, alphanumeric + special chars)
    local db_password=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
    local guac_admin_password=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
    local guac_admin_user="admin_$(openssl rand -hex 4)"
    
    # Create credentials file (readable only by owner)
    cat > "$creds_file" << EOF
# Overlay Companion MCP - Generated Credentials
# Generated on: $(date)
# Keep this file secure and do not commit to version control

# PostgreSQL Database Credentials
DB_USER=guacamole
DB_PASSWORD=$db_password
DB_NAME=guacamole_db

# Guacamole Web Interface Credentials  
GUAC_ADMIN_USER=$guac_admin_user
GUAC_ADMIN_PASSWORD=$guac_admin_password

# Access URLs (after installation)
MAIN_INTERFACE=http://localhost:$CONTAINER_PORT
MCP_SERVER=http://localhost:$MCP_PORT
GUACAMOLE_WEB=http://localhost:$CONTAINER_PORT/guac/
WEB_INTERFACE=http://localhost:$CONTAINER_PORT/
EOF
    
    # Set secure permissions (owner read/write only)
    chmod 600 "$creds_file"
    
    # Create .env file for docker-compose
    cat > "$env_file" << EOF
# Auto-generated environment variables for Overlay Companion MCP
# Generated on: $(date)

# PostgreSQL Configuration
POSTGRES_USER=guacamole
POSTGRES_PASSWORD=$db_password
POSTGRES_DB=guacamole_db

# Guacamole Configuration
GUAC_ADMIN_USER=$guac_admin_user
GUAC_ADMIN_PASSWORD=$guac_admin_password

# Port Configuration
CONTAINER_PORT=$CONTAINER_PORT
MCP_PORT=$MCP_PORT
GUACAMOLE_PORT=$GUACAMOLE_PORT
WEB_PORT=$WEB_PORT
POSTGRES_PORT=$POSTGRES_PORT
EOF
    
    # Set secure permissions for .env file
    chmod 600 "$env_file"
    
    log "✅ Secure credentials generated:"
    log "   📁 Credentials file: $creds_file"
    log "   📁 Environment file: $env_file"
    log "   🔒 Files secured with 600 permissions (owner only)"
    
    # Store credentials for later display
    export GENERATED_DB_PASSWORD="$db_password"
    export GENERATED_GUAC_USER="$guac_admin_user"
    export GENERATED_GUAC_PASSWORD="$guac_admin_password"
}

# Setup containers
setup_containers() {
    log "Setting up containers..."
    
    # Create container configuration directory
    local config_dir="$HOME/.config/$PROJECT_NAME"
    mkdir -p "$config_dir"
    
    # Copy container configurations from infra directory (separate containers with custom web interface)
    cp -r infra/* "$config_dir/"
    
    # Copy the generated .env file to the config directory
    local project_dir="$HOME/$PROJECT_NAME"
    if [[ -f "$project_dir/infra/.env" ]]; then
        cp "$project_dir/infra/.env" "$config_dir/.env"
        log "✅ Environment configuration copied"
    else
        warn "⚠️  .env file not found, using defaults"
    fi
    
    cd "$config_dir"
    
    # Build MCP server container
    log "Building MCP server container..."
    cd "$project_dir"  # Build from project root where src/ directory exists
    podman build -f infra/Dockerfile.mcp -t overlay-companion-mcp . >> "$LOG_FILE" 2>&1
    
    # Build custom overlay web interface container
    log "Building custom overlay web interface with MCP-powered icons..."
    podman build -f infra/Dockerfile.web -t overlay-companion-web . >> "$LOG_FILE" 2>&1
    cd "$config_dir"  # Return to config directory
    
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
    echo "🌐 Main Interface (Caddy): http://$vm_ip:$CONTAINER_PORT"
    echo "🤖 MCP Server (Direct): http://$vm_ip:$MCP_PORT"
    echo "🖥️  Guacamole Web: http://$vm_ip:$CONTAINER_PORT/guac/"
    echo "📱 Web Interface: http://$vm_ip:$CONTAINER_PORT/"
    echo ""
    echo "🔐 Generated Credentials:"
    echo "• Guacamole Login: $GENERATED_GUAC_USER"
    echo "• Guacamole Password: $GENERATED_GUAC_PASSWORD"
    echo "• Database Password: [stored in ~/.credentials]"
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
    echo "🔐 Credentials file: ~/$PROJECT_NAME/.credentials"
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
    configure_service_ports
    install_dependencies
    setup_project
    generate_credentials
    setup_containers
    start_services
    wait_for_services
    show_completion
}

# Run main function
main "$@"