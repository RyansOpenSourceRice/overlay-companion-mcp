output "management_url" {
  description = "URL to access the management web interface"
  value       = "http://${var.host_ip}:${var.container_port}"
}

output "container_name" {
  description = "Name of the management container"
  value       = module.management_container.container_name
}

output "container_id" {
  description = "ID of the management container"
  value       = module.management_container.container_id
}

output "vm_name" {
  description = "Name of the Fedora VM"
  value       = module.fedora_vm.vm_name
}

output "vm_id" {
  description = "ID of the Fedora VM"
  value       = module.fedora_vm.vm_id
}

output "vm_status" {
  description = "Status of the Fedora VM"
  value       = module.fedora_vm.vm_status
}

output "network_mode" {
  description = "Network mode (nat or bridge)"
  value       = var.expose_to_lan ? "bridge" : "nat"
}

output "session_config_path" {
  description = "Path to the session configuration file"
  value       = "${var.user_home}/.cache/${var.project_name}/session.json"
}

output "mcp_config" {
  description = "MCP configuration for Cherry Studio"
  value = {
    mcp_version = "1.0"
    session_id  = "${var.project_name}-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"
    mcp_ws_url  = "ws://${var.host_ip}:${var.container_port}/ws"
    mcp_http_url = "http://${var.host_ip}:${var.container_port}/mcp"
    auth = {
      type = "session"
      token = "dev-token-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"
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
  sensitive = false
}

output "installation_summary" {
  description = "Summary of the installation"
  value = {
    project_name     = var.project_name
    management_url   = "http://${var.host_ip}:${var.container_port}"
    vm_resources     = "${var.vm_cpus} CPUs, ${var.vm_memory}MB RAM"
    network_mode     = var.expose_to_lan ? "LAN exposed" : "Host-only"
    security_warning = var.expose_to_lan ? "⚠️  Service exposed to LAN - use only on trusted networks" : "🔒 Secure host-only access"
  }
}