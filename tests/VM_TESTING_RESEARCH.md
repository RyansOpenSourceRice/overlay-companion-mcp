# Research: Running VM in Docker Container for Testing Overlay Companion MCP

## Research Summary

I've researched multiple approaches for testing GUI applications in a headless Docker environment. Here are the findings:

---

## Option 1: QEMU in Docker (Full VM) ⭐ RECOMMENDED FOR FULL TESTING

### Solution: qemux/qemu
- **GitHub:** https://github.com/qemus/qemu
- **Docker Hub:** qemux/qemu

### Features
✅ **Full VM inside Docker** - Run complete operating systems  
✅ **Web-based viewer** - Control VM from browser (port 8006)  
✅ **KVM acceleration** - Near-native performance (if /dev/kvm available)  
✅ **Multiple disk formats** - .iso, .img, .qcow2, .vhd, .vhdx, .vdi, .vmdk, .raw  
✅ **Pre-built images** - Alpine, Ubuntu, Windows, etc.  

### Requirements
- `/dev/kvm` device access (for acceleration)
- `/dev/net/tun` device access (for networking)
- `NET_ADMIN` capability
- Nested virtualization enabled (if running in a VM)

### Docker Compose Example
```yaml
services:
  qemu:
    image: qemux/qemu
    container_name: qemu-test-vm
    environment:
      BOOT: "alpine"  # or "ubuntu", "windows", etc.
      RAM_SIZE: "4G"
      CPU_CORES: "2"
      DEBUG: "Y"
    devices:
      - /dev/kvm
      - /dev/net/tun
    cap_add:
      - NET_ADMIN
    ports:
      - 8006:8006  # Web console
      - 5900:5900  # VNC (if needed)
    volumes:
      - ./qemu-storage:/storage
    restart: unless-stopped
```

### Use Case for Overlay Companion MCP
1. **Run full Linux desktop** in the QEMU VM
2. **Install overlay-companion-mcp** inside the VM
3. **Test visual overlays** on the VM's desktop
4. **Access via web browser** at http://localhost:8006
5. **Verify mouse clicks, keyboard input, screenshots** visually

### Limitations
- **Requires /dev/kvm** - May not work in all Docker environments
- **Resource intensive** - Full VM overhead
- **Complex setup** - More moving parts

---

## Option 2: Xvfb + VNC (Lightweight) ⭐ RECOMMENDED FOR QUICK TESTING

### Solution: Headless X Server with VNC Access
- **Xvfb:** Virtual framebuffer X server
- **x11vnc:** VNC server for X11
- **Fluxbox/XFCE:** Lightweight desktop environment

### Features
✅ **Lightweight** - No full VM overhead  
✅ **Fast setup** - Can be installed in minutes  
✅ **VNC access** - View desktop from VNC client  
✅ **Web VNC option** - noVNC for browser access  
✅ **Works in Docker** - No special device requirements  

### Pre-built Docker Images
- **ConSol/docker-headless-vnc-container**
  - GitHub: https://github.com/ConSol/docker-headless-vnc-container
  - Images: `consol/rocky-xfce-vnc`, `consol/ubuntu-xfce-vnc`
  - VNC port: 5901
  - noVNC (web) port: 6901

### Docker Run Example
```bash
docker run -d \
  -p 5901:5901 \
  -p 6901:6901 \
  --name vnc-desktop \
  consol/ubuntu-xfce-vnc
```

Access:
- **VNC:** vnc://localhost:5901 (password: vncpassword)
- **Web:** http://localhost:6901 (password: vncpassword)

### Custom Dockerfile Example
```dockerfile
FROM ubuntu:22.04

# Install Xvfb, VNC, and desktop environment
RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    fluxbox \
    xterm \
    net-tools \
    && rm -rf /var/lib/apt/lists/*

# Set up VNC password
RUN mkdir ~/.vnc && x11vnc -storepasswd vncpass ~/.vnc/passwd

# Start script
COPY start-vnc.sh /start-vnc.sh
RUN chmod +x /start-vnc.sh

EXPOSE 5900

CMD ["/start-vnc.sh"]
```

**start-vnc.sh:**
```bash
#!/bin/bash
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 &
sleep 2
fluxbox &
x11vnc -display :99 -passwd vncpass -forever -shared -rfbport 5900
```

### Use Case for Overlay Companion MCP
1. **Run Xvfb + VNC** in Docker container
2. **Install .NET and overlay-companion-mcp** in the container
3. **Run MCP server** with DISPLAY=:99
4. **Connect via VNC** to see overlays visually
5. **Test all GUI features** (overlays, clicks, keyboard)

### Advantages
- **No /dev/kvm required** - Works in any Docker environment
- **Lightweight** - Much less overhead than full VM
- **Fast** - Quick to start and test
- **Simple** - Fewer dependencies

---

## Option 3: X11 Forwarding (Simplest, if host has display)

### Solution: Forward X11 from container to host

### Requirements
- Host must have X server running
- xhost permissions configured

### Docker Run Example
```bash
# On host
xhost +local:docker

# Run container
docker run -it \
  -e DISPLAY=$DISPLAY \
  -v /tmp/.X11-unix:/tmp/.X11-unix \
  --name overlay-test \
  ubuntu:22.04
```

### Use Case
- **Only works if host has display** (not headless)
- **Simplest approach** for local testing
- **No VNC needed** - GUI appears on host screen

### Limitations
- ❌ **Not suitable for headless servers**
- ❌ **Security concerns** with xhost +
- ❌ **Doesn't work in cloud/remote environments**

---

## Comparison Matrix

| Feature | QEMU in Docker | Xvfb + VNC | X11 Forwarding |
|---------|----------------|------------|----------------|
| **Full VM** | ✅ Yes | ❌ No | ❌ No |
| **Headless** | ✅ Yes | ✅ Yes | ❌ No |
| **Web Access** | ✅ Yes (8006) | ✅ Yes (noVNC) | ❌ No |
| **VNC Access** | ✅ Yes | ✅ Yes | ❌ No |
| **KVM Required** | ⚠️ Optional | ❌ No | ❌ No |
| **Resource Usage** | 🔴 High | 🟡 Medium | 🟢 Low |
| **Setup Complexity** | 🔴 Complex | 🟡 Medium | 🟢 Simple |
| **Speed** | 🟡 Medium | 🟢 Fast | 🟢 Fast |
| **Isolation** | ✅ Full VM | 🟡 Container | 🟡 Container |
| **Best For** | Production testing | Quick testing | Local dev |

---

## Recommendation for Overlay Companion MCP Testing

### For This Environment (Docker container, headless)

**Use Option 2: Xvfb + VNC** ⭐

**Reasons:**
1. ✅ **Works in current environment** - No /dev/kvm or special devices needed
2. ✅ **Fast setup** - Can be running in 5-10 minutes
3. ✅ **Sufficient for testing** - Can verify all GUI features
4. ✅ **Lightweight** - Won't overwhelm the container
5. ✅ **Web access** - Can view via browser (noVNC)

### Implementation Plan

#### Step 1: Install Xvfb + VNC in current container
```bash
sudo apt-get update
sudo apt-get install -y xvfb x11vnc fluxbox xterm novnc websockify
```

#### Step 2: Start virtual display
```bash
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 &
fluxbox &
x11vnc -display :99 -forever -shared -rfbport 5900 -passwd vncpass &
```

#### Step 3: Start noVNC for web access
```bash
websockify --web=/usr/share/novnc 6901 localhost:5900 &
```

#### Step 4: Run MCP server with GUI
```bash
cd /workspace/overlay-companion-mcp/src
DISPLAY=:99 dotnet run -c Release -- --http
```

#### Step 5: Test overlays visually
- Connect to VNC: vnc://localhost:5900 (password: vncpass)
- Or web: http://localhost:6901
- Run MCP tools and see overlays appear on screen

---

## Alternative: Use Pre-built VNC Container

If we want even faster setup, we can use a pre-built image:

```bash
# Pull and run pre-built VNC desktop
docker run -d \
  -p 5901:5901 \
  -p 6901:6901 \
  -v /workspace/overlay-companion-mcp:/workspace \
  --name vnc-test \
  consol/ubuntu-xfce-vnc

# Enter the container
docker exec -it vnc-test bash

# Inside container: Install .NET and build MCP server
# Then run tests
```

---

## Next Steps

**Choose your approach:**

### A. Quick Test (Xvfb + VNC in current container)
- Install Xvfb, x11vnc, fluxbox
- Start virtual display
- Run MCP server with DISPLAY=:99
- Connect via VNC to see overlays
- **Time: 10-15 minutes**

### B. Pre-built VNC Container
- Pull consol/ubuntu-xfce-vnc
- Mount workspace volume
- Install .NET inside container
- Build and run MCP server
- **Time: 15-20 minutes**

### C. Full VM (QEMU)
- Check if /dev/kvm is available
- Run qemux/qemu container
- Install Linux desktop in VM
- Install and test MCP server
- **Time: 30-60 minutes**

---

## Conclusion

For testing Overlay Companion MCP in this Docker environment, **Option 2 (Xvfb + VNC)** is the best choice:

✅ **Fast** - Can be set up in minutes  
✅ **Lightweight** - Won't overwhelm resources  
✅ **Sufficient** - Can test all GUI features  
✅ **Accessible** - VNC or web browser access  
✅ **No special requirements** - Works in any Docker environment  

**Ready to proceed?** I can set this up now and test the full visual overlay functionality.
