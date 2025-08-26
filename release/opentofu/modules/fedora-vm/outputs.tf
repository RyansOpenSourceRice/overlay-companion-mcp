output "vm_name" {
  description = "Name of the VM"
  value       = libvirt_domain.fedora_vm.name
}

output "vm_id" {
  description = "ID of the VM"
  value       = libvirt_domain.fedora_vm.id
}

output "vm_status" {
  description = "Status of the VM"
  value       = "running"
}

output "vm_ip" {
  description = "IP address of the VM"
  value       = try(libvirt_domain.fedora_vm.network_interface[0].addresses[0], "pending")
}

output "vm_disk_path" {
  description = "Path to VM disk"
  value       = "${var.user_home}/.local/share/libvirt/images/${var.vm_name}.qcow2"
}

output "cloud_init_iso_path" {
  description = "Path to cloud-init ISO"
  value       = "${var.user_home}/.local/share/libvirt/images/${var.vm_name}-cloud-init.iso"
}