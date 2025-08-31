# Task List

1. ✅ Audit repo for old GitHub username references and plan updates
Scan complete; optional doc/script URL updates available if new username provided.
2. ✅ Remove Guacamole references from README.md
README contains no Guacamole references. Updated one internal comment in infra/server/server.js to say Remote Desktop via KasmVNC.
3. ⏳ Verify Flatpak workflow builds GUI and publishes on release
Workflow exists and runs on release; GUI present. Remaining concern: manifest likely lacks Python interpreter at runtime (GNOME Platform doesn’t ship python3). Need to bundle Python or switch to a base that provides it + add a smoke test.
4. ✅ Add timeouts to all GitHub Actions workflows
Confirmed across workflows; added granular timeouts to flatpak build.
5. ✅ Update overlay-web UI to use proxied /vnc
infra/web/src/app.js now targets /vnc for KasmVNC connections.
6. ⏳ Run pre-commit and fix findings in touched files
Pre-commit runs; fixed in Flatpak files, many flake8 issues remain in tests. Decide whether to fix or relax lint for tests.

