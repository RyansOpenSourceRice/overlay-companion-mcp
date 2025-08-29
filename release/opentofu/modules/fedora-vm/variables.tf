variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "vm_name" {
  description = "Name of the VM"
  type        = string
}

variable "vm_memory" {
  description = "Memory allocation for VM in MB"
  type        = number
}

variable "vm_cpus" {
  description = "Number of CPU cores for VM"
  type        = number
}

variable "vm_disk_size" {
  description = "VM disk size in bytes"
  type        = number
}

variable "fedora_image_path" {
  description = "Path to Fedora Silverblue ISO"
  type        = string
}

variable "user_home" {
  description = "User home directory"
  type        = string
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}
