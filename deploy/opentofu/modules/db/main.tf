# OpenTofu module: Postgres for Guacamole (mock)

terraform {
  required_version = ">= 1.6.0"
  required_providers { local = { source = "hashicorp/local" } }
}

variable "host_port" { type = number default = 5432 }
variable "user" { type = string default = "guac" }
variable "password" { type = string }
variable "db" { type = string default = "guacamole" }

resource "local_file" "compose" {
  filename = "${path.module}/generated/db-compose.yml"
  content  = <<YAML
version: '3.8'
services:
  db:
    image: docker.io/library/postgres:16-alpine
    network_mode: host
    environment:
      - POSTGRES_USER=${var.user}
      - POSTGRES_PASSWORD=${var.password}
      - POSTGRES_DB=${var.db}
    ports:
      - "${var.host_port}:5432"
YAML
}

output "compose_path" { value = local_file.compose.filename }
