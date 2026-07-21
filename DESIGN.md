# Design — Overlay Companion MCP

[![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

> This is the **why** document — design decisions, trade-offs, and rejected
> alternatives. For the **what** (behavior contracts), see
> `SPECIFICATION.md`. For the architecture analysis behind the
> container-vs-application decision, see
> `docs/CONTAINER_VS_APPLICATION.md`.

## Decision: container + web viewer (locked)

The project is the annotation layer, not the VM. Overlays render in a web
viewer (browser pane), not composited over the desktop. This works on **any**
VM reachable via browser tech, which is the portability requirement. See
`docs/CONTAINER_VS_APPLICATION.md` for the full analysis and the rejected
alternatives (wlroots host app, GNOME Shell extension, flatpak).

## Decision: AI is an annotation layer, not an autopilot

The absence of click/type/keyboard MCP tools is **intentional**. It avoids
duplicating an input MCP and makes the product safe to deploy. The "teach me
Blender materials" scenario means: AI takes a screenshot, analyzes it, draws
overlays, and **recommends** next steps. The human does the clicking and
typing. `take_screenshot` + `draw_overlay` + `set_clipboard` +
`get_display_info` are the intended tool surface. This safety-by-design is a
feature, not a gap.

## Decision: SurrealDB is the only database (§9)

SurrealDB backs users, sessions, connections, audit log, and app
configuration. It is a **decoupled** service in `infra/compose.yml` so it can
migrate to K3S independently. Both the TS management server (over HTTP `/sql`)
and the C# MCP server (via the SurrealDb.Net SDK) read/write it. Rely on
SurrealDB's built-in caching; no separate cache unless benchmarked. Services
fall back to file storage when the DB is unreachable so the app keeps working
during a DB outage.

## Decision: OIDC via Keycloak + local fallback (§7, §8)

Never roll our own identity. Keycloak is self-hostable and admin-configurable;
passkeys/TOTP/backup codes are provided by the Keycloak realm. Local auth
(hashed+salted scrypt passwords) is the fallback when OIDC is unavailable.
Sign-ups are locked by default (admin opt-in). Sessions are signed cookies
backed by SurrealDB rows (token hashes only).

## Decision: GUI-first config (§9)

Auth/connection/provider/Wazuh settings live in the web Settings UI, backed by
SurrealDB `app_config`. Env vars are bootstrap defaults only. The config model
is structured and validatable so both a human and an AI agent can configure it.

## Decision: Wazuh is external (§8)

Wazuh is an external compose the admin runs. The app ships log shipping
(Filebeat config) and Sigma-style rules; it does not build or bundle Wazuh. No
paywall — "enterprise tier" means features that help everyone.

## Decision: C# Appium tests (§9)

Appium is the preferred unified testing framework; C# Selenium/Appium is the
implementation language. The web suite lives in `tests/appium-csharp/` and runs
in CI. The Python `tests/ai-gui/` harness is legacy and being superseded.

---

*Authored by an AI agent (OpenHands) on behalf of Ryan. This records analysis
and design decisions; the binding decisions are Ryan's.*
