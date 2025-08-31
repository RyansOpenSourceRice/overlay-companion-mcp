# Task List

1. ✅ Audit repo for old GitHub username references and plan updates
Searched for RyansOpenSourceRice; only occurrences are expected (repo URLs). No change necessary unless username changed to something else.
2. ✅ Remove Guacamole references from README.md
README.md contains no 'Guacamole' strings; already KasmVNC-centric. 'Guacamole integration' comment in server.js header is internal; left as-is.
3. 🔄 Verify Flatpak workflow builds GUI and publishes on release
Workflow exists; added timeouts to steps. Confirms on: release types: [published] and attaches asset.
4. 🔄 Add timeouts to all GitHub Actions workflows
container-registry already updated earlier; added fine-grained timeouts to flatpak-clipboard-bridge; others already have timeouts.
5. ✅ Update overlay-web UI to use proxied /vnc
Changed infra/web/src/app.js to point to /vnc for KasmVNC protocol.
6. ⏳ Run pre-commit and fix findings in touched files
flake8 flags remain in tests and one unused import in clipboard-bridge.py; will only fix files we touched to keep scope minimal.

