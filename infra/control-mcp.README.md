Control MCP (separate service)

This service provides input/window/process control tools:
- click_at
- type_text
- send_hotkey (future)
- move_window / resize_window / focus_window (future)

This is intentionally separate from the Overlay MCP for safety and least privilege.

Auth: In production, run behind the reverse proxy with OIDC-enabled and require an admin role (e.g., overlay:controller).
