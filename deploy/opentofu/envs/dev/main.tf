# OpenTofu dev environment (mock) – wires modules together and emits artifacts

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    local  = { source = "hashicorp/local" }
    random = { source = "hashicorp/random" }
  }
}

provider "local" {}
provider "random" {}

resource "random_password" "db" {
  length  = 20
  special = false
}

module "db" {
  source   = "../../modules/db"
  password = random_password.db.result
}

module "guacamole" {
  source      = "../../modules/guacamole"
  db_host     = "127.0.0.1"
  db_password = random_password.db.result
}

module "overlay" {
  source    = "../../modules/overlay-server"
  image     = "ghcr.io/ryansopensaucerice/overlay-companion-mcp:latest"
  host_port = 3000
  env = {
    HEADLESS = "1"
  }
}

module "caddy" {
  source        = "../../modules/reverse-proxy"
  domain        = "overlay.local"
  overlay_host  = "127.0.0.1"
  overlay_port  = 3000
  guacamole_host = "127.0.0.1"
  guacamole_port = 8080
}

output "artifacts" {
  value = {
    db_compose       = module.db.compose_path
    guac_compose     = module.guacamole.compose_path
    overlay_compose  = module.overlay.compose_path
    caddyfile        = module.caddy.caddyfile_path
  }
}
