# Overlay Companion MCP — Live Requirements

Requirements captured from user feedback sessions. Items move to "Shipped"
when merged and verified in the running stack. Keep this file current with
every accepted request; it is the contract for what the demo must do.

## Shipped

- **R1 Overlays must visibly render in the desktop view.** Chat-drawn overlays
  flow: C# OverlayService → `/ws/overlays` broadcast → management-server
  bridge → browser `/ws` → overlay canvas over the VNC iframe, scaled from
  display coordinates to element pixels, redrawn on window resize.
  Verified via Playwright pixel sampling. *(this change)*
- **R2 Template overlays are persistent by default.** A semi-transparent
  annotation that self-destructs after 5 s reads as a rendering failure.
  `timeoutMs` may still be passed via `templateParams`. *(this change)*
- **R3 Assistant header stays truthful ("dynamic awareness").**
  `display owner` badge and tool list poll every 5 s instead of only loading
  once at page open. *(this change)*
- **R4 Chat panel side is adjustable** (left/right) via the ⇄ button in the
  assistant header, persisted in localStorage (`oc.chatSide`). *(this change)*
- **R5 Tool failures recover automatically**: blocked actions explain why and
  how to unlock (`set_mode {assist}`), ownership switches are self-service,
  inline `<tool_call>` text from Hermes-style models is salvaged into real
  tool calls. Verified unattended yellow-circle draw. *(bb8f10e + this)*
- **R6 Natural-language AI model switching** incl. OpenRouter routing
  variants (`qwen/qwen3.5-35b-a3b:nitro`). *(6fb933b)*

## Accepted, not yet built

- **R11 Annotation bounds guardrail (SHIPPED):** template_overlay/draw_overlay clamp regions into
  their target monitor and refuse fully-offscreen requests with actionable errors.
- **R12 Dynamic display awareness:** `/api/display-state` exposes versioned geometry; the desktop page
  stamps it onto mirror captures so overlays keep mapping correctly after resolution changes.
- **R13 Screen mirror + see_screen (opt-in cadence):** browser captures the same-origin KasmVNC
  framebuffer (input-driven debounced, or 1s/4s/10s interval), assistant sees real pixels via
  `see_screen`, and `preview_overlay` ghost-renders candidates before anything shows to the user.
- **R14 Update dynamicism:** mirror cadence selectable (off/on-input/1s/4s/10s) with instant capture on
  click/scroll/keys (tab, enter, alt, esc included via outer-document hook).
- **R15 Adjustable annotations:** remove_overlay exposed to chat for move/resize-by-redraw workflows.

## Accepted, not yet built (Phase 5 — feedback 2026-08-28)

- **R16 Opacity policy (SHIPPED):** markings stay translucent — per-user
  `maxSingularOpacity` (default 40%) caps any single marking and pairwise
  composition `1-(1-a)(1-b)` over overlapping highlights caps at
  `maxOverallOpacity` (default 75%). Enforced server-side at draw time
  (reduced or refused with a plain-language explanation). Both caps are
  configurable via GUI AND AI chat — AI changes in EITHER direction require
  explicit user approval (panel Approve/Deny chip; Settings GUI shows the
  same pending change). Validation `singular <= overall` at every write path.
- **R17 Stepwise auto-clear (SHIPPED):** `set_step_mode {enabled}` makes the
  server auto-remove the previous step's marking as each new one commits —
  exactly one tutorial marking on screen in "1 at a time" guidance. The
  outgoing marking is exempt from the marking-limit count while being
  replaced (no deadlock at the cap).
- **R18 Task persistence (SHIPPED):** anti-lazy system policy — a multi-step
  task is complete only when its checklist is complete; never end a turn
  waiting for the user unless input is genuinely required. Auto-sleep stays
  purely mouse-idle based (waste prevention) and never gates on the
  checklist; mouse movement always disengages it.
- **R19 Plan/Act checklist (SHIPPED):** OpenCode-style. `set_task_plan`
  (≤12 steps) renders a checklist with a Go button; the model pauses until
  the user approves. `update_task_step` uses fluid statuses
  (pending/in_progress/done/skipped/blocked) — out-of-order and skipped
  steps are first-class. Checklist state injects as a compact one-line
  context each turn (context-rot minimization).
- **R20 Sleep indicators (SHIPPED):** `SleepGate.StateChanged` broadcasts
  `sleep_state` (C# hub → bridge → panel): a fixed badge explains why the
  assistant went quiet; a brief green pulse marks wake. Chat sends always
  wake the gate (a slept-through done-state never blocks re-engagement), and
  real VM input reaches the gate via a throttled `user_activity` ws signal
  (the MCP container's own input monitor is blind in containers — that dead
  wire was why wake felt impossible).
- **R21 Context compaction (SHIPPED):** rolling window — past a 24k-char
  budget beyond the last 8 turns, older messages collapse into a
  deterministic extractive digest (role, gist, tools used); images stripped.
  The panel shows a context meter so compaction is visible, not magic.
- **R22 Thinking dots (SHIPPED):** streamed reasoning never floods the chat —
  a 3-dot shimmer signals liveness; raw text is opt-in behind a collapsed
  toggle; token counting removed.
- **R23 Display truth (SHIPPED):** mirror-reported resolution is the ONLY
  coordinate space. System context states it unarguably; draws landing
  outside the real display are rescaled from the known phantom layout
  (1920x1080) into true space when that yields in-bounds geometry (the OSM
  session's phantom-1920 failure mode).

- **R7a Fit-to-window (SHIPPED default).** Decision: scale-to-fit first —
  the KasmVNC client requests `resize=scale` so the framebuffer fills all
  available space; per-connection `screenSizing: scale|remote|off` chooses
  behaviour. Chat panel docking squeezes the desktop (margin shift), with a
  drag handle clamped to 300–720 px, persisting both.
- **R7b Remote-resolution follow-up.** Setting already passes
  `resize=remote`; verifying guest-side auto-resize behaviour on each KasmVNC
  target is pending.
- **R8 Resolution-change awareness in chat:** when the display geometry
  changes, invalidate cached get_display_info and re-broadcast displays over
  ws so overlays stay accurate.
- **R9 Local-first verification (PARTIALLY SHIPPED):** `scripts/local_verify.sh`
  exercises health/login/draw end-to-end locally; Playwright pixel check via
  `infra/scripts/pixel-check.mjs`. GitHub runners limited to a slim PR
  compile-check workflow — heavy verification stays local by project policy.

## Shipped (this round)

- **R10 Admin-managed adaptive rate limiting.** App surfaces (chat,
  connections, MCP proxy) limit per IDENTITY (user id before IP fallback) via
  rate-limiter-flexible; short block windows instead of long lockouts;
  headers + Retry-After returned. All knobs live in `limits.<surface>` config
  and are editable at runtime from Settings > Rate Limiting (admin) or chat
  set_config; admins bypass chat throttling (`limits.bypassAdmin`). Login/TOTP
  keep strict IP-based brute-force limits unchanged. Note: no personal skill
  file was available in this environment — library chosen on merit.

## Round notes

- User feedback round → R11–R15 (annotation width overshoot, stale display state, misplaced circles,
  static behavior, non-adjustable overlays). Core pipeline shipped this round: clamps + mirror +
  preview + cadence + adjustable-annotation tool exposure.
