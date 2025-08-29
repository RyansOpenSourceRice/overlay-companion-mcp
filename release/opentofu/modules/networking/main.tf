terraform {
  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.4"
    }
  }
}

locals {
  # Network configuration based on exposure mode
  firewall_zone = var.expose_to_lan ? "public" : "internal"
  service_name  = "${var.project_name}-web"
}

# Configure firewall rules
resource "null_resource" "configure_firewall" {
  provisioner "local-exec" {
    command = <<-EOT
      echo "Configuring firewall for ${var.network_mode} mode..."

      # Add service definition for our application
      sudo firewall-cmd --permanent --new-service="${local.service_name}" || true
      sudo firewall-cmd --permanent --service="${local.service_name}" --set-short="Overlay Companion MCP"
      sudo firewall-cmd --permanent --service="${local.service_name}" --set-description="AI-assisted screen interaction web interface"
      sudo firewall-cmd --permanent --service="${local.service_name}" --add-port="${var.container_port}/tcp"

      if [ "${var.expose_to_lan}" = "true" ]; then
        echo "🔓 Enabling LAN access (security risk)"
        # Allow access from LAN
        sudo firewall-cmd --permanent --zone=public --add-service="${local.service_name}"
        sudo firewall-cmd --permanent --zone=public --add-service=libvirt
      else
        echo "🔒 Configuring host-only access (secure)"
        # Only allow local access
        sudo firewall-cmd --permanent --zone=internal --add-service="${local.service_name}"
        sudo firewall-cmd --permanent --zone=internal --add-service=libvirt
      fi

      # Reload firewall
      sudo firewall-cmd --reload

      echo "✅ Firewall configured for ${var.network_mode} mode"
    EOT
  }

  provisioner "local-exec" {
    when = destroy
    command = <<-EOT
      echo "Cleaning up firewall rules..."
      sudo firewall-cmd --permanent --zone=public --remove-service="${var.project_name}-management" || true
      sudo firewall-cmd --permanent --zone=internal --remove-service="${var.project_name}-management" || true
      sudo firewall-cmd --permanent --delete-service="${var.project_name}-management" || true
      sudo firewall-cmd --reload || true
    EOT
  }

  triggers = {
    network_mode    = var.network_mode
    expose_to_lan   = var.expose_to_lan
    container_port  = var.container_port
    project_name    = var.project_name
  }
}

# Ensure libvirt network is configured
resource "null_resource" "configure_libvirt_network" {
  provisioner "local-exec" {
    command = <<-EOT
      echo "Configuring libvirt networking..."

      # Ensure default network exists and is active
      if ! virsh net-list --all | grep -q "default"; then
        echo "Creating default libvirt network..."
        virsh net-define /usr/share/libvirt/networks/default.xml
      fi

      # Start and autostart the network
      virsh net-start default || true
      virsh net-autostart default || true

      # Check network status
      virsh net-list --all

      echo "✅ Libvirt networking configured"
    EOT
  }

  triggers = {
    network_mode = var.network_mode
  }
}

# Create network monitoring script
resource "local_file" "network_monitor" {
  filename = "/tmp/${var.project_name}-network-monitor.sh"

  content = <<-EOT
#!/bin/bash
# Network monitoring script for ${var.project_name}

PROJECT_NAME="${var.project_name}"
CONTAINER_PORT="${var.container_port}"
HOST_IP="${var.host_ip}"
EXPOSE_TO_LAN="${var.expose_to_lan}"

echo "=== Network Status for $PROJECT_NAME ==="
echo "Host IP: $HOST_IP"
echo "Container Port: $CONTAINER_PORT"
echo "LAN Exposure: $EXPOSE_TO_LAN"
echo

# Check if management service is accessible
echo "=== Service Accessibility ==="
if curl -fsSL --connect-timeout 5 "http://$HOST_IP:$CONTAINER_PORT/health" >/dev/null 2>&1; then
  echo "✅ Management service is accessible at http://$HOST_IP:$CONTAINER_PORT"
else
  echo "❌ Management service is not accessible"
fi

# Check firewall status
echo
echo "=== Firewall Status ==="
if firewall-cmd --list-services | grep -q "${var.project_name}-web"; then
  echo "✅ Firewall rules configured"
else
  echo "❌ Firewall rules not found"
fi

# Check libvirt network
echo
echo "=== Libvirt Network Status ==="
virsh net-list --all | grep default

# Check VM connectivity (if VM is running)
echo
echo "=== VM Status ==="
if virsh list --state-running --name | grep -q "${var.project_name}-vm"; then
  VM_IP=$(virsh domifaddr "${var.project_name}-vm" | awk '/ipv4/ {print $4}' | cut -d'/' -f1)
  if [ -n "$VM_IP" ]; then
    echo "✅ VM is running with IP: $VM_IP"
  else
    echo "⚠️  VM is running but IP not detected yet"
  fi
else
  echo "❌ VM is not running"
fi

echo
echo "=== Network Interfaces ==="
ip addr show | grep -E "inet.*scope global"

if [ "$EXPOSE_TO_LAN" = "true" ]; then
  echo
  echo "🔓 WARNING: Service is exposed to LAN"
  echo "   Other devices on your network can access: http://$HOST_IP:$CONTAINER_PORT"
  echo "   Only use this on trusted networks"
fi
EOT

  file_permission = "0755"
}

# Run network validation
resource "null_resource" "validate_network" {
  depends_on = [
    null_resource.configure_firewall,
    null_resource.configure_libvirt_network,
    local_file.network_monitor
  ]

  provisioner "local-exec" {
    command = <<-EOT
      echo "Validating network configuration..."

      # Run network monitor script
      bash "${local_file.network_monitor.filename}"

      # Test port accessibility
      if [ "${var.expose_to_lan}" = "true" ]; then
        echo
        echo "Testing LAN accessibility..."
        if ss -tlnp | grep -q ":${var.container_port}"; then
          echo "✅ Port ${var.container_port} is listening"
        else
          echo "⚠️  Port ${var.container_port} not yet listening (services may still be starting)"
        fi
      fi

      echo "✅ Network validation complete"
    EOT
  }

  triggers = {
    container_id = var.container_id
    vm_id        = var.vm_id
    network_mode = var.network_mode
  }
}
