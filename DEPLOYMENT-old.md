# Deployment Guide - Overlay Companion MCP

Multiple ways to deploy and run Overlay Companion MCP, from simple local installation to cloud deployment.

## 🚀 Option 1: VM-Based Installation (Recommended)

**Create a Fedora VM, then run the setup script inside it:**

### Step 1: Create Fedora VM
Use your preferred platform:
- **Proxmox**: Create VM with Fedora template
- **TrueNAS**: VM manager with Fedora ISO
- **Boxes**: Create new Fedora virtual machine
- **VirtualBox/VMware**: Standard Fedora VM

**VM Requirements:**
- Fedora Linux (latest stable)
- 8+ GB RAM, 4+ CPU cores, 50+ GB disk
- Internet access, hardware acceleration

### Step 2: Run Setup Inside VM
```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSauceRice/overlay-companion-mcp/main/setup.sh | bash
```

**What it installs:**
- ✅ Unified MCP + Management container (C# overlay + Node.js web interface)
- ✅ PostgreSQL container (database for Guacamole)
- ✅ Guacamole containers (web-based remote desktop)
- ✅ All containers managed by podman-compose
- ✅ Ready to use in 10-15 minutes

**After installation:**
- Web Interface: `http://[VM-IP]:8080`
- MCP Server: `http://[VM-IP]:8080/mcp`

---

## 🐳 Option 2: Podman (OCI Containers - Existing Infrastructure)

**The project already has Podman infrastructure with Guacamole integration!**

### Simple MCP-Only Deployment
```bash
# Clone repository
git clone https://github.com/RyansOpenSauceRice/overlay-companion-mcp.git
cd overlay-companion-mcp

# Build and run just the MCP server
podman build -t overlay-companion-mcp -f infra/Dockerfile.mcp .
podman run -d --name overlay-companion -p 3000:3000 overlay-companion-mcp
```

### Full Stack with Guacamole (Advanced)
**For remote desktop integration with web-based overlays:**

```bash
cd overlay-companion-mcp/infra

# Set environment variables for Guacamole
export GUAC_ADMIN_USER=admin
export GUAC_ADMIN_PASS=yourpassword
export GUAC_CONN_NAME=my-desktop
export GUAC_RDP_HOST=your-vm-ip
export GUAC_RDP_USERNAME=your-username
export GUAC_RDP_PASSWORD=your-password

# Start the full stack
podman-compose up -d
```

**What this gives you:**
- ✅ MCP server on port 3000
- ✅ Guacamole web interface on port 8081
- ✅ Caddy reverse proxy on port 8080
- ✅ PostgreSQL database for Guacamole
- ✅ Remote desktop integration

### Podman vs Docker Benefits
- ✅ **Rootless**: Runs without root privileges
- ✅ **Systemd integration**: Better service management
- ✅ **OCI compliant**: Uses same container images
- ✅ **No daemon**: More secure architecture
- ✅ **Drop-in replacement**: Same commands as Docker

---

## ☁️ Option 3: Cloud Deployment

### Railway (Easiest Cloud Option)
1. Fork the repository on GitHub
2. Connect to [Railway](https://railway.app)
3. Deploy from GitHub
4. Set environment variables:
   - `PORT=3000`
   - `ASPNETCORE_ENVIRONMENT=Production`

### Heroku Alternative - Render
1. Fork the repository
2. Connect to [Render](https://render.com)
3. Create new Web Service
4. Build command: `dotnet publish src/OverlayCompanion.csproj -c Release -o out`
5. Start command: `dotnet out/overlay-companion-mcp.dll`

### DigitalOcean App Platform
1. Fork repository
2. Create new app on [DigitalOcean](https://cloud.digitalocean.com/apps)
3. Connect GitHub repository
4. Configure build:
   - Build command: `dotnet publish src/OverlayCompanion.csproj -c Release -o out`
   - Run command: `dotnet out/overlay-companion-mcp.dll`

### AWS/GCP/Azure
Use the Docker image with their container services:
- **AWS**: ECS Fargate or App Runner
- **GCP**: Cloud Run
- **Azure**: Container Instances

---

## 🖥️ Option 4: VPS/Server Deployment

### Ubuntu/Debian Server
```bash
# Install .NET 8.0
wget https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb
sudo dpkg -i packages-microsoft-prod.deb
sudo apt update
sudo apt install -y dotnet-sdk-8.0 git

# Clone and build
git clone https://github.com/RyansOpenSauceRice/overlay-companion-mcp.git
cd overlay-companion-mcp
dotnet build -c Release src/OverlayCompanion.csproj -o build/publish

# Install as systemd service
sudo cp overlay-companion-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now overlay-companion-mcp

# Check status
sudo systemctl status overlay-companion-mcp
```

### CentOS/RHEL/Fedora
```bash
# Install .NET 8.0
sudo dnf install -y dotnet-sdk-8.0 git

# Same build and service steps as Ubuntu
```

### Reverse Proxy (Nginx)
```nginx
# /etc/nginx/sites-available/overlay-companion
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection keep-alive;
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 📱 Option 5: Local Development

### Manual Build (No Scripts)
```bash
# Prerequisites: .NET 8.0 SDK
git clone https://github.com/RyansOpenSauceRice/overlay-companion-mcp.git
cd overlay-companion-mcp
dotnet restore src/OverlayCompanion.csproj
dotnet build -c Release src/OverlayCompanion.csproj -o build/publish
./build/publish/overlay-companion-mcp
```

### Development Mode
```bash
cd src
dotnet run  # Runs on http://localhost:5000 by default
```

---

## 🔧 Configuration Options

### Environment Variables
```bash
# Port configuration
PORT=8080                    # Custom port (default: 3000)
OC_PORT=8080                # Alternative port variable

# Mode configuration
OC_SMOKE_TEST=1             # Run startup test and exit
ASPNETCORE_ENVIRONMENT=Production  # Production mode

# Feature flags
OC_DISABLE_GUI=1            # Disable native GUI (web-only)
OC_ENABLE_CORS=1            # Enable CORS for web requests
```

### Custom Configuration
```bash
# Custom port
PORT=8080 ./run.sh

# Production mode
ASPNETCORE_ENVIRONMENT=Production ./run.sh

# Smoke test
OC_SMOKE_TEST=1 ./build/publish/overlay-companion-mcp
```

---

## 🛠️ Troubleshooting

### Common Issues

#### Port Already in Use
```bash
# Find what's using port 3000
sudo lsof -i :3000
# or
sudo netstat -tlnp | grep 3000

# Use different port
PORT=8080 ./run.sh
```

#### .NET Not Found
```bash
# Install .NET 8.0
# Ubuntu/Debian:
wget https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb
sudo dpkg -i packages-microsoft-prod.deb
sudo apt update && sudo apt install -y dotnet-sdk-8.0

# CentOS/RHEL/Fedora:
sudo dnf install -y dotnet-sdk-8.0
```

#### Permission Denied
```bash
# Make scripts executable
chmod +x install.sh run.sh
chmod +x build/publish/overlay-companion-mcp
```

#### Screen Capture Not Working
```bash
# Install screen capture tools
# Wayland:
sudo apt install -y grim wl-clipboard

# X11:
sudo apt install -y scrot xclip
```

### Logs and Debugging
```bash
# Check service logs
sudo journalctl -u overlay-companion-mcp -f

# Run in debug mode
ASPNETCORE_ENVIRONMENT=Development ./run.sh

# Test connectivity
curl http://localhost:3000/config
```

---

## 🔒 Security Considerations

### Production Deployment
- Use HTTPS with reverse proxy (Nginx/Apache)
- Configure firewall rules
- Run as non-root user
- Regular security updates
- Monitor logs for suspicious activity

### Network Security
```bash
# Firewall rules (UFW)
sudo ufw allow 3000/tcp
sudo ufw enable

# Or restrict to specific IPs
sudo ufw allow from 192.168.1.0/24 to any port 3000
```

---

## 📊 Monitoring

### Health Checks
```bash
# Basic health check
curl http://localhost:3000/config

# Smoke test
OC_SMOKE_TEST=1 ./build/publish/overlay-companion-mcp
```

### System Monitoring
```bash
# Resource usage
htop
docker stats  # For Docker deployment

# Service status
sudo systemctl status overlay-companion-mcp
```

---

## 🚀 Quick Comparison

| Method | Complexity | Time | Best For | GUI Access |
|--------|------------|------|----------|------------|
| **install.sh** | ⭐ | 2-3 min | Local use, quick start | ✅ Full |
| **Podman (MCP only)** | ⭐⭐ | 5 min | Isolation, local containers | ❌ Limited |
| **Podman (Full stack)** | ⭐⭐⭐ | 15 min | Remote desktop integration | ✅ Via Guacamole |
| **Cloud (Railway)** | ⭐⭐ | 10 min | Remote access, scaling | ❌ None |
| **VPS/Server** | ⭐⭐⭐ | 15 min | Production, control | ❌ None |
| **Manual Build** | ⭐⭐⭐⭐ | 10 min | Development, customization | ✅ Full |

**Recommendation**: 
- **Local GUI use**: `install.sh` (simplest)
- **Remote desktop**: Podman full stack with Guacamole
- **Development**: Manual build