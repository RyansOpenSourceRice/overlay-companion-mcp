# AGENTS.md — Overlay Companion MCP

[![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

This is the validated AI-guidance subset of Ryan's coding preferences, scoped to
this project. It is reviewed through the HR / Lawyer / open-source peer / job
recruiter lenses.

## What this project is

Overlay Companion MCP is the **annotation layer**, not the VM. It does not run
the VM; it works on any VM reachable via browser tech. The AI is an
annotation/recommendation layer, **not** an autopilot. The absence of
click/type/keyboard MCP tools is **intentional** — it avoids duplicating an
input MCP and makes the product safe to deploy. `take_screenshot`,
`draw_overlay`, `set_clipboard`, `get_display_info` are the intended tool
surface.

## Architecture (locked)

- **Container + web viewer.** MCP server in a container (C#), web layer in a
  container (TypeScript), overlays rendered in a browser pane. No host overlay
  app, no flatpak, no GNOME Shell extension.
- **MCP server:** C# (`src/`), sole MCP implementation.
- **Clipboard bridge:** Rust (`apps/clipboard-bridge-rust/`), kept for
  AI-automated clipboard access. Do not write a C# clipboard bridge.
- **Web layer:** TypeScript (`infra/server` + `infra/web`).
- **Database:** libSQL (the engine behind Turso) is the only database. Used
  for users, sessions, connections, audit log, app configuration. Self-hosted
  as an embedded local file by default (`LIBSQL_URL=file:/data/companion.db`);
  point `LIBSQL_URL` at Turso Cloud (`libsql://<db>.turso.io` + `LIBSQL_AUTH_TOKEN`)
  or a self-hosted `libsql-server` (`http(s)://…`) with the same client.
- **Identity:** Better Auth (§7 default, mounted at `/api/auth`) backs users,
  sessions, passkeys/WebAuthn, TOTP, RBAC, and social OAuth. libSQL is the auth
  store (Kysely + `@libsql/client`). `ADMIN_EMAIL` grants the admin role.
  Sign-ups are admin-opt-in.

## Language placement

- **C#** where feasible (memory-safe, OO). The MCP server and the Playwright tests
  are C#.
- **TypeScript** for the web layer.
- **Rust** for the clipboard bridge only (kept as-is).
- **Python** is not for production systems; the existing `tests/ai-gui/`
  harness is legacy and being superseded by the C# Playwright web suite.

## Security (§7)

- OWASP Top 10 baseline. Rate-limit auth endpoints. Sign-ups locked by default.
- Delete-account is a feature. Passkeys/TOTP/backup codes via Better Auth plugins.
- Required scanners: Trivy (container), OpenGrep (SAST), Gitleaks (secrets via
  pre-commit). Scanners fix problems they find while working; they never hunt.
- Never commit API keys. The only secret gate is gitleaks in pre-commit.

## CI/CD (§9, §29)

- Pre-commit (incl. Gitleaks + Codespell) is the gate; CI/CD runs
  `pre-commit run --all-files`.
- OpenGrep is the SAST job. Trivy scans containers. Playwright (FireFox) tests run in CI.
- Renovate is on. CalVer (`YYYY.MM.DD.N`).

## GUI-first config (§9)

Keep configuration out of CLI/env where possible. Auth, connection, provider,
and Wazuh settings live in the Settings UI (backed by libSQL `app_config`).
Env vars are bootstrap defaults only. The GUI must be intelligible to both a
human and an AI agent.

## Wazuh / SIEM (§8)

Wazuh is an external compose the admin runs. This app ships log shipping
(Filebeat config) + Sigma-style rules. Admin-enabled, no paywall. See
`docs/WAZUH_INTEGRATION.md`.

## AI contribution rules (§28)

- Do not imply AI personhood in shipped text. Present as a tool.
- Include the AI disclosure note and a `Co-authored-by:` trailer naming the
  agent tool actually used (e.g. `opencode`, `openhands`) on PRs. Naming is
  vendor-agnostic: use the tool that produced the change, not a fixed name.
- First name only ("Ryan") in committed artifacts.

---

*Authored by an AI agent on behalf of Ryan. This is a validated subset of
Ryan's preferences; the binding decisions are Ryan's.*

## Project ontology (§36)

The project's machine-readable knowledge graph lives at
`docs/ontology/project.ontology.ttl`. It archives decisions, quality rules,
open problems, components, MCP tools, protocols, milestones, risks, and
agent-session handoff notes so agents can communicate across sessions that
lack memory.

- **Read it** at the start of any session on this repo. It is the single
  source of truth for decisions and open problems.
- **Update it** whenever you make a decision, close or open a problem, add a
  component/tool, or finish a session worth handing off. Add a `Session`
  entry with a summary and open questions.
- **Format**: Turtle, sorted deterministically. The pre-commit hook
  (`ontology-validate-sort`) re-serializes it with rdflib and fails if the
  committed form differs. Regenerate from `docs/ontology/generate.py` when
  adding schema, or hand-edit instance triples in sorted order.
- **SPARQL**: when a Fuseki dataset is configured for this project, query it
  via the Jena MCP server; the file remains the canonical committed form.

