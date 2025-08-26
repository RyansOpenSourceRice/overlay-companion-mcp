variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "overlay-companion-mcp"
}

variable "vm_memory" {
  description = "Memory allocation for VM in MB"
  type        = number
  default     = 4096
  
  validation {
    condition     = var.vm_memory >= 2048
    error_message = "VM memory must be at least 2048 MB (2GB)."
  }
}

variable "vm_cpus" {
  description = "Number of CPU cores for VM"
  type        = number
  default     = 2
  
  validation {
    condition     = var.vm_cpus >= 1 && var.vm_cpus <= 16
    error_message = "VM CPUs must be between 1 and 16."
  }
}

variable "container_port" {
  description = "Port for management container web interface"
  type        = number
  default     = 8080
  
  validation {
    condition     = var.container_port >= 1024 && var.container_port <= 65535
    error_message = "Container port must be between 1024 and 65535."
  }
}

variable "host_ip" {
  description = "Host IP address for service binding"
  type        = string
  default     = "127.0.0.1"
  
  validation {
    condition = can(regex("^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}$", var.host_ip))
    error_message = "Host IP must be a valid IPv4 address."
  }
}

variable "expose_to_lan" {
  description = "Whether to expose services to LAN (security risk)"
  type        = bool
  default     = false
}

variable "fedora_image_path" {
  description = "Path to Fedora Silverblue ISO image"
  type        = string
  
  validation {
    condition     = can(regex("\\.iso$", var.fedora_image_path))
    error_message = "Fedora image path must point to an ISO file."
  }
}

variable "user_home" {
  description = "User home directory path"
  type        = string
  
  validation {
    condition     = can(regex("^/", var.user_home))
    error_message = "User home must be an absolute path."
  }
}

variable "user_name" {
  description = "Username for configuration"
  type        = string
  
  validation {
    condition     = length(var.user_name) > 0
    error_message = "User name cannot be empty."
  }
}