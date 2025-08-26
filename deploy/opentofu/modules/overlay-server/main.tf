# OpenTofu module: overlay-server
# Purpose: runs the ASP.NET Core MCP overlay server and static viewer via Podman

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    local = { source = "hashicorp/local" }
    random = { source = "hashicorp/random" }
  }
}

variable "image" { type = string }
variable "name"  { type = string  default = "overlay-server" }
variable "host_port" { type = number default = 3000 }
variable "env" {
  type = map(string)
  default = {}
}

# This is a mockup using local_file to emit a podman-compose file. In real infra
# this module would apply via a podman provider or a remote runner.

resource "local_file" "podman_compose" {
  filename = "${path.module}/generated/${var.name}-compose.yml"
  content  = <<YAML
version: "3.8"
services:
  server:
    image: ${var.image}
    container_name: ${var.name}
    network_mode: host
    environment:
$(join("\n", [for k,v in var.env : "      - ${k}=${v}"]))
    command: ["/app/OverlayCompanion", "--http-port", "${var.host_port}"]
YAML
}

output "compose_path" { value = local_file.podman_compose.filename }
