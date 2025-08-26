#!/bin/bash
set -euo pipefail

# Overlay Companion MCP - Single User Installation Script
# This script sets up OpenTofu + Podman + libvirt/KVM infrastructure
# and provisions a Fedora Silverblue VM with Guacamole web access

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="overlay-companion-mcp"
LOG_FILE="/tmp/${PROJECT_NAME}-install.log"

# Configuration
DEFAULT_VM_MEMORY="4096"
DEFAULT_VM_CPUS="2"
DEFAULT_CONTAINER_PORT="8080"
EXPOSE_TO_LAN="${EXPOSE_TO_LAN:-false}"
UPDATE_MODE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log() {
    echo -e "${GREEN}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

debug() {
    echo -e "${BLUE}[DEBUG]${NC} $1" | tee -a "$LOG_FILE"
}

# Check if running on supported platform
check_platform() {
    log "Checking platform compatibility..."
    
    if [[ ! -f /etc/os-release ]]; then
        error "Cannot determine OS. /etc/os-release not found."
        exit 1
    fi
    
    source /etc/os-release
    
    case "$ID" in
        fedora)
            log "✅ Fedora detected (version $VERSION_ID)"
            ;;
        rhel|centos)
            log "✅ RHEL/CentOS detected (version $VERSION_ID)"
            warn "RHEL/CentOS support is experimental"
            ;;
        *)
            error "❌ Unsupported OS: $PRETTY_NAME"
            error "This installer only supports Fedora Linux."
            error "Windows and macOS are explicitly out of scope to maintain focus and reliability."
            exit 1
            ;;
    esac
}

# Check system requirements
check_requirements() {
    log "Checking system requirements..."
    
    # Check CPU cores
    local cpu_cores=$(nproc)
    if [[ $cpu_cores -lt 4 ]]; then
        warn "⚠️  Only $cpu_cores CPU cores detected. Recommended: 4+ cores"
    else
        log "✅ CPU cores: $cpu_cores"
    fi
    
    # Check memory
    local memory_gb=$(free -g | awk '/^Mem:/{print $2}')
    if [[ $memory_gb -lt 8 ]]; then
        warn "⚠️  Only ${memory_gb}GB RAM detected. Recommended: 8GB+"
    else
        log "✅ Memory: ${memory_gb}GB"
    fi
    
    # Check disk space
    local disk_space_gb=$(df -BG "$HOME" | awk 'NR==2{print $4}' | sed 's/G//')
    if [[ $disk_space_gb -lt 80 ]]; then
        warn "⚠️  Only ${disk_space_gb}GB free space. Recommended: 80GB+"
    else
        log "✅ Disk space: ${disk_space_gb}GB available"
    fi
    
    # Check virtualization support
    if [[ -r /proc/cpuinfo ]] && grep -q "vmx\|svm" /proc/cpuinfo; then
        log "✅ Hardware virtualization supported"
    else
        error "❌ Hardware virtualization not supported or not enabled"
        error "Please enable VT-x/AMD-V in BIOS settings"
        exit 1
    fi
}

# Install dependencies
install_dependencies() {
    log "Installing system dependencies..."
    
    # Check if running as root
    if [[ $EUID -eq 0 ]]; then
        error "❌ Do not run this script as root"
        error "The script will prompt for sudo when needed"
        exit 1
    fi
    
    # Update package cache
    log "Updating package cache..."
    sudo dnf update -y --refresh
    
    # Install base packages
    local packages=(
        "podman"
        "podman-compose" 
        "libvirt"
        "libvirt-daemon-kvm"
        "qemu-kvm"
        "virt-install"
        "virt-manager"
        "virt-viewer"
        "bridge-utils"
        "curl"
        "wget"
        "unzip"
        "jq"
    )
    
    log "Installing packages: ${packages[*]}"
    sudo dnf install -y "${packages[@]}"
    
    # Add user to libvirt group
    log "Adding user to libvirt group..."
    sudo usermod -a -G libvirt "$USER"
    
    # Start and enable libvirt
    log "Starting libvirt service..."
    sudo systemctl enable --now libvirtd
    
    # Enable user session for podman
    log "Enabling user session for rootless podman..."
    systemctl --user enable --now podman.socket || true
    
    log "✅ System dependencies installed"
}

# Install OpenTofu
install_opentofu() {
    log "Installing OpenTofu..."
    
    if command -v tofu >/dev/null 2>&1; then
        local version=$(tofu version | head -n1 | awk '{print $2}')
        log "✅ OpenTofu already installed: $version"
        return 0
    fi
    
    # Download and install OpenTofu
    local tofu_version="1.6.0"
    local tofu_url="https://github.com/opentofu/opentofu/releases/download/v${tofu_version}/tofu_${tofu_version}_linux_amd64.zip"
    local temp_dir=$(mktemp -d)
    
    log "Downloading OpenTofu v${tofu_version}..."
    curl -fsSL "$tofu_url" -o "$temp_dir/tofu.zip"
    
    log "Installing OpenTofu..."
    unzip -q "$temp_dir/tofu.zip" -d "$temp_dir"
    sudo mv "$temp_dir/tofu" /usr/local/bin/
    sudo chmod +x /usr/local/bin/tofu
    
    # Create symlink for terraform compatibility
    sudo ln -sf /usr/local/bin/tofu /usr/local/bin/terraform
    
    rm -rf "$temp_dir"
    
    if command -v tofu >/dev/null 2>&1; then
        log "✅ OpenTofu installed successfully: $(tofu version | head -n1)"
    else
        error "❌ OpenTofu installation failed"
        exit 1
    fi
}

# Setup networking
setup_networking() {
    log "Setting up networking..."
    
    if [[ "$EXPOSE_TO_LAN" == "true" ]]; then
        warn "🔓 LAN exposure enabled - service will be accessible from local network"
        warn "⚠️  Security Risk: Other devices on your network can access the VM"
        warn "⚠️  Only enable this on trusted networks"
        
        read -p "Continue with LAN exposure? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log "Switching to host-only mode for security"
            EXPOSE_TO_LAN="false"
        fi
    else
        log "🔒 Using host-only networking (secure default)"
    fi
    
    # Ensure default libvirt network is active
    if ! virsh net-list --all | grep -q "default.*active"; then
        log "Starting default libvirt network..."
        sudo virsh net-start default || true
        sudo virsh net-autostart default || true
    fi
    
    log "✅ Networking configured"
}

# Download and cache Fedora Silverblue image
cache_fedora_image() {
    log "Setting up Fedora Silverblue image cache..."
    
    local cache_dir="$HOME/.cache/${PROJECT_NAME}"
    local images_dir="$cache_dir/images"
    mkdir -p "$images_dir"
    
    # Fedora Silverblue 41 (latest stable)
    local fedora_version="41"
    local image_name="Fedora-Silverblue-ostree-x86_64-${fedora_version}-1.4.iso"
    local image_path="$images_dir/$image_name"
    local image_url="https://download.fedoraproject.org/pub/fedora/linux/releases/${fedora_version}/Silverblue/x86_64/iso/${image_name}"
    
    if [[ -f "$image_path" ]]; then
        log "✅ Fedora Silverblue image already cached: $image_path"
        echo "$image_path" > "$cache_dir/fedora_image_path"
        return 0
    fi
    
    log "Downloading Fedora Silverblue ${fedora_version} ISO..."
    log "This may take several minutes depending on your connection..."
    
    # Download with progress bar
    if ! curl -fL --progress-bar "$image_url" -o "$image_path.tmp"; then
        error "❌ Failed to download Fedora Silverblue image"
        rm -f "$image_path.tmp"
        exit 1
    fi
    
    # Verify download completed
    if [[ ! -s "$image_path.tmp" ]]; then
        error "❌ Downloaded image is empty"
        rm -f "$image_path.tmp"
        exit 1
    fi
    
    mv "$image_path.tmp" "$image_path"
    echo "$image_path" > "$cache_dir/fedora_image_path"
    
    log "✅ Fedora Silverblue image cached: $image_path"
}

# Run OpenTofu provisioning
provision_infrastructure() {
    log "Provisioning infrastructure with OpenTofu..."
    
    local tofu_dir="$SCRIPT_DIR/opentofu"
    cd "$tofu_dir"
    
    # Initialize OpenTofu
    log "Initializing OpenTofu..."
    tofu init
    
    # Generate variables file
    local vars_file="terraform.tfvars.json"
    log "Generating configuration: $vars_file"
    
    # Get host IP for networking
    local host_ip
    if [[ "$EXPOSE_TO_LAN" == "true" ]]; then
        host_ip=$(ip route get 8.8.8.8 | awk '{print $7; exit}')
    else
        host_ip="127.0.0.1"
    fi
    
    # Get cached image path
    local fedora_image_path
    if [[ -f "$HOME/.cache/${PROJECT_NAME}/fedora_image_path" ]]; then
        fedora_image_path=$(cat "$HOME/.cache/${PROJECT_NAME}/fedora_image_path")
    else
        error "❌ Fedora image path not found"
        exit 1
    fi
    
    cat > "$vars_file" << EOF
{
  "project_name": "${PROJECT_NAME}",
  "vm_memory": ${DEFAULT_VM_MEMORY},
  "vm_cpus": ${DEFAULT_VM_CPUS},
  "container_port": ${DEFAULT_CONTAINER_PORT},
  "host_ip": "${host_ip}",
  "expose_to_lan": ${EXPOSE_TO_LAN},
  "fedora_image_path": "${fedora_image_path}",
  "user_home": "${HOME}",
  "user_name": "${USER}"
}
EOF
    
    # Plan and apply
    log "Planning infrastructure changes..."
    tofu plan -var-file="$vars_file"
    
    log "Applying infrastructure changes..."
    tofu apply -auto-approve -var-file="$vars_file"
    
    # Get outputs
    local management_url=$(tofu output -raw management_url 2>/dev/null || echo "")
    local vm_status=$(tofu output -raw vm_status 2>/dev/null || echo "")
    
    if [[ -n "$management_url" ]]; then
        echo "$management_url" > "$HOME/.cache/${PROJECT_NAME}/management_url"
        log "✅ Infrastructure provisioned successfully"
        log "🌐 Management URL: $management_url"
    else
        warn "⚠️  Could not determine management URL"
    fi
    
    cd - >/dev/null
}

# Wait for services to be ready
wait_for_services() {
    log "Waiting for services to start..."
    
    local management_url_file="$HOME/.cache/${PROJECT_NAME}/management_url"
    if [[ ! -f "$management_url_file" ]]; then
        error "❌ Management URL not found"
        return 1
    fi
    
    local management_url=$(cat "$management_url_file")
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        log "Checking services... (attempt $attempt/$max_attempts)"
        
        if curl -fsSL --connect-timeout 5 "$management_url/health" >/dev/null 2>&1; then
            log "✅ Management service is ready"
            break
        fi
        
        if [[ $attempt -eq $max_attempts ]]; then
            warn "⚠️  Services may still be starting. Check logs if needed."
            break
        fi
        
        sleep 10
        ((attempt++))
    done
}

# Display final instructions
show_completion() {
    log "🎉 Installation completed successfully!"
    echo
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo
    
    local management_url_file="$HOME/.cache/${PROJECT_NAME}/management_url"
    if [[ -f "$management_url_file" ]]; then
        local management_url=$(cat "$management_url_file")
        echo -e "${GREEN}🌐 Access your system at:${NC}"
        echo -e "${BLUE}   $management_url${NC}"
        echo
    fi
    
    echo -e "${GREEN}📋 Next steps:${NC}"
    echo "   1. Click the URL above to access the web interface"
    echo "   2. Use the 'Copy MCP Config' button to get the JSON configuration"
    echo "   3. Paste the configuration into Cherry Studio's MCP settings"
    echo "   4. Start using AI-assisted screen interaction!"
    echo
    
    if [[ "$EXPOSE_TO_LAN" == "true" ]]; then
        echo -e "${YELLOW}🔓 Security Notice:${NC}"
        echo "   Your system is accessible from the local network."
        echo "   Only use this on trusted networks."
        echo
    fi
    
    echo -e "${BLUE}📚 Documentation:${NC}"
    echo "   • Architecture: $SCRIPT_DIR/../ARCHITECTURE.md"
    echo "   • Deployment Guide: $SCRIPT_DIR/../DEPLOYMENT.md"
    echo
    
    echo -e "${BLUE}🔧 Management Commands:${NC}"
    echo "   • View logs: journalctl --user -u podman-${PROJECT_NAME}"
    echo "   • Stop services: cd $SCRIPT_DIR/opentofu && tofu destroy"
    echo "   • Restart: $0"
    echo
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Cleanup function
cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        error "❌ Installation failed with exit code $exit_code"
        error "📋 Check the log file: $LOG_FILE"
        echo
        echo "🔧 Troubleshooting:"
        echo "   • Ensure you have sudo privileges"
        echo "   • Check system requirements (CPU, RAM, disk space)"
        echo "   • Verify hardware virtualization is enabled"
        echo "   • Check network connectivity"
        echo
        echo "📞 For support, please share the log file: $LOG_FILE"
    fi
}

# Update existing installation
update_installation() {
    log "🔄 Updating Overlay Companion MCP installation..."
    
    # Check if OpenTofu directory exists
    if [[ ! -d "$SCRIPT_DIR/opentofu" ]]; then
        error "❌ OpenTofu directory not found. This doesn't appear to be an existing installation."
        error "Run without --update flag for fresh installation."
        exit 1
    fi
    
    # Stop existing services
    log "Stopping existing services..."
    cd "$SCRIPT_DIR/opentofu"
    if tofu state list >/dev/null 2>&1; then
        log "Destroying existing infrastructure..."
        tofu destroy -auto-approve || warn "Some resources may not have been destroyed cleanly"
    fi
    
    # Update container images
    log "Updating container images..."
    if command -v podman >/dev/null 2>&1; then
        # Remove old containers and images
        podman container prune -f || true
        podman image prune -f || true
        
        # Remove specific overlay-companion-mcp images if they exist
        podman images --format "{{.Repository}}:{{.Tag}}" | grep -E "overlay-companion|guacamole|postgres" | while read -r image; do
            log "Removing old image: $image"
            podman rmi "$image" || true
        done
    fi
    
    # Rebuild containers with new code
    log "Building updated containers..."
    cd "$SCRIPT_DIR/containers"
    if [[ -f "Dockerfile.management" ]]; then
        log "Building management container..."
        podman build -t overlay-companion-mcp-management:latest -f Dockerfile.management .
    fi
    
    # Re-provision infrastructure
    log "Re-provisioning infrastructure with updates..."
    cd "$SCRIPT_DIR/opentofu"
    tofu init -upgrade
    tofu plan -out=tfplan
    tofu apply tfplan
    
    # Wait for services to come up
    wait_for_services
    
    log "✅ Update completed successfully!"
    show_completion
}

# Main installation flow
main() {
    trap cleanup EXIT
    
    if [[ "$UPDATE_MODE" == "true" ]]; then
        echo "🔄 Overlay Companion MCP - Update Mode"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo
        
        # Clear log file
        > "$LOG_FILE"
        
        log "Running in update mode - skipping OS and dependency checks"
        update_installation
    else
        echo "🚀 Overlay Companion MCP - Single User Installation"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo
        
        # Clear log file
        > "$LOG_FILE"
        
        check_platform
        check_requirements
        install_dependencies
        install_opentofu
        setup_networking
        cache_fedora_image
        provision_infrastructure
        wait_for_services
        show_completion
    fi
}

# Handle command line arguments
case "${1:-}" in
    --help|-h)
        echo "Overlay Companion MCP Installation Script"
        echo
        echo "Usage: $0 [OPTIONS]"
        echo
        echo "Options:"
        echo "  --help, -h          Show this help message"
        echo "  --update            Update existing installation"
        echo "  --expose-lan        Expose service to LAN (security risk)"
        echo "  --host-only         Use host-only networking (default)"
        echo
        echo "Environment Variables:"
        echo "  EXPOSE_TO_LAN=true  Expose service to LAN"
        echo
        echo "Examples:"
        echo "  $0                  # Install with host-only access"
        echo "  $0 --update         # Update existing installation"
        echo "  $0 --expose-lan     # Install with LAN access"
        echo "  EXPOSE_TO_LAN=true $0  # Install with LAN access"
        exit 0
        ;;
    --update)
        UPDATE_MODE=true
        ;;
    --expose-lan)
        EXPOSE_TO_LAN="true"
        ;;
    --host-only)
        EXPOSE_TO_LAN="false"
        ;;
    "")
        # No arguments, proceed with installation
        ;;
    *)
        error "Unknown option: $1"
        echo "Use --help for usage information"
        exit 1
        ;;
esac

# Run main installation
main "$@"