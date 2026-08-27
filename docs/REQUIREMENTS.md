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
