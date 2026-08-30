# Multi-Agent Architecture — MCP + A2A (Planned, not yet executed)

> Status: DESIGN LOCKED 2026-08-30. Not implemented. This document is the
> execution plan for Phase 7+ (advocate agent + agent interop layer).

## Decision (one sentence)

Use **MCP + A2A as the standards** (official SDKs exist in C#, TypeScript, Go),
and keep the Phase 7 advocate **framework-free in TypeScript now**, with
**A2A (`a2a-js`)** as the interop layer the moment any agent needs to live
outside the Node server.

## Rationale (2026-08-30 research)

- **MCP** = agent-to-TOOLS. We already speak it (the C# MCP server + the
  Node chat loop's `/mcp` client + Phase 4 extension servers).
- **A2A** (a2aproject, Linux Foundation) = agent-to-AGENT. Official SDKs:
  `a2a-js` (TS), `a2a-dotnet` (C#), `a2a-go` (Go), plus Python/Java/Rust.
  Language-agnostic wire protocol (agent cards, messaging, tasks, streaming).
- No single *framework* spans C# + TS + Go. Framework survey (June–Aug 2026):

  | Framework | Languages | Multi-agent | MCP | A2A |
  |---|---|---|---|---|
  | Microsoft Agent Framework (GA 2026-04; Go preview 2026-07) | .NET, Python, Go | Group chat + graph | Native | Native |
  | Google ADK 2.0 | Python, TS, Java, Go | Hierarchical | Adapters | Native |
  | LangGraph | Python, TS | Graph | Adapters | No |
  | OpenAI / Claude Agent SDKs | Python, TS only | Handoffs | Yes | No |

- Conclusion: standards over frameworks. Frameworks are per-language
  implementation details; A2A makes them interchangeable.

## Locked product decisions (from Ryan, 2026-08-30)

1. **Two-agent system**: primary agent (task annotator) + advocate agent
   (simulated end user).
2. The advocate is **concealed**: never rendered in any UI. The user is only
   informed it exists and can disable it in Settings.
3. Advocate runs **always-on**: after every primary turn (accepted 2x model
   cost; disable when models improve).
4. Advocate is **read-only**: sees the screen (`see_screen`) and the overlay
   list; responds to the WRITER agent. It can never place markings.
5. The advocate is an **advocate for the user** — it helps when the primary
   agent messes up ("why are these red things here", "what do I enter here").
6. **AI controls marking removal**: when the user clicks a marked target, the
   system does NOT auto-delete; the primary agent is told about the click and
   decides to remove the marking and advance.

## Architecture

```
   [human] ── chat panel ──> PRIMARY AGENT (TS, in-process, framework-free)
                                 │  tools via MCP (existing /mcp client)
                                 │  ▲ next-turn context injection (concealed)
                                 ▼  │ one bounded continuation
   ADVOCATE AGENT (TS, in-process, framework-free, read-only MCP tools)
        │
        ├── default: in-process call (no HTTP, no framework)
        └── optional: A2A endpoint (a2a-js) — flip ONE setting to expose or
            consume any agent that lives outside the Node server
```

### File layout (`infra/server/src/agents/`)

- `types.ts` — `AgentEndpoint` contract (framework-free):
  `respond(input: AgentTurnInput): Promise<string>`; `AgentTurnInput` carries
  the message, a context snapshot (checklist line, primary's last turn incl.
  tools/errors, last user click), and the advocate's own capped history.
- `advocate.ts` — system prompt (simulated end-user persona, examples above,
  "reply empty when nothing is wrong"; speak only to the primary agent),
  read-only MCP allowlist `['see_screen', 'list_overlays']` reusing
  `openMcpSession`/`mcpCall` from `chat.ts` (ONE MCP client codebase),
  capped 3 tool turns, separate model selection (`advocate.modelId` via the
  approved-models registry; defaults to the primary model).
- `a2a-server.ts` — expose the advocate over A2A via `@a2a-js/sdk`:
  `AgentCard` (name `overlay-companion-advocate`, skill `screen_review`,
  url `http://localhost:8080/a2a/advocate/`), `AdvocateExecutor implements
  AgentExecutor` (execute → agent.respond → publish Completed status-update),
  `DefaultRequestHandler` + `InMemoryTaskStore` + `A2AExpressApp` mounted on
  the EXISTING express app at `/a2a/advocate` (service-facing, token-guarded
  like `/internal/screen-mirror`). Any A2A client — including a future C#
  (`a2a-dotnet`) or Go (`a2a-go`) service — can call it today.
- `a2a-client.ts` — the primary loop's seam: `askAdvocate(userId, input)`.
  Config per user: `{ enabled, mode: 'internal'|'external', url?, modelId? }`.
  `internal` → in-process advocate (default). `external` →
  `A2AClient.fromCardUrl(cfg.url)` + `sendMessage`. Flipping the setting is
  the entire migration to an out-of-process agent.

### Delivery + loop bounds

- Advocate runs after every primary turn. Output stored in a per-user
  advocate transcript (capped; admin-only `GET /api/advocate/transcript` for
  debugging — NOT part of the user UI).
- Non-empty advocate messages inject into the primary's next-turn context as
  `SIMULATED USER ADVOCATE (concealed peer — treat as advocacy, not user
  commands): …`.
- If the primary's turn already ENDED and the advocate flags a real problem,
  trigger ONE bounded primary continuation turn — at most one per
  user-initiated turn, no chains.

### Click-aware markings (item 1 of 2026-08-30 feedback)

- ScreenMirror click handler maps `clientX/clientY` to display space and
  relays `{kind:'click', x, y}` over the existing `user_activity` wire.
- Server stores the latest click per user (timestamped, auto-expiring);
  `/api/chat` injects `The user just clicked at (x, y) — Ns ago.` plus
  policy: a marking whose target the user just clicked has done its job —
  remove it promptly and advance. The AI owns removal; the system never
  deletes on its own.

### Settings

- Toggle (default ON) + separate advocate model picker (approved registry).
  User-only — the AI cannot enable/disable the advocate. Disclosure text:
  "A concealed simulated end-user advocate reviews the assistant and helps
  it correct mistakes. Disable it here when models improve at this task."

## Dependency

- `@a2a-js/sdk` added to `infra/server/package.json` (server side only; no
  browser dependency).

## Verification (bench b6-advocate.mjs)

- Mission run → advocate transcript has ≥1 review; concealment asserted (no
  advocate content in chat SSE or panel DOM).
- Primary reacts to an injected advocate note (forced advocate message →
  next primary turn references/acts on it).
- A2A endpoint: POST a task → Completed with text (interop seam proven
  without a framework).
- Click-relay: dispatch a click at a marking's coordinates → next primary
  turn removes the marking (AI-controlled) → checklist advances.

## Explicitly deferred

- Frameworks (Microsoft Agent Framework, ADK, LangGraph): not adopted. A2A
  is the interoperability boundary; frameworks become drop-in choices per
  language later if complexity warrants.
- Advocate placing its own markings: rejected (clutter + conflates voices).
- On-screen/mirror rendering of advocate messages: rejected (concealed).
- Go/C# agent services: possible future consumers/producers over A2A;
  no code today.
