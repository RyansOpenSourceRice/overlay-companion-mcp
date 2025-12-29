[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io) [![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

Control MCP (separate service)

This service provides input/window/process control tools:
- click_at
- type_text
- send_hotkey (future)
- move_window / resize_window / focus_window (future)

This is intentionally separate from the Overlay MCP for safety and least privilege.

Auth: In production, run behind the reverse proxy with OIDC-enabled and require an admin role (e.g., overlay:controller).
