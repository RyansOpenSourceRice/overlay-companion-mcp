# OpenTofu module: reverse-proxy (Caddy)

terraform {
  required_version = ">= 1.6.0"
  required_providers { local = { source = "hashicorp/local" } }
}

variable "domain" { type = string }
variable "overlay_host" { type = string }
variable "overlay_port" { type = number default = 3000 }
variable "guacamole_host" { type = string }
variable "guacamole_port" { type = number default = 8080 }

resource "local_file" "caddyfile" {
  filename = "${path.module}/generated/Caddyfile"
  content  = <<CADDY
{
  email admin@example.com
}

${var.domain} {
  reverse_proxy /mcp ${var.overlay_host}:${var.overlay_port}
  reverse_proxy /ws/overlays ${var.overlay_host}:${var.overlay_port}
  reverse_proxy / ${var.overlay_host}:${var.overlay_port}
}

guac.${var.domain} {
  reverse_proxy ${var.guacamole_host}:${var.guacamole_port}
}
CADDY
}

output "caddyfile_path" { value = local_file.caddyfile.filename }
