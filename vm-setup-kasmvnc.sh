#!/bin/bash

# Overlay Companion MCP - KasmVNC VM Setup Script
# This script sets up KasmVNC server on a VM for remote desktop access
# Much simpler than the previous XRDP + VNC setup
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/RyansOpenSauceRice/overlay-companion-mcp/main/vm-setup-kasmvnc.sh | bash
#   OR
#   ./vm-setup-kasmvnc.sh

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
KASMVNC_VERSION="1.3.1"
KASMVNC_PORT=6901
VNC_PORT=5901
LOG_FILE="/tmp/kasmvnc-vm-setup.log"

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

# Check if running on supported OS
check_os() {
    info "Checking operating system..."
    
    if [[ -f /etc/os-release ]]; then
        source /etc/os-release
        case $ID in
            fedora)
                OS_TYPE="fedora"
                PACKAGE_MANAGER="dnf"
                ;;
            ubuntu|debian)
                OS_TYPE="debian"
                PACKAGE_MANAGER="apt"
                ;;
            centos|rhel)
                OS_TYPE="rhel"
                PACKAGE_MANAGER="yum"
                ;;
            *)
                warning "Unsupported OS: $ID. This script is designed for Fedora, Ubuntu, or RHEL-based systems."
                warning "Continuing anyway, but you may need to install dependencies manually."
                OS_TYPE="unknown"
                ;;
        esac
    else
        error "Cannot determine operating system. /etc/os-release not found."
        exit 1
    fi
    
    success "Detected OS: $OS_TYPE"
}

# Install system dependencies
install_dependencies() {
    info "Installing system dependencies..."
    
    case $OS_TYPE in
        fedora)
            sudo dnf update -y
            sudo dnf install -y \
                wget curl unzip \
                xorg-x11-server-Xvfb \
                xorg-x11-xauth \
                dbus-x11 \
                mesa-dri-drivers \
                pulseaudio \
                firefox \
                gnome-terminal \
                file-roller \
                gedit
            ;;
        debian)
            sudo apt update
            sudo apt install -y \
                wget curl unzip \
                xvfb \
                xauth \
                dbus-x11 \
                mesa-utils \
                pulseaudio \
                firefox-esr \
                gnome-terminal \
                file-roller \
                gedit
            ;;
        rhel)
            sudo yum update -y
            sudo yum install -y \
                wget curl unzip \
                xorg-x11-server-Xvfb \
                xorg-x11-xauth \
                dbus-x11 \
                mesa-dri-drivers \
                pulseaudio \
                firefox \
                gnome-terminal
            ;;
        *)
            warning "Unknown OS type. Please install the following manually:"
            warning "  - Xvfb (virtual framebuffer)"
            warning "  - Basic desktop applications (firefox, terminal, etc.)"
            ;;
    esac
    
    success "System dependencies installed"
}

# Download and install KasmVNC
install_kasmvnc() {
    info "Installing KasmVNC server..."
    
    local temp_dir=$(mktemp -d)
    cd "$temp_dir"
    
    # Determine architecture
    local arch=$(uname -m)
    case $arch in
        x86_64)
            arch_suffix="amd64"
            ;;
        aarch64|arm64)
            arch_suffix="arm64"
            ;;
        *)
            error "Unsupported architecture: $arch"
            exit 1
            ;;
    esac
    
    # Download KasmVNC
    local download_url="https://github.com/kasmtech/KasmVNC/releases/download/v${KASMVNC_VERSION}/kasmvnc_${KASMVNC_VERSION}_${arch_suffix}.deb"
    
    if [[ $OS_TYPE == "debian" ]]; then
        info "Downloading KasmVNC .deb package..."
        wget -O kasmvnc.deb "$download_url"
        sudo dpkg -i kasmvnc.deb || sudo apt-get install -f -y
    else
        # For non-Debian systems, we'll build from source or use alternative method
        info "Downloading KasmVNC source for non-Debian system..."
        wget -O kasmvnc.tar.gz "https://github.com/kasmtech/KasmVNC/archive/refs/tags/v${KASMVNC_VERSION}.tar.gz"
        tar -xzf kasmvnc.tar.gz
        cd "KasmVNC-${KASMVNC_VERSION}"
        
        # Install build dependencies
        case $OS_TYPE in
            fedora)
                sudo dnf install -y cmake gcc-c++ libjpeg-turbo-devel libpng-devel libtiff-devel giflib-devel zlib-devel
                ;;
            rhel)
                sudo yum install -y cmake gcc-c++ libjpeg-turbo-devel libpng-devel libtiff-devel giflib-devel zlib-devel
                ;;
        esac
        
        # Build and install
        mkdir build && cd build
        cmake .. -DCMAKE_BUILD_TYPE=Release
        make -j$(nproc)
        sudo make install
    fi
    
    # Cleanup
    cd /
    rm -rf "$temp_dir"
    
    success "KasmVNC installed successfully"
}

# Configure KasmVNC
configure_kasmvnc() {
    info "Configuring KasmVNC..."
    
    # Create VNC directory
    mkdir -p ~/.vnc
    
    # Create KasmVNC configuration
    cat > ~/.vnc/kasmvnc.yaml << EOF
desktop:
  resolution:
    width: 1920
    height: 1080
  allow_resize: true

network:
  interface: 0.0.0.0
  websocket_port: $KASMVNC_PORT
  vnc_port: $VNC_PORT
  ssl:
    require_ssl: false

security:
  brute_force_protection: true
  max_login_attempts: 5

encoding:
  max_frame_rate: 60
  jpeg_quality: 9
  webp_quality: 9
  prefer_bandwidth: 100

runtime_configuration:
  allow_client_to_override_kasm_server_settings: true

# Multi-monitor support
display_manager:
  enabled: true
  max_displays: 4
  default_layout: horizontal

# Overlay integration
overlay:
  enabled: true
  click_through: true
  transparency: 0.5
EOF
    
    # Set VNC password (optional - KasmVNC can run without password for local access)
    if command -v vncpasswd >/dev/null 2>&1; then
        info "Setting VNC password (optional - press Enter to skip)..."
        vncpasswd || true
    fi
    
    success "KasmVNC configuration created"
}

# Create startup script
create_startup_script() {
    info "Creating KasmVNC startup script..."
    
    cat > ~/.vnc/start-kasmvnc.sh << 'EOF'
#!/bin/bash

# KasmVNC Startup Script for Overlay Companion MCP

export DISPLAY=:1
export KASM_VNC=true

# Start Xvfb (virtual framebuffer)
Xvfb :1 -screen 0 1920x1080x24 -ac -nolisten tcp -dpi 96 &
XVFB_PID=$!

# Wait for Xvfb to start
sleep 2

# Start window manager (lightweight)
if command -v openbox >/dev/null 2>&1; then
    openbox &
elif command -v fluxbox >/dev/null 2>&1; then
    fluxbox &
elif command -v xfwm4 >/dev/null 2>&1; then
    xfwm4 &
fi

# Start desktop applications
gnome-terminal &
firefox &

# Start KasmVNC server
kasmvnc -geometry 1920x1080 -depth 24 -websocket 6901 -httpd /usr/share/kasmvnc/www -config ~/.vnc/kasmvnc.yaml :1

# Cleanup on exit
trap "kill $XVFB_PID" EXIT
EOF
    
    chmod +x ~/.vnc/start-kasmvnc.sh
    
    success "Startup script created at ~/.vnc/start-kasmvnc.sh"
}

# Create systemd service
create_systemd_service() {
    info "Creating systemd service for KasmVNC..."
    
    cat > ~/.config/systemd/user/kasmvnc.service << EOF
[Unit]
Description=KasmVNC Server for Overlay Companion MCP
After=network.target

[Service]
Type=forking
ExecStart=/home/$USER/.vnc/start-kasmvnc.sh
ExecStop=/usr/bin/pkill -f kasmvnc
Restart=always
RestartSec=10
Environment=HOME=/home/$USER
Environment=USER=$USER

[Install]
WantedBy=default.target
EOF
    
    # Create systemd user directory if it doesn't exist
    mkdir -p ~/.config/systemd/user
    
    # Reload systemd and enable service
    systemctl --user daemon-reload
    systemctl --user enable kasmvnc.service
    
    success "Systemd service created and enabled"
}

# Configure firewall
configure_firewall() {
    info "Configuring firewall for KasmVNC..."
    
    if command -v firewall-cmd >/dev/null 2>&1; then
        # Fedora/RHEL firewall
        sudo firewall-cmd --permanent --add-port=$KASMVNC_PORT/tcp
        sudo firewall-cmd --permanent --add-port=$VNC_PORT/tcp
        sudo firewall-cmd --reload
        success "Firewall configured (firewalld)"
    elif command -v ufw >/dev/null 2>&1; then
        # Ubuntu firewall
        sudo ufw allow $KASMVNC_PORT/tcp
        sudo ufw allow $VNC_PORT/tcp
        success "Firewall configured (ufw)"
    else
        warning "No supported firewall found. You may need to manually open ports $KASMVNC_PORT and $VNC_PORT"
    fi
}

# Start KasmVNC service
start_kasmvnc() {
    info "Starting KasmVNC service..."
    
    systemctl --user start kasmvnc.service
    
    # Wait for service to start
    sleep 5
    
    if systemctl --user is-active --quiet kasmvnc.service; then
        success "KasmVNC service started successfully"
    else
        error "Failed to start KasmVNC service. Check logs with: systemctl --user status kasmvnc.service"
        return 1
    fi
}

# Get VM IP address
get_vm_ip() {
    local vm_ip
    
    # Try different methods to get IP
    if command -v hostname >/dev/null 2>&1; then
        vm_ip=$(hostname -I | awk '{print $1}')
    elif command -v ip >/dev/null 2>&1; then
        vm_ip=$(ip route get 1 | awk '{print $7; exit}')
    else
        vm_ip="<VM_IP_ADDRESS>"
        warning "Could not determine VM IP address automatically"
    fi
    
    echo "$vm_ip"
}

# Display completion information
show_completion_info() {
    local vm_ip=$(get_vm_ip)
    
    echo
    success "🎉 KasmVNC VM setup complete!"
    echo
    info "KasmVNC is now running on this VM:"
    info "  🌐 Web Interface: http://$vm_ip:$KASMVNC_PORT"
    info "  🖥️  VNC Port: $vm_ip:$VNC_PORT"
    echo
    info "Service management:"
    info "  📊 Status: systemctl --user status kasmvnc.service"
    info "  🔄 Restart: systemctl --user restart kasmvnc.service"
    info "  🛑 Stop: systemctl --user stop kasmvnc.service"
    info "  📋 Logs: journalctl --user -u kasmvnc.service -f"
    echo
    info "Next steps:"
    info "  1. Configure your host containers to connect to: $vm_ip:$KASMVNC_PORT"
    info "  2. Access the desktop via web browser at: http://$vm_ip:$KASMVNC_PORT"
    info "  3. Use the Display Manager in KasmVNC for multi-monitor support"
    echo
    info "Advantages of KasmVNC:"
    info "  ✅ True multi-monitor support with separate browser windows"
    info "  ✅ Web-native interface, no VNC client needed"
    info "  ✅ Better performance and modern protocols"
    info "  ✅ Built-in overlay support for AI integration"
    echo
}

# Main execution
main() {
    echo -e "${BLUE}🚀 KasmVNC VM Setup for Overlay Companion MCP${NC}"
    echo "Setting up KasmVNC server for remote desktop access..."
    echo
    
    # Initialize log file
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] Starting KasmVNC VM setup" > "$LOG_FILE"
    
    # Setup steps
    check_os
    install_dependencies
    install_kasmvnc
    configure_kasmvnc
    create_startup_script
    create_systemd_service
    configure_firewall
    start_kasmvnc
    show_completion_info
    
    success "VM setup completed successfully! Log file: $LOG_FILE"
}

# Run main function
main "$@"