output "network_mode" {
  description = "Configured network mode"
  value       = var.network_mode
}

output "firewall_zone" {
  description = "Firewall zone used"
  value       = var.expose_to_lan ? "public" : "internal"
}

output "service_url" {
  description = "Service URL"
  value       = "http://${var.host_ip}:${var.container_port}"
}

output "network_monitor_script" {
  description = "Path to network monitoring script"
  value       = "/tmp/${var.project_name}-network-monitor.sh"
}

output "security_status" {
  description = "Security configuration status"
  value = {
    expose_to_lan = var.expose_to_lan
    warning = var.expose_to_lan ? "⚠️  Service exposed to LAN - use only on trusted networks" : "🔒 Secure host-only access"
  }
}
