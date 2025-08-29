variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "container_name" {
  description = "Name of the management container"
  type        = string
}

variable "container_port" {
  description = "Port for the management container"
  type        = number
}

variable "bind_address" {
  description = "Address to bind the container port"
  type        = string
}

variable "user_home" {
  description = "User home directory"
  type        = string
}

variable "user_name" {
  description = "Username"
  type        = string
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}
