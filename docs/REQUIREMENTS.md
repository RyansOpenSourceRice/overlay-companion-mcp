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

- **R7 Dynamic screen sizing (fit-to-window).** Two coordinated parts:
  1. Browser side: noVNC/KasmVNC view scales to fill available space,
     sidebar/panel aware, no forced centering; desktop takes all leftover
     space (drop fixed 16:9 black-box centering).
  2. VM side: optionally drive KasmVNC remote resolution so guest resolution
     tracks the available viewport when the protocol supports it
     (KasmVNC `resize=remote`), falling back gracefully where it doesn't.
- **R8 Resolution-change awareness in chat:** when the display geometry
  changes, in-app chat/UI must refresh cached display info (invalidate
  get_display_info cache, re-broadcast displays over ws) so overlays stay
  accurate.
- **R9 CI job that exercises the product, not just the code:** run the
  container stack nightly/on infra PRs; script login + a scripted prompt +
  assert a drawn overlay exists (tool result + canvas pixel check).
