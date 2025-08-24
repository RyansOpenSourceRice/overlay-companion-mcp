# OpenTofu module: guacamole stack (mock)

terraform {
  required_version = ">= 1.6.0"
  required_providers { local = { source = "hashicorp/local" } }
}

variable "db_host" { type = string }
variable "db_port" { type = number default = 5432 }
variable "db_name" { type = string default = "guacamole" }
variable "db_user" { type = string default = "guac" }
variable "db_password" { type = string }
variable "host_port" { type = number default = 8080 }

resource "local_file" "compose" {
  filename = "${path.module}/generated/guacamole-compose.yml"
  content  = <<YAML
version: '3.8'
services:
  guacd:
    image: guacamole/guacd:1.5.5
    network_mode: host
  guacamole:
    image: guacamole/guacamole:1.5.5
    network_mode: host
    environment:
      - POSTGRESQL_HOSTNAME=${var.db_host}
      - POSTGRESQL_DATABASE=${var.db_name}
      - POSTGRESQL_USER=${var.db_user}
      - POSTGRESQL_PASSWORD=${var.db_password}
      - GUACD_HOSTNAME=127.0.0.1
    ports:
      - "${var.host_port}:8080"
YAML
}

output "compose_path" { value = local_file.compose.filename }
