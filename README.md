# Overlay Companion MCP

[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io) [![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure) [![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/RyansOpenSourceRice/overlay-companion-mcp?label=openssf%20scorecard)](https://securityscorecards.dev/viewer/?uri=github.com/RyansOpenSourceRice/overlay-companion-mcp)

> Friendly note: this project is in prefunctional development. Some parts are still being wired up, so if something doesn’t work yet, that’s expected. Thanks for your patience while we improve it.


**Let AI control your computer screen** - Create overlays, take screenshots, simulate mouse clicks, and interact with any desktop through your favorite AI assistant (Cherry AI, Claude Desktop, etc.).

> **📋 Looking for the Clipboard Bridge?** See [docs/CLIPBOARD_BRIDGE.md](docs/CLIPBOARD_BRIDGE.md) for the standalone Flatpak clipboard sync tool.

## What is this?

Overlay Companion MCP connects your AI assistant to a computer desktop (yours or a virtual machine) so the AI can:
- 🎯 **Create visual overlays** - Draw shapes, text, and annotations on the screen
- 📸 **Take screenshots** - Capture what's on screen for AI analysis
- 🖱️ **Control mouse & keyboard** - Click buttons, type text, automate tasks
- 📋 **Access clipboard** - Copy and paste between systems
- 🖥️ **Support multiple monitors** - Work across several screens at once

**Perfect for:** Testing GUIs, automating desktop tasks, AI-assisted workflows, remote system management

## How does it work?

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Your AI       │      │  Overlay         │      │  Target         │
│   Assistant     │─────▶│  Companion       │─────▶│  Desktop        │
│  (Cherry AI)    │      │  (This Project)  │      │  (VM or Local)  │
└─────────────────┘      └──────────────────┘      └─────────────────┘
     "Click the              MCP Server                 Desktop with
      Save button"           translates to              overlays &
                            screen actions              automation
```

**Two computers involved:**
1. **Host** - Your main computer (Fedora Desktop) running the Overlay Companion containers
2. **Target** - The desktop you want to control (can be a VM, or the same computer)

**What is KasmVNC?** A modern, web-based remote desktop system that works in your browser (no VNC client needed). Think of it like Chrome Remote Desktop, but open-source and designed for multi-monitor setups.

## Quick Start (3 Steps)

### Step 1: Install on Your Main Computer (Host)

Run this on your **Fedora Desktop** (the computer you're sitting at):

```bash
# Recommended: Compose-based install (no remote scripts)
# 1) Copy the compose file and .env template
cp infra/kasmvnc-compose.yml ./docker-compose.yml
cp infra/.env.example ./.env

# 2) Edit .env with your port preferences and settings
#   CONTAINER_PORT=8080
#   WEB_PORT=8082
#   MCP_PORT=3001
#   KASMVNC_PORT=6080
#   KASMVNC_ADMIN_PORT=3000

# 3) Start the stack
podman-compose up -d

# Optional: use Docker Compose instead
# docker compose up -d
```

If you still prefer the one-line installer, use at your own discretion:

```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/host-setup-kasmvnc.sh | bash
```

**What this installs:**
- Web interface for managing connections (accessible at `http://localhost:8080`)
- MCP server for AI integration (connects to Cherry AI, Claude, etc.)
- KasmVNC client (for connecting to remote desktops)
- All running in containers (no mess on your system)

**Default port:** 8080 (script will auto-detect conflicts and offer alternatives)

<details>
<summary>🔧 Advanced: Custom Port Installation (click to expand)</summary>

```bash
# Download and run with custom port
wget https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/host-setup.sh
chmod +x host-setup.sh
./host-setup.sh 8081

# Or use environment variable
OVERLAY_COMPANION_PORT=8081 ./host-setup.sh
```

If port 8080 is in use, the script will automatically detect this and offer alternatives.
</details>

### Step 2: Install on Target Desktop (Optional)

**Do you need this?**
- ✅ **YES** - If you want to control a VM or remote computer
- ❌ **NO** - If you want to control your local desktop (same computer as Step 1)

**If YES:** Run this on your **VM or remote computer** (the desktop you want to control):

```bash
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/vm-setup-kasmvnc.sh | bash
```

**What this installs:**
- KasmVNC server (web-based remote desktop, runs on port 6901)
- Desktop environment (Fluxbox - lightweight window manager)
- Basic apps (Firefox, terminal)
- Auto-starts on boot

**After installation:** The script will show you the connection URL (e.g., `http://192.168.1.100:6901`)

### Step 3: Connect Everything Together

**Open your web browser** on your main computer:

```
http://localhost:8080
```

You'll see the Overlay Companion web interface with three options:

1. **Quick Connect** - Connect to your VM (if you did Step 2)
   - Click "New Connection"
   - Enter VM IP address (shown after Step 2 installation)
   - Port: `6901` (default for KasmVNC)
   - Click "Test Connection" then "Save"

2. **Configure AI Assistant** - Connect Cherry AI or Claude Desktop
   - Copy the MCP Server URL: `http://localhost:3000`
   - In Cherry AI: Settings → MCP Servers → Add Server
   - Paste the URL and click "Connect"

3. **Test It** - Ask your AI to interact with the desktop
   - "Take a screenshot"
   - "Create a red circle overlay at position 500, 300"
   - "Click the Firefox icon"

## What Can You Do With It?

### Example AI Commands

Once connected, ask your AI assistant to:

**Visual Overlays:**
```
"Draw a red circle at coordinates 500, 300"
"Show a text overlay saying 'Click here' at the top left"
"Highlight the Save button with a yellow box"
```

**Screen Capture:**
```
"Take a screenshot of the current desktop"
"Capture the screen and tell me what you see"
"Show me what's on monitor 2"
```

**Mouse & Keyboard:**
```
"Click the Firefox icon"
"Type 'Hello World' into the text field"
"Press Enter"
"Right-click at position 800, 400"
```

**Clipboard:**
```
"Copy this text to the clipboard: [text]"
"What's currently in the clipboard?"
"Paste the clipboard contents"
```

### Web Interface

Access the management interface at `http://localhost:8080`:

- **Home** - System status, quick connect
- **Connections** - Manage VM connections (add/edit/delete)
- **Settings** - Configure MCP server, clipboard bridge, ports

## Troubleshooting

### Can't access http://localhost:8080

**Check if containers are running:**
```bash
podman ps
```

You should see 4 containers:
- `overlay-companion-mcp` (MCP server)
- `overlay-companion-web` (Web interface)
- `overlay-companion-kasmvnc` (KasmVNC client)
- `overlay-companion-proxy` (Caddy proxy)

**If containers aren't running:**
```bash
cd ~/.config/overlay-companion-mcp
podman-compose up -d
```

### Can't connect to VM

**Check VM IP address:**
```bash
# On the VM, run:
hostname -I
```

**Test connectivity from host:**
```bash
# Replace VM_IP with your VM's IP
curl http://VM_IP:6901
```

**Check KasmVNC is running on VM:**
```bash
# On the VM:
systemctl status kasmvnc
```

### AI assistant can't connect to MCP server

**Verify MCP server is running:**
```bash
curl http://localhost:3000/health
```

**Check Cherry AI configuration:**
- MCP Server URL should be: `http://localhost:3000`
- NOT `http://localhost:8080` (that's the web interface)

### Overlays not appearing

**Check you're connected to the VM:**
- Open `http://localhost:8080` in your browser
- You should see the VM desktop
- If not, click "Connect" and select your VM

**Verify AI is using the correct MCP server:**
- Ask AI: "What MCP servers are you connected to?"
- Should show "Overlay Companion MCP"

## Advanced Configuration

<details>
<summary>📋 Clipboard Bridge Setup (Optional)</summary>

Enable clipboard sync between your computer and the VM.

**Install on VM:**
```bash
./scripts/vm-setup/install-clipboard-bridge.sh
```

**Configure in web interface:**
1. Go to `http://localhost:8080`
2. Click "Settings" → "Clipboard"
3. Enable clipboard bridge
4. Enter VM IP and port (default: 8765)
5. Click "Test Connection"

See [docs/CLIPBOARD_BRIDGE.md](docs/CLIPBOARD_BRIDGE.md) for details.
</details>

<details>
<summary>🖥️ Multi-Monitor Setup</summary>

**In the web interface:**
1. Connect to your VM
2. Click "Add Display" button
3. A new browser window opens with the second monitor
4. Position windows as needed

**Ask AI to use specific monitors:**
```
"Take a screenshot of monitor 2"
"Create an overlay on the left monitor"
```

See [docs/MULTI_MONITOR_SETUP.md](docs/MULTI_MONITOR_SETUP.md) for details.
</details>

## Service Management

### Container Management (on HOST)
```bash
# Check container status
podman ps

# View logs
podman logs overlay-companion

# Restart services
cd ~/.config/overlay-companion-mcp
podman-compose restart

# Stop all services
podman-compose down
```

### VM Management
```bash
# Check RDP service in VM
sudo systemctl status xrdp

# Restart RDP service in VM
sudo systemctl restart xrdp

# Check VNC service in VM
sudo systemctl status vncserver@1
```

## Troubleshooting

### Container Issues
- Check logs: `podman logs [container-name]`
- Restart containers: `podman-compose restart`
- Rebuild containers: Re-run host-setup.sh

### VM Connection Issues
- Verify VM IP address
- Check firewall settings in VM
- Test RDP connection directly: `xfreerdp /v:[VM-IP] /u:[username]`

### Network Issues
- Ensure VM and host can communicate
- Check firewall rules on both systems
- Verify RDP port 3389 is open

## Development

### Building from Source
```bash
git clone https://github.com/RyansOpenSourceRice/overlay-companion-mcp.git
cd overlay-companion-mcp
./host-setup.sh
```

### Container Architecture
- **KasmVNC container**: Web-native VNC with multi-monitor support
- **MCP server container**: C# overlay functionality
- **Web interface container**: Management UI
- **Caddy proxy container**: Unified access point

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with both host containers and VM setup
5. Submit a pull request

## License

GPL-3.0-or-later - see LICENSE file for details.
