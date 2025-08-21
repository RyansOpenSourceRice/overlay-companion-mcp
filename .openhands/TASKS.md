# Task List

1. ✅ Explore repository and read all README/markdown docs
Reviewed README.md, MCP_SPECIFICATION.md, SPECIFICATION.md, ROADMAP.md, docs/*.md, tests docs
2. ✅ Audit code for X11-specific paths and confirm/implement Wayland-first with X11 fallback
Clipboard wl-clipboard; screen capture grim first; display info swaymsg/hyprctl; input ydotool/wtype added; X11 kept as fallback
3. ✅ Update Markdown docs to emphasize Wayland-first and reflect weston-headless tests
README system requirements updated; docs already Wayland-first
4. ✅ Update code comments/messages to reflect Wayland-first; avoid blind string replacements
Adjusted InputMonitorService to try ydotool first; tests scripts force GUI path and Wayland smoke via weston
5. ✅ Verify MCP clipboard tools exist and work on Wayland/X11; document usage
get_clipboard/set_clipboard implemented; Wayland via wl-clipboard with xclip fallback; UI checkbox controls access; ModeManager enforces policy
6. ✅ Summarize available Wayland libraries/tools replacing X11 equivalents
grim/slurp, wl-clipboard, wtype/ydotool, swaymsg/hyprctl, xdg-desktop-portal + PipeWire for screenshots/screencast, Tmds.DBus for C# portal access

