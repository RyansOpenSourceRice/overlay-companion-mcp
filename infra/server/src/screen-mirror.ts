/**
 * R13/R14 — Screen Mirror.
 *
 * The management container is headless: C# take_screenshot cannot capture a
 * real desktop. But the desktop page runs the KasmVNC client in a same-origin
 * iframe, so its framebuffer canvas is readable in JS. This store keeps the
 * freshest downscaled JPEG frames captured by the page:
 *
 *   frame   – what the screen looked like at last capture (input-driven or
 *             interval-driven; the page decides and tags it)
 *   preview – a composed frame showing where a candidate overlay WOULD land
 *             (ghost rendering) for the optional preview feature
 *
 * Frames are volatile memory with a tiny ring buffer so `see_screen` always
 * returns something recent and cheap.
 */

export interface MirrorFrame {
  dataUrl: string;         // image/jpeg base64 data URL
  width: number;
  height: number;
  displayWidth: number;    // logical guest resolution at capture time
  displayHeight: number;
  trigger: 'interval' | 'input' | 'manual' | 'preview' | 'connect';
  cadenceMs?: number;
  capturedAt: number;      // epoch ms
}

const MAX_FRAMES = 12;

const frames: MirrorFrame[] = [];
let latestPreview: MirrorFrame | null = null;

export function pushFrame(frame: MirrorFrame): void {
  frames.push(frame);
  if (frames.length > MAX_FRAMES) frames.shift();
}

export function latestFrame(): MirrorFrame | null {
  return frames.length > 0 ? frames[frames.length - 1] : null;
}

export function frameAgeMs(): number | null {
  const l = latestFrame();
  return l ? Date.now() - l.capturedAt : null;
}

export function pushPreview(frame: MirrorFrame): void {
  latestPreview = frame;
}

export function currentPreview(): MirrorFrame | null {
  return latestPreview;
}

/**
 * Control-channel hook. server.ts binds this to the browser-facing /ws
 * broadcast so chat tools can retune page-side mirroring without importing
 * socket internals here.
 */
export const mirrorControl: { send: ((payload: Record<string, unknown>) => void) | null } = {
  send: null,
};

/**
 * Overlay-layer control (A-fix): lets chat tools wipe the bridge cache and
 * every connected browser canvas without a C# round-trip — C# cannot remove
 * overlays it no longer knows about (pre-restart ghosts).
 */
export const overlayControl: { clear: (() => void) | null } = { clear: null };

/**
 * Render-layer overlay cache (moved from server.ts so chat.ts can read it for
 * the Phase 5 opacity policy without a circular import — server imports chat,
 * so chat must never import server). Shape: normalized browser overlays with
 * id/x/y/width/height/color/opacity/template/actor.
 */
let bridgeOverlays: Array<Record<string, unknown>> = [];
export function getBridgeOverlays(): Array<Record<string, unknown>> {
  return bridgeOverlays;
}
export function setBridgeOverlays(overlays: Array<Record<string, unknown>>): void {
  bridgeOverlays = overlays;
}

/**
 * Phase 3: wait until a preview frame newer than `sinceMs` has been uploaded
 * (the page composes ghosts asynchronously over the websocket control
 * channel). Returns the fresh preview or null on timeout / no composer.
 */
export function waitForPreview(sinceMs: number, timeoutMs = 1500): Promise<ReturnType<typeof currentPreview>> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      const p = currentPreview();
      if (p && p.capturedAt > sinceMs) { resolve(p); return; }
      if (Date.now() >= deadline) { resolve(p && p.capturedAt > sinceMs ? p : null); return; }
      setTimeout(tick, 150);
    };
    tick();
  });
}
