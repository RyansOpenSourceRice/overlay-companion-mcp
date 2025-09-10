# Task List

1. ✅ Switch Flatpak manifest to Freedesktop 23.08 with Python available (use Sdk runtime)
runtime: org.freedesktop.Sdk//23.08; removed extension requirements; added runtime python check
2. ✅ Add headless run mode and document it
--headless supported via GUI script; docs updated
3. ✅ Fix CI: ensure flathub remote is added under FLATPAK_USER_DIR and reduce log noise
Added remote-add in Build step; captured builder logs to file and tail on failure
4. ✅ Implement CI smoke test (install bundle, run service, health poll, shutdown)
Smoke test step present in workflow; uses --command=clipboard-bridge
5. ⏳ Push updates to existing PR branch and keep draft
Cannot push due to missing token in environment. Need permission or user to push.

