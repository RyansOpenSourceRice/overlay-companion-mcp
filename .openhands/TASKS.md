# Task List

1. ✅ Assess impact of GitHub username change and list required fixes
Replaced all 26 occurrences of old owner RyansOpenSauceRice with new owner RyansOpenSourceRice across docs, scripts, workflows, and code. No occurrences remain.
2. ✅ Remove 'guacamole' references from README.md
Removed legacy Guacamole option, sections, and mentions. README now KasmVNC-only with clean sections. Purged leftover legacy lists.
3. 🔄 Add Flatpak packaging with minimal GUI for configuration and enable clipboard copy/paste
Clipboard bridge now starts server properly; added --show-gui for minimal GTK window. Need to confirm runtime supports Gtk3 or switch to Gtk4 and adjust manifest if needed.
4. ✅ Create GitHub Action to build Flatpak and publish on release
Added .github/workflows/flatpak-clipboard-bridge.yml with timeouts and automatic attachment on release publish.
5. ✅ Add appropriate timeout-minutes to all GitHub Actions workflows
Added timeouts to cleanup-containers, container-registry, release-package, and cold-storage workflow jobs. Other workflows already had sensible timeouts.

