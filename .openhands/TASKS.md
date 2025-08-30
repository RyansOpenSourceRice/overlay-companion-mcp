# Task List

1. 🔄 Assess impact of GitHub username change and list required fixes
Scanned repo for old vs new owner strings; will report findings and wait for confirmation before mass-replacing
2. 🔄 Remove 'guacamole' references from README.md

3. 🔄 Add Flatpak packaging with minimal GUI for configuration and enable clipboard copy/paste
Implement optional GTK mini window in clipboard-bridge; adjust manifest to GNOME Platform
4. 🔄 Create GitHub Action to build Flatpak and publish on release
Add workflow to build bundle and upload on release publish
5. 🔄 Add appropriate timeout-minutes to all GitHub Actions workflows
Add job-level timeouts to workflows missing them

