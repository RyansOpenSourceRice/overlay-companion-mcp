# Task List

1. ✅ Read all README and documentation files
Reviewed README.md, ROADMAP.md, SPECIFICATION.md, MCP_SPECIFICATION.md, docs/*.md. Identified X11 mentions and existing Wayland support (clipboard).
2. ✅ Search repository for 'X11' occurrences (code + markdown)
Found occurrences in README, roadmap, workflows, implementation guide, code (xdotool, xrandr), clipboard tools, tests.
3. ✅ Replace X11 with Wayland in Markdown files
Updated README system requirements, workflow AppImage readme, implementation guide wording.
4. 🔄 Replace X11 with Wayland in code where applicable
Wayland-first implementations: screen capture (grim/swaymsg/hyprctl), clipboard (wl-copy/wl-paste first), cursor position (Wayland-first shim). Need to review input simulation click/type (xdotool) for Wayland alternatives.
5. 🔄 Assess Wayland alternatives to X11 functionality
Will document libraries/tools and C# binding strategies.
6. 🔄 Assess clipboard integration via MCP (user->agent and agent->user)
Will verify tool behavior and describe MCP path.
7. ⏳ Commit changes to repo with appropriate message


