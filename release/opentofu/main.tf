# ⚠️ DEPRECATED: Guacamole-based OpenTofu Infrastructure
# 
# This infrastructure configuration is DEPRECATED in favor of KasmVNC architecture.
# 
# ⚠️ WARNING: This setup provisions Guacamole-based infrastructure which is deprecated.
# Issues with this configuration:
# - Provisions PostgreSQL database (unnecessary complexity)
# - Sets up 6 containers instead of 4
# - Complex credential management
# - Lacks true multi-monitor support
# 
# RECOMMENDED: Create new KasmVNC-based infrastructure configuration

terraform {
  required_version = ">= 1.0"
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

# Configure libvirt provider
provider "libvirt" {
  uri = "qemu:///system"
}

# Local variables
locals {
  project_name = var.project_name
  timestamp    = formatdate("YYYY-MM-DD-hhmm", timestamp())

  # Network configuration
  network_mode = var.expose_to_lan ? "bridge" : "nat"
  bind_address = var.expose_to_lan ? "0.0.0.0" : "127.0.0.1"

  # VM configuration
  vm_name = "${local.project_name}-vm"
  vm_disk_size = 40 * 1024 * 1024 * 1024  # 40GB in bytes

  # Container configuration
  container_name = "${local.project_name}-management"

  # Common labels
  common_labels = {
    project     = local.project_name
    managed_by  = "opentofu"
    created_at  = local.timestamp
  }
}

# Management container module
module "management_container" {
  source = "./modules/management-container"

  project_name   = local.project_name
  container_name = local.container_name
  container_port = var.container_port
  bind_address   = local.bind_address
  user_home      = var.user_home
  user_name      = var.user_name

  labels = local.common_labels
}

# Fedora VM module
module "fedora_vm" {
  source = "./modules/fedora-vm"

  project_name       = local.project_name
  vm_name           = local.vm_name
  vm_memory         = var.vm_memory
  vm_cpus           = var.vm_cpus
  vm_disk_size      = local.vm_disk_size
  fedora_image_path = var.fedora_image_path
  user_home         = var.user_home

  labels = local.common_labels
}

# Networking module
module "networking" {
  source = "./modules/networking"

  project_name    = local.project_name
  network_mode    = local.network_mode
  expose_to_lan   = var.expose_to_lan
  container_port  = var.container_port
  host_ip         = var.host_ip

  # Dependencies
  container_id = module.management_container.container_id
  vm_id        = module.fedora_vm.vm_id

  labels = local.common_labels
}

# Wait for services to be ready
resource "null_resource" "wait_for_services" {
  depends_on = [
    module.management_container,
    module.fedora_vm,
    module.networking
  ]

  provisioner "local-exec" {
    command = <<-EOT
      echo "Waiting for services to start..."
      sleep 30

      # Check if management container is running
      if podman ps --format "{{.Names}}" | grep -q "${local.container_name}"; then
        echo "✅ Management container is running"
      else
        echo "⚠️  Management container not found"
      fi

      # Check if VM is running
      if virsh list --state-running --name | grep -q "${local.vm_name}"; then
        echo "✅ VM is running"
      else
        echo "⚠️  VM not running yet"
      fi
    EOT
  }

  triggers = {
    container_id = module.management_container.container_id
    vm_id        = module.fedora_vm.vm_id
  }
}

# Generate session configuration
resource "local_file" "session_config" {
  depends_on = [null_resource.wait_for_services]

  filename = "${var.user_home}/.cache/${local.project_name}/session.json"

  content = jsonencode({
    project_name    = local.project_name
    created_at      = local.timestamp
    management_url  = "http://${local.bind_address}:${var.container_port}"
    container_name  = local.container_name
    vm_name         = local.vm_name
    network_mode    = local.network_mode
    expose_to_lan   = var.expose_to_lan

    mcp_config = {
      mcp_version = "1.0"
      session_id  = "${local.project_name}-${local.timestamp}"
      mcp_ws_url  = "ws://${var.host_ip}:${var.container_port}/ws"
      mcp_http_url = "http://${var.host_ip}:${var.container_port}/mcp"
      auth = {
        type = "session"
        token = "dev-token-${local.timestamp}"
      }
      desktop = {
        target = "fedora-silverblue"
        viewport = {
          w = 1920
          h = 1080
          devicePixelRatio = 1.0
        }
      }
      notes = "Single-user dev package. Copy this JSON into Cherry Studio MCP slot."
    }
  })

  file_permission = "0600"

  provisioner "local-exec" {
    command = "mkdir -p $(dirname ${self.filename})"
  }
}
