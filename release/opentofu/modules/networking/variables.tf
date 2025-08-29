variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "network_mode" {
  description = "Network mode (nat or bridge)"
  type        = string
}

variable "expose_to_lan" {
  description = "Whether to expose services to LAN"
  type        = bool
}

variable "container_port" {
  description = "Container port number"
  type        = number
}

variable "host_ip" {
  description = "Host IP address"
  type        = string
}

variable "container_id" {
  description = "Container ID for dependency tracking"
  type        = string
}

variable "vm_id" {
  description = "VM ID for dependency tracking"
  type        = string
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}
