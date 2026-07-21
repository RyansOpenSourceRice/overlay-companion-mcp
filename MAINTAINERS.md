# Maintainers

[![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

## Scope

Overlay Companion MCP is the annotation layer for AI-assisted screen
interaction. It provides an MCP server (overlays, screenshots, clipboard,
display info, connection management) and a web viewer. It does **not** run the
VM; it works on any VM reachable via browser tech.

## Ownership

- **Maintainer:** Ryan (RyansOpenSourceRice)
- **AI assistance:** OpenHands agent, operating under Ryan's preferences and
  the project's `AGENTS.md`.

## What this project does not do

- It does not run the VM.
- It does not simulate input (no click/type/keyboard MCP tools) — this is
  intentional safety-by-design.
- It does not bundle or run Wazuh (the admin runs Wazuh externally; the app
  only ships logs to it).

## Becoming a co-maintainer

This is currently a single-maintainer project. If you would like to
co-maintain, open an issue describing your interest and the areas you'd like
to work on. Co-maintainers are expected to follow `AGENTS.md` and the
conventions in `docs/`.

## Contact

Open an issue on [GitHub](https://github.com/RyansOpenSourceRice/overlay-companion-mcp).

---

*Authored by an AI agent (OpenHands) on behalf of Ryan.*
