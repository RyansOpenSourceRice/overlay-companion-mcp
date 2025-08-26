terraform {
  required_providers {
    libvirt = {
      source  = "dmacvicar/libvirt"
      version = "~> 0.7"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.4"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}

locals {
  vm_disk_path = "${var.user_home}/.local/share/libvirt/images/${var.vm_name}.qcow2"
  cloud_init_iso_path = "${var.user_home}/.local/share/libvirt/images/${var.vm_name}-cloud-init.iso"
}

# Create cloud-init configuration
resource "local_file" "cloud_init_user_data" {
  filename = "${var.user_home}/.cache/${var.project_name}/cloud-init-user-data.yml"
  
  content = <<-EOT
#cloud-config
hostname: ${var.vm_name}
fqdn: ${var.vm_name}.local

# Create user account
users:
  - name: fedora
    groups: wheel,libvirt
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys: []
    lock_passwd: false
    passwd: $6$rounds=4096$saltsalt$L9.LKkHxBuXyWt8vr7/4.Ik8DYudVJ0LhqOKLNvQjJjQQfKjbQKKjQQfKjbQKKjQQfKjbQKKjQQfKjbQKKjQQfKjbQ

# Install packages
packages:
  - xrdp
  - tigervnc-server
  - firefox
  - gnome-terminal
  - gnome-tweaks
  - vim
  - curl
  - wget

# Configure services
runcmd:
  # Enable and start xrdp
  - systemctl enable xrdp
  - systemctl start xrdp
  
  # Configure xrdp for Wayland/X11 compatibility
  - echo "exec gnome-session" > /home/fedora/.xsession
  - chmod +x /home/fedora/.xsession
  - chown fedora:fedora /home/fedora/.xsession
  
  # Configure firewall for RDP
  - firewall-cmd --permanent --add-port=3389/tcp
  - firewall-cmd --reload
  
  # Set up desktop environment
  - systemctl set-default graphical.target
  
  # Configure automatic login for desktop session
  - mkdir -p /etc/gdm
  - |
    cat > /etc/gdm/custom.conf << 'EOF'
    [daemon]
    AutomaticLoginEnable=true
    AutomaticLogin=fedora
    
    [security]
    
    [xdmcp]
    
    [chooser]
    
    [debug]
    EOF
  
  # Ensure Wayland is available but X11 fallback works
  - |
    cat > /home/fedora/.profile << 'EOF'
    # Prefer Wayland but allow X11 fallback for RDP
    export XDG_SESSION_TYPE=wayland
    export GDK_BACKEND=wayland
    export QT_QPA_PLATFORM=wayland
    export MOZ_ENABLE_WAYLAND=1
    EOF
  - chown fedora:fedora /home/fedora/.profile

# Final setup
final_message: |
  Fedora Silverblue VM setup complete!
  - XRDP enabled on port 3389
  - User: fedora (password: fedora)
  - Desktop: GNOME with Wayland/X11 support
  - Remote access ready for Guacamole
EOT
  
  file_permission = "0644"
}

resource "local_file" "cloud_init_meta_data" {
  filename = "${var.user_home}/.cache/${var.project_name}/cloud-init-meta-data.yml"
  
  content = <<-EOT
instance-id: ${var.vm_name}
local-hostname: ${var.vm_name}
EOT
  
  file_permission = "0644"
}

# Create cloud-init ISO
resource "null_resource" "create_cloud_init_iso" {
  depends_on = [
    local_file.cloud_init_user_data,
    local_file.cloud_init_meta_data
  ]
  
  provisioner "local-exec" {
    command = <<-EOT
      # Ensure libvirt images directory exists
      mkdir -p "$(dirname "${local.cloud_init_iso_path}")"
      
      # Create cloud-init ISO
      genisoimage -output "${local.cloud_init_iso_path}" \
        -volid cidata -joliet -rock \
        "${var.user_home}/.cache/${var.project_name}/cloud-init-user-data.yml" \
        "${var.user_home}/.cache/${var.project_name}/cloud-init-meta-data.yml"
      
      echo "✅ Cloud-init ISO created: ${local.cloud_init_iso_path}"
    EOT
  }
  
  triggers = {
    user_data_hash = local_file.cloud_init_user_data.content_md5
    meta_data_hash = local_file.cloud_init_meta_data.content_md5
  }
}

# Create VM disk from Fedora ISO
resource "null_resource" "create_vm_disk" {
  depends_on = [null_resource.create_cloud_init_iso]
  
  provisioner "local-exec" {
    command = <<-EOT
      # Ensure libvirt images directory exists
      mkdir -p "$(dirname "${local.vm_disk_path}")"
      
      # Create VM disk
      qemu-img create -f qcow2 "${local.vm_disk_path}" ${var.vm_disk_size}
      
      echo "✅ VM disk created: ${local.vm_disk_path}"
    EOT
  }
  
  provisioner "local-exec" {
    when = destroy
    command = <<-EOT
      echo "Removing VM disk: ${local.vm_disk_path}"
      rm -f "${local.vm_disk_path}"
    EOT
  }
  
  triggers = {
    vm_name = var.vm_name
    disk_size = var.vm_disk_size
  }
}

# Create libvirt domain (VM)
resource "libvirt_domain" "fedora_vm" {
  depends_on = [null_resource.create_vm_disk]
  
  name   = var.vm_name
  memory = var.vm_memory
  vcpu   = var.vm_cpus
  
  # Boot from Fedora ISO for installation
  boot_device {
    dev = ["cdrom", "hd"]
  }
  
  # VM disk
  disk {
    volume_id = libvirt_volume.vm_disk.id
  }
  
  # Fedora installation ISO
  disk {
    file = var.fedora_image_path
  }
  
  # Cloud-init ISO
  disk {
    file = local.cloud_init_iso_path
  }
  
  # Network interface
  network_interface {
    network_name   = "default"
    wait_for_lease = true
  }
  
  # Console access
  console {
    type        = "pty"
    target_port = "0"
    target_type = "serial"
  }
  
  # Graphics (for VNC/SPICE access)
  graphics {
    type        = "spice"
    listen_type = "address"
    address     = "127.0.0.1"
    autoport    = true
  }
  
  # VM metadata
  xml {
    xslt = file("${path.module}/vm-metadata.xsl")
  }
  
  # Lifecycle management
  autostart = true
  
  provisioner "local-exec" {
    command = <<-EOT
      echo "VM ${var.vm_name} created successfully"
      echo "Waiting for VM to boot and install..."
      
      # Wait for VM to be accessible
      for i in {1..60}; do
        if virsh domstate "${var.vm_name}" | grep -q "running"; then
          echo "✅ VM is running"
          break
        fi
        echo "Waiting for VM to start... ($i/60)"
        sleep 10
      done
      
      echo "✅ Fedora VM provisioned: ${var.vm_name}"
    EOT
  }
}

# Create VM disk volume
resource "libvirt_volume" "vm_disk" {
  depends_on = [null_resource.create_vm_disk]
  
  name   = "${var.vm_name}.qcow2"
  pool   = "default"
  source = local.vm_disk_path
  format = "qcow2"
}