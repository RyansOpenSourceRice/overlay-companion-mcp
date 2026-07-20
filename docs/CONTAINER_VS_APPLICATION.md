# Container vs Application — Decision Guidance

[![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

> **Status:** Recommendation for Ryan. This document records the analysis behind the
> container-vs-application decision and unblocks the Rust→C# migration work
> (which is intentionally **paused until this direction is confirmed**).
>
> **One-line answer:** It is not either/or. Keep the MCP **server** in a container
> (it is a service, not a UI), and treat on-screen overlay **rendering** as a separate
> host-side concern that a container cannot solve. Flatpak is **not** the lever for
> the alt-tab / key-capture problem — that is a VNC-client input-grab issue.

---

## 1. What this project actually is

Re-stating the scope so the decision is grounded:

- **This project is the annotation layer.** It does **not** run the VM. The VM
  (a Fedora desktop with KasmVNC) is run elsewhere.
- It exposes an MCP server (AI-facing tools: overlays, screenshots, input
  simulation, clipboard, connection management) and a web UI.
- Current shape: 4 podman containers on the **host** Fedora (MCP server,
  management web, KasmVNC proxy, Caddy). The **target** is a separate Fedora VM.
- Ryan's history: **C# flatpak** → realized he could not directly annotate the
  screen → **docker C#** → worried about memory → **Rust** → abandoned when
  finances stopped development.

The goal now is throughput and a working product, with the big open question:
**container vs application**.

## 2. The three problems that keep getting conflated

The alt-tab / key-capture / flatpak / trapping questions are **three separate
problems**. Treating them as one is what made the earlier attempts spiral.

### Problem A — Where does alt-tab need to work?

| Alt-tab scope | Who handles it | Does the annotation layer need to grab it? |
|---|---|---|
| **Among windows inside the VM** | The VM's own compositor (Mutter/GNOME in the VM) | **No.** Keystrokes must *reach* the VM; the VM handles the rest. |
| **Between host apps (incl. the annotation app)** | The host compositor | **No.** The annotation app is a normal host window. |
| **Between the VNC client and other host apps** | The VNC client's input capture | This is the *only* place the pain lives, and it is a VNC-client setting, not an annotation-layer concern. |

**Conclusion:** the annotation layer does **not** need global key capture to
deliver alt-tab. The pain is in the VNC client's input grab, which is a
configuration problem (see §4), not an architecture problem.

### Problem B — Can a flatpak (or any sandboxed app) capture global keys on Wayland?

Short answer: **no, and flatpak makes it harder, not easier.**

- Wayland **intentionally restricts** arbitrary clients from grabbing global
  keys. Only the compositor and privileged components can register global
  shortcuts. This is by design (a "security nightmare" per the
  `xdg-desktop-portal` maintainers).
- The `org.freedesktop.portal.GlobalShortcuts` portal exists (landed in
  `xdg-desktop-portal` in the 2023–2024 timeframe) and works with flatpaks,
  **but**:
  - It requires the **user** to configure shortcuts in
    *System Settings → Keyboard → Shortcuts*. The app cannot silently grab
    alt-tab.
  - It is designed for media keys / app-specific shortcuts, not for hijacking
    the window-cycle key.
  - GNOME's portal implementation support has been landing gradually; do not
    assume it is present on an older GNOME.
- A flatpak running as root could read evdev directly, but that defeats the
  point of flatpak and is not the path.

**Conclusion:** Ryan's instinct "I think I need flatpak" for the key-capture
goal is **incorrect**. Flatpak is a packaging/isolation technology. It gives
*less* input-grab power than a regular Wayland client, not more.

### Problem C — How to avoid trapping a user in the VM

This is a remote-desktop input-grab problem, not a flatpak problem.

- The trap is worst with a **fullscreen native viewer with pointer/keyboard
  grab and no release gesture**.
- A **browser-based** VNC client (KasmVNC's default) is actually *less*
  trapping: the browser is a host app, so host alt-tab (or clicking outside the
  canvas) always escapes.
- KasmVNC has explicit control hotkeys (e.g. `Ctrl+Shift+1` opens the control
  panel; game/pointer-lock toggles exist). These are the release hatches.
- Best practice: never fullscreen-grab without a **documented release hotkey**,
  and keep a visible **host-side element** (the annotation app's own window, or
  just the browser chrome) so the user always sees an escape route.

**Conclusion:** anti-trapping is about (1) a reliable release hotkey,
(2) not defaulting to fullscreen grab, (3) a visible host-side escape hatch.
The annotation layer being on the *host* (not inside the VM) is what provides
the hatch.

## 3. Overlay rendering — the real container-vs-application fork

This is the only place where container vs application genuinely diverges, and
it is the thing Ryan originally hit ("realized I can not directly annotate the
screen").

| Approach | Can it draw overlays **on top of the real desktop**? | Notes |
|---|---|---|
| **Container** (current) | **No.** A container cannot draw on the host compositor. | Current design renders overlays in a *web viewer* (separate pane), not composited over the desktop. This is the compromise. |
| **Host application** (flatpak or native) | **Only if the compositor exposes a layer protocol.** | Uses `zwlr_layer_shell_v1` (wlroots: Sway/Hyprland/Niri) or a GNOME Shell extension. |

The compositor reality (verified):

- **`zwlr_layer_shell_v1` is a wlroots protocol.** It works on Sway, Hyprland,
  Niri, and wlroots-based compositors.
- **GNOME does NOT implement `zwlr_layer_shell_v1` natively.** It requires a
  GNOME Shell extension (see gnome-shell work item #1141, still open as of
  2025). This is almost certainly **why** Ryan could not directly annotate the
  screen on his GNOME/Fedora host.
- A flatpak can use layer-shell **if** granted `socket=wayland` and the
  compositor supports the protocol. On GNOME, that gate is closed without an
  extension.

**Implication for Ryan's host (Fedora Desktop, defaults to GNOME):**
on-screen overlays over the real desktop are **hard on GNOME** regardless of
flatpak-vs-native. The realistic options are:

1. **Switch the host compositor to a wlroots one** (Sway/Hyprland/Niri) — then
   a host app (flatpak or native, C# viable via `gtk4-layer-shell`) can draw
   click-through overlays via layer-shell. This is a host environment change,
   not a packaging change. **On wlroots, "direct overlay is impossible" is
   FALSE** — a capable implementation can do it; any prior failure here was
   implementation/model weakness, not a technical wall.
2. **Ship a GNOME Shell extension** that draws the overlay layer — extensions
   run privileged inside the shell and can add fullscreen click-through actors
   to the shell's UI group. This is a real path that a stronger model can
   implement competently. It couples the project to GNOME major versions and
   is JavaScript (GJS), not C#.
3. **Keep the web-viewer compromise** (current) — overlays render in a web pane,
   not over the desktop. Cheapest, works on any compositor, but is not "true"
   on-screen annotation.

> **Note on the "impossible" conclusion.** A prior attempt concluded "I can
> not directly annotate the screen." That conclusion was reached with a weaker
> model and is **compositor-conditional, not absolute**. On GNOME the
> `zwlr_layer_shell_v1` gap is real (a stronger model does not change the
> protocol), but a GNOME Shell extension path exists. On wlroots, direct
> overlay is achievable and prior failure was implementation weakness. So the
> open question is the compositor, not whether to "try harder."

## 4. Recommendation

### 4.1 Architecture split (the actual decision)

Do not choose "container" or "application" globally. Split by capability:

| Component | Form | Why |
|---|---|---|
| **MCP server** (AI-facing, stateful, no GUI) | **Container** (as-is) | It is a service. Containers are correct for services. Throughput, restartability, and isolation all favor the container here. This is where the Rust→C# migration should land (C# in a container). |
| **Web UI / overlay viewer** (current) | **Container** (as-is) | Browser-delivered; works on any host compositor; provides the host-side escape hatch. |
| **On-screen overlay rendering** (true desktop annotation) | **Host application** — *only if* Ryan adopts a wlroots host or ships a GNOME Shell extension | A container cannot do this. If Ryan does not want to change compositor or ship an extension, **stay on the web-viewer compromise** and do not build a host app. |
| **Clipboard bridge** (VM-side helper) | **Container or small native binary in the VM** | It runs where the clipboard is. A container in the VM is fine; a small C# binary is also fine. This is independent of the host decision. |

### 4.2 On alt-tab / key capture / trapping

- **Do not build a flatpak to solve alt-tab.** It will not solve it.
- Fix alt-tab-inside-VM at the **VNC client**: use KasmVNC fullscreen or PWA
  mode for better shortcut pass-through, and/or rebind the VM's window-cycle
  shortcut to something the host does not swallow (the Kasm community suggests
  rebinding "Cycle windows" inside the session).
- Anti-trapping: keep the annotation UI visible on the host, document the
  KasmVNC release hotkeys (`Ctrl+Shift+1` for the control panel), and do not
  default to a fullscreen pointer grab.

### 4.3 On Rust → C# (Goal 2, currently paused)

This is the throughline for the paused migration work:

- The **MCP server belongs in a container**, and Ryan prefers C# where feasible
  (object-oriented, memory-secure via the runtime). The existing C# MCP server
  in `src/` is already the primary; the Rust server in `apps/mcp-server-rust/`
  is a parallel/parity effort. **Consolidate on the C# MCP server in its
  container** and retire the Rust MCP server once parity is confirmed.
- The **clipboard bridge** can be C# as well (small HTTP service). The Rust
  clipboard bridge's only real advantage was a tiny binary; in a container that
  does not matter.
- **Do not** migrate the on-screen overlay rendering to C# until the §3
  compositor question is resolved (wlroots host vs GNOME extension vs
  web-viewer). If the answer is "web viewer", there is nothing to migrate. If
  the answer is "host app on wlroots", a C# flatpak using `gtk4-layer-shell`
  is viable. If the answer is "GNOME Shell extension", that is JS/GJS, not C#.

### 4.4 On throughput (Ryan's stated priority)

Throughput favors the **container** path for the server and web layers: it is
the path that already has CI, compose stacks, and a running web UI. The
application path (host overlay app) is a **capability addition** on top of the
container path, not a replacement. So:

- **Default forward path: container for server + web, keep web-viewer overlays,
  fix alt-tab at the VNC client.** This maximizes throughput and unblocks the
  C# migration immediately.
- **Optional later: host overlay app** only if Ryan switches to a wlroots
  compositor or accepts a GNOME Shell extension. This is additive and can wait.

## 5. What this means for the remaining goals

| Goal | Action in light of this decision |
|---|---|
| **Goal 1 (Dependabot → Renovate)** | Unaffected. Do it. |
| **Goal 2 (Rust → C#)** | **Unblocked for the MCP server + clipboard bridge** (container path, consolidate on existing C#). **Still blocked for overlay rendering** until the §3 compositor choice is made. **Web layer is TypeScript, not C#** — see note below. |
| **Goal 3 (JS → TS)** | **In progress.** `infra/server` and `infra/web` are the web layer and are being migrated JS→TS (tsconfig + deps + config files converted; runtime files staged). This is the correct target for the web layer. |
| **Goal 4 (key capture / alt-tab / flatpak)** | **Answered above.** No flatpak for key capture; fix at VNC client; anti-trap via host-side hatch + release hotkey. |
| **Goal 7 (guidance)** | This document. |

## 6. Open questions for Ryan

These are the decisions only Ryan can make; they determine whether the
"host overlay app" branch is ever built. Reframed in light of the
"impossible was compositor-conditional" insight:

1. **Host compositor (the pivotal question).** What compositor is your Fedora
   host running, and are you willing to change it?
   - **wlroots (Sway/Hyprland/Niri):** direct on-screen overlay is **achievable**
     in C# via `gtk4-layer-shell`. The prior "impossible" conclusion does not
     apply here — that was implementation/model weakness. If you switch here,
     the host overlay app is buildable now.
   - **GNOME (Fedora default):** the `zwlr_layer_shell_v1` gap is real. Direct
     overlay requires either a GNOME Shell extension (see Q2) or accepting the
     web-viewer compromise (see Q3).
2. **If you stay on GNOME: GNOME Shell extension or web viewer?**
   - **GNOME Shell extension** (GJS/JavaScript, privileged, draws overlays over
     the whole screen): a stronger model can implement this competently. Cost:
     coupled to GNOME major versions, not C#.
   - **Web-viewer compromise** (overlays in a browser pane, not composited over
     the desktop): cheapest, works on any compositor, no coupling.
3. **Overlay fidelity vs throughput.** Is the web-viewer compromise acceptable
   for your throughput goal? If yes, the container path is complete, no host app
   is needed, and questions 1–2 are moot. If you need true on-screen annotation
   for throughput, then Q1/Q2 decide how it's built.

**Quick decision tree:**
- Web viewer is fine → done. Container + C# MCP server + TS web layer.
- Need on-screen overlays + willing to run wlroots → host overlay app in C#.
- Need on-screen overlays + staying on GNOME → GNOME Shell extension (GJS).
- Need on-screen overlays + staying on GNOME + no extension → blocked (no path).

My recommendation, given throughput is the priority: **stay on the container +
web-viewer path, fix alt-tab at the VNC client, consolidate the MCP server on
C#, and treat the host overlay app as a future capability to revisit only if
the web-viewer proves insufficient.**

### Language placement (locked-in unless a substantial reason emerges)

- **MCP server + clipboard bridge:** C# (object-oriented, memory-secure via the
  .NET runtime; consolidate on the existing `src/` C# server, retire Rust once
  parity holds).
- **Web layer (`infra/server` management/proxy + `infra/web` frontend):**
  **TypeScript, not C#.** The web layer is browser/Node-facing; TypeScript is
  the native fit and Ryan's stated preference ("TypeScript instead of JavaScript
  where JS/TS are used"). Do **not** fold the web layer into C# unless a
  substantial memory or security argument makes C# clearly better here — none
  is currently identified.

---

*Authored by an AI agent (OpenHands) on behalf of Ryan. This document records
analysis and a recommendation; the binding decisions are Ryan's.*
