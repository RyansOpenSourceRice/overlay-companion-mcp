output "container_name" {
  description = "Name of the management container"
  value       = var.container_name
}

output "container_id" {
  description = "ID of the management container (placeholder)"
  value       = "${var.container_name}-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"
}

output "container_image" {
  description = "Container image name"
  value       = "${var.project_name}-management:latest"
}

output "config_dir" {
  description = "Configuration directory path"
  value       = "${var.user_home}/.config/${var.project_name}"
}

output "data_dir" {
  description = "Data directory path"
  value       = "${var.user_home}/.local/share/${var.project_name}"
}

output "service_url" {
  description = "Service URL"
  value       = "http://${var.bind_address}:${var.container_port}"
}
