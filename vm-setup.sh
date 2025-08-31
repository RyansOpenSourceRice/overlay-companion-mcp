#!/bin/bash
# ⚠️ DEPRECATED: VM Setup Script for Guacamole-based Overlay Companion MCP
#
# This script sets up LEGACY RDP services for Guacamole connections.
#
# ⚠️ WARNING: This setup is DEPRECATED in favor of KasmVNC architecture.
# Use vm-setup-kasmvnc.sh instead for:
# ✅ No complex RDP configuration
# ✅ Web-native VNC server
# ✅ True multi-monitor support
# ✅ Simpler setup process
#
# This script runs INSIDE a Fedora Silverblue VM to set up RDP services
# The containers run on the HOST OS, not in this VM

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Show deprecation warning
echo -e "${RED}⚠️  DEPRECATION WARNING ⚠️${NC}"
echo -e "${YELLOW}This Guacamole-based VM setup is DEPRECATED.${NC}"
echo -e "${YELLOW}Use 'vm-setup-kasmvnc.sh' instead for:${NC}"
echo -e "${GREEN}✅ Web-native VNC server (no RDP complexity)${NC}"
echo -e "${GREEN}✅ True multi-monitor support${NC}"
echo -e "${GREEN}✅ Simpler configuration${NC}"
echo -e "${GREEN}✅ Better performance${NC}"
echo ""
echo -e "${YELLOW}Continue with deprecated Guacamole VM setup? (y/N)${NC}"
read -r response
if [[ ! "$response" =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}Recommended: Download KasmVNC VM setup instead:${NC}"
    echo "curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/vm-setup-kasmvnc.sh | bash"
    exit 0
fi
echo -e "${YELLOW}Proceeding with deprecated Guacamole VM setup...${NC}"
echo ""

# Logging
LOG_FILE="/tmp/overlay-companion-vm-setup.log"

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] SUCCESS:${NC} $1" | tee -a "$LOG_FILE"
}

# Check if running on Fedora
check_os() {
    if ! grep -q "Fedora" /etc/os-release; then
        error "This script is designed for Fedora. Other distributions may work but are not tested."
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Install RDP server and desktop environment
install_rdp_services() {
    log "Installing RDP services and desktop environment..."

    # Update system
    sudo dnf update -y >> "$LOG_FILE" 2>&1

    # Install GNOME desktop (if not already installed)
    if ! rpm -q gnome-shell >/dev/null 2>&1; then
        log "Installing GNOME desktop environment..."
        sudo dnf groupinstall -y "GNOME Desktop Environment" >> "$LOG_FILE" 2>&1
    fi

    # Install XRDP
    log "Installing XRDP server..."
    sudo dnf install -y xrdp xrdp-selinux >> "$LOG_FILE" 2>&1

    # Install VNC server as backup
    log "Installing VNC server..."
    sudo dnf install -y tigervnc-server >> "$LOG_FILE" 2>&1

    # Install additional tools
    log "Installing additional tools..."
    sudo dnf install -y \
        firefox \
        gnome-terminal \
        nautilus \
        gedit \
        htop \
        curl \
        wget \
        git >> "$LOG_FILE" 2>&1

    success "RDP services and desktop installed"
}

# Configure XRDP
configure_xrdp() {
    log "Configuring XRDP..."

    # Enable and start XRDP
    sudo systemctl enable xrdp >> "$LOG_FILE" 2>&1
    sudo systemctl start xrdp >> "$LOG_FILE" 2>&1

    # Configure firewall
    log "Configuring firewall for RDP..."
    sudo firewall-cmd --permanent --add-port=3389/tcp >> "$LOG_FILE" 2>&1
    sudo firewall-cmd --reload >> "$LOG_FILE" 2>&1

    # Set SELinux context for XRDP
    sudo setsebool -P xrdp_can_network_connect 1 >> "$LOG_FILE" 2>&1

    success "XRDP configured and started"
}

# Configure VNC as backup
configure_vnc() {
    log "Configuring VNC server..."

    # Create VNC user directory
    mkdir -p ~/.vnc

    # Set VNC password (you'll be prompted)
    echo "Please set a VNC password for user $(whoami):"
    vncpasswd

    # Create VNC service file
    sudo tee /etc/systemd/system/vncserver@.service > /dev/null << 'EOF'
[Unit]
Description=Remote desktop service (VNC)
After=syslog.target network.target

[Service]
Type=forking
User=%i
ExecStartPre=/bin/sh -c '/usr/bin/vncserver -kill :%i > /dev/null 2>&1 || :'
ExecStart=/usr/bin/vncserver -depth 24 -geometry 1920x1080 :%i
ExecStop=/usr/bin/vncserver -kill :%i

[Install]
WantedBy=multi-user.target
EOF

    # Enable VNC for current user
    sudo systemctl daemon-reload
    sudo systemctl enable vncserver@1.service
    sudo systemctl start vncserver@1.service

    # Configure firewall for VNC
    sudo firewall-cmd --permanent --add-port=5901/tcp >> "$LOG_FILE" 2>&1
    sudo firewall-cmd --reload >> "$LOG_FILE" 2>&1

    success "VNC server configured"
}

# Create test user for RDP access
create_rdp_user() {
    log "Creating RDP test user..."

    # Create user 'rdpuser' if it doesn't exist
    if ! id "rdpuser" >/dev/null 2>&1; then
        sudo useradd -m -s /bin/bash rdpuser
        echo "Please set password for rdpuser:"
        sudo passwd rdpuser

        # Add to necessary groups
        sudo usermod -aG wheel rdpuser

        success "RDP user 'rdpuser' created"
    else
        log "RDP user 'rdpuser' already exists"
    fi
}

# Display connection information
show_connection_info() {
    local vm_ip=$(hostname -I | awk '{print $1}')

    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}🎉 VM RDP Setup Complete!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "📡 VM Connection Details:"
    echo "• VM IP Address: $vm_ip"
    echo "• RDP Port: 3389"
    echo "• VNC Port: 5901"
    echo ""
    echo "👤 RDP Users:"
    echo "• Current user: $(whoami)"
    echo "• Test user: rdpuser"
    echo ""
    echo "🔧 Next Steps:"
    echo "1. Go back to your HOST Fedora Linux system"
    echo "2. Run the container setup: curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/host-setup.sh | bash"
    echo "3. Access the management interface at http://localhost:8080"
    echo "4. Add this VM using IP: $vm_ip"
    echo ""
    echo "🔍 Testing RDP Connection:"
    echo "• From host: xfreerdp /v:$vm_ip /u:$(whoami)"
    echo "• Or use any RDP client with IP: $vm_ip"
    echo ""
    echo "📋 Setup log: $LOG_FILE"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Main execution
main() {
    echo -e "${BLUE}🖥️  Overlay Companion MCP - VM RDP Setup${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "This script sets up RDP services in your Fedora VM."
    echo "The containers will run on your HOST OS, not in this VM."
    echo ""

    check_os
    install_rdp_services
    configure_xrdp
    configure_vnc
    create_rdp_user
    show_connection_info
}

# Run main function
main "$@"
