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
  container_image = "${var.project_name}-management:latest"
  data_dir       = "${var.user_home}/.local/share/${var.project_name}"
  config_dir     = "${var.user_home}/.config/${var.project_name}"
  cache_dir      = "${var.user_home}/.cache/${var.project_name}"
}

# Ensure directories exist
resource "null_resource" "create_directories" {
  provisioner "local-exec" {
    command = <<-EOT
      mkdir -p "${local.data_dir}"
      mkdir -p "${local.config_dir}"
      mkdir -p "${local.cache_dir}"
      chmod 755 "${local.data_dir}" "${local.config_dir}" "${local.cache_dir}"
    EOT
  }
}

# Build management container image
resource "null_resource" "build_container_image" {
  depends_on = [null_resource.create_directories]
  
  provisioner "local-exec" {
    command = <<-EOT
      cd "${path.module}/../../../containers"
      
      echo "Building management container image..."
      podman build \
        -t "${local.container_image}" \
        -f Dockerfile.management \
        --build-arg PROJECT_NAME="${var.project_name}" \
        --build-arg USER_NAME="${var.user_name}" \
        .
      
      echo "✅ Management container image built: ${local.container_image}"
    EOT
  }
  
  triggers = {
    dockerfile_hash = filemd5("${path.module}/../../../containers/Dockerfile.management")
    project_name    = var.project_name
  }
}

# Build C# MCP server container image (if source exists)
resource "null_resource" "build_mcp_server_image" {
  depends_on = [null_resource.create_directories]
  
  provisioner "local-exec" {
    command = <<-EOT
      if [ -d "${path.module}/../../../../src" ]; then
        echo "Building C# MCP server container image..."
        cd "${path.module}/../../../.."
        podman build \
          -t "${var.project_name}-mcp-server:latest" \
          -f release/containers/Dockerfile.mcp-server \
          .
        echo "✅ C# MCP server container image built"
      else
        echo "⚠️  C# source code not found, skipping MCP server container build"
        echo "   The MCP server container will not be available"
      fi
    EOT
  }
  
  triggers = {
    dockerfile_hash = filemd5("${path.module}/../../../containers/Dockerfile.mcp-server")
    project_name    = var.project_name
  }
}

# Generate podman-compose configuration
resource "local_file" "podman_compose" {
  depends_on = [null_resource.build_container_image]
  
  filename = "${local.config_dir}/podman-compose.yml"
  
  content = yamlencode({
    version = "3.8"
    
    services = {
      postgres = {
        image = "docker.io/postgres:15-alpine"
        container_name = "${var.container_name}-postgres"
        environment = {
          POSTGRES_DB       = "guacamole"
          POSTGRES_USER     = "guacamole"
          POSTGRES_PASSWORD = "guacamole-dev-password"
        }
        volumes = [
          "${local.data_dir}/postgres:/var/lib/postgresql/data:Z"
        ]
        healthcheck = {
          test = ["CMD-SHELL", "pg_isready -U guacamole"]
          interval = "10s"
          timeout = "5s"
          retries = 5
        }
        restart = "unless-stopped"
        labels = var.labels
      }
      
      guacd = {
        image = "docker.io/guacamole/guacd:1.5.4"
        container_name = "${var.container_name}-guacd"
        restart = "unless-stopped"
        labels = var.labels
      }
      
      guacamole = {
        image = "docker.io/guacamole/guacamole:1.5.4"
        container_name = "${var.container_name}-guacamole"
        depends_on = {
          postgres = { condition = "service_healthy" }
          guacd = { condition = "service_started" }
        }
        environment = {
          GUACD_HOSTNAME     = "${var.container_name}-guacd"
          POSTGRES_HOSTNAME  = "${var.container_name}-postgres"
          POSTGRES_DATABASE  = "guacamole"
          POSTGRES_USER      = "guacamole"
          POSTGRES_PASSWORD  = "guacamole-dev-password"
        }
        volumes = [
          "${local.data_dir}/guacamole:/config:Z"
        ]
        restart = "unless-stopped"
        labels = var.labels
      }
      
      management = {
        image = local.container_image
        container_name = var.container_name
        depends_on = {
          guacamole = { condition = "service_started" }
        }
        ports = [
          "${var.bind_address}:${var.container_port}:8080"
        ]
        environment = {
          PROJECT_NAME      = var.project_name
          GUACAMOLE_URL     = "http://${var.container_name}-guacamole:8080"
          MCP_SERVER_URL    = "http://${var.container_name}-mcp-server:8081"
          MCP_WS_PORT       = "8081"
          BIND_ADDRESS      = "0.0.0.0"
        }
        volumes = [
          "${local.data_dir}/management:/app/data:Z",
          "${local.config_dir}:/app/config:Z"
        ]
        restart = "unless-stopped"
        labels = var.labels
      }
      
      mcp-server = {
        image = "${var.project_name}-mcp-server:latest"
        container_name = "${var.container_name}-mcp-server"
        ports = [
          "${var.bind_address}:8081:8081"
        ]
        environment = {
          ASPNETCORE_URLS = "http://0.0.0.0:8081"
          DISPLAY = ":99"
          XVFB_RES = "1920x1080x24"
        }
        volumes = [
          "${local.data_dir}/mcp-server:/app/data:Z",
          "/tmp/.X11-unix:/tmp/.X11-unix:rw"
        ]
        restart = "unless-stopped"
        labels = var.labels
        # Only include if the image exists
        profiles = ["mcp-server"]
      }
    }
    
    networks = {
      default = {
        name = "${var.project_name}-network"
      }
    }
    
    volumes = {
      postgres_data = null
      guacamole_data = null
      management_data = null
    }
  })
  
  file_permission = "0644"
}

# Initialize Guacamole database
resource "null_resource" "init_guacamole_db" {
  depends_on = [local_file.podman_compose]
  
  provisioner "local-exec" {
    command = <<-EOT
      cd "${local.config_dir}"
      
      echo "Starting PostgreSQL for database initialization..."
      podman-compose up -d postgres
      
      # Wait for PostgreSQL to be ready
      echo "Waiting for PostgreSQL to be ready..."
      for i in {1..30}; do
        if podman exec "${var.container_name}-postgres" pg_isready -U guacamole >/dev/null 2>&1; then
          echo "✅ PostgreSQL is ready"
          break
        fi
        echo "Waiting for PostgreSQL... ($i/30)"
        sleep 2
      done
      
      # Initialize Guacamole schema
      echo "Initializing Guacamole database schema..."
      podman run --rm --network "${var.project_name}-network" \
        docker.io/guacamole/guacamole:1.5.4 \
        /opt/guacamole/bin/initdb.sh --postgresql > /tmp/guacamole-schema.sql
      
      # Apply schema
      podman exec -i "${var.container_name}-postgres" \
        psql -U guacamole -d guacamole < /tmp/guacamole-schema.sql
      
      echo "✅ Guacamole database initialized"
      rm -f /tmp/guacamole-schema.sql
    EOT
  }
  
  triggers = {
    compose_file_hash = local_file.podman_compose.content_md5
  }
}

# Start all services
resource "null_resource" "start_services" {
  depends_on = [null_resource.init_guacamole_db]
  
  provisioner "local-exec" {
    command = <<-EOT
      cd "${local.config_dir}"
      
      echo "Starting core services..."
      podman-compose up -d postgres guacd guacamole management
      
      # Check if MCP server image exists and start it
      if podman image exists "${var.project_name}-mcp-server:latest"; then
        echo "Starting C# MCP server..."
        podman-compose --profile mcp-server up -d mcp-server
      else
        echo "⚠️  C# MCP server image not found, skipping"
      fi
      
      echo "Waiting for services to be ready..."
      sleep 15
      
      # Check service status
      echo "Service status:"
      podman-compose ps
      
      echo "✅ Management container services started"
    EOT
  }
  
  provisioner "local-exec" {
    when = destroy
    command = <<-EOT
      cd "${var.user_home}/.config/${var.project_name}"
      echo "Stopping management container services..."
      podman-compose down || true
    EOT
  }
  
  triggers = {
    compose_file_hash = local_file.podman_compose.content_md5
  }
}