Fedora VM (xrdp) provisioning guide

Goal: Create a Fedora Workstation/Silverblue VM with RDP (xrdp) for Apache Guacamole.

Prereqs
- Host with KVM/libvirt (virt-manager/virsh) or any hypervisor
- Network: VM reachable from Podman host running Guacamole

Steps (Workstation example)

1. Create VM
   - 2 vCPU, 4–8 GB RAM, 40+ GB disk
   - Enable 3D acceleration if supported
   - Attach Fedora Workstation ISO, install normally

2. Install xrdp
   ```bash
   sudo dnf install -y xrdp
   sudo systemctl enable --now xrdp
   sudo systemctl status xrdp
   ```

3. SELinux and firewalld
   ```bash
   # Allow RDP (3389/tcp)
   sudo firewall-cmd --add-port=3389/tcp --permanent
   sudo firewall-cmd --reload
   ```

4. Desktop session
   ```bash
   # Use Xorg session for stability with Guacamole/FreeRDP
   # On the login screen, pick the gear icon and choose "GNOME on Xorg"
   # Optionally enforce Xorg default:
   sudo sh -c 'echo Xorg > /etc/X11/default-display-manager || true'
   ```

5. User setup
   ```bash
   # Create user or ensure you have password auth enabled
   sudo passwd youruser
   # If using Fedora Silverblue, create unlocked admin and allow password login
   ```

6. Test from host
   ```bash
   # From your host, verify RDP
   xfreerdp /u:youruser /p:yourpass /v:VM_IP:3389 /gfx +auto-reconnect /sound:sys:alsa /microphone:sys:alsa
   ```

7. Resolution
   - For a combined desktop (e.g., 3840x1080), set display settings inside the VM
   - Guacamole will stream that single, wide desktop. Multi-monitor via RDP is advanced and can be deferred.

8. Guacamole connection
   - In the Guacamole web UI (http://localhost:8081), add a new connection:
     Protocol: RDP
     Hostname: VM_IP
     Username/Password: your credentials
     Security mode: Any (try NLA first)
     Ignore server certificate: Yes (if self-signed)
     Enable audio/clipboard as needed

Notes
- Wayland sessions may exhibit issues; prefer Xorg initially
- Ensure the VM IP is reachable from the container network (podman network inspect)
- If using SSH tunnels or VPN, adjust Guacamole connection host accordingly
