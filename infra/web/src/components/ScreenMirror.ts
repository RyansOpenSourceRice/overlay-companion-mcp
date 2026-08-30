/**
 * R13/R14 — Screen mirror capturer.
 *
 * The KasmVNC client runs in a SAME-ORIGIN iframe (proxied under /vnc), so
 * we can read its framebuffer canvas directly. We downscale to a compact JPEG
 * and upload:
 *
 *   - on input activity inside the desktop (click, key incl. tab/enter/alt/
 *     esc, scroll, wheel) — debounced so fast motion does not flood
 *   - every cadenceMs when a periodic mode is selected
 *   - once right after connect
 *
 * The interior assistant consumes these via see_screen / preview_overlay.
 */

/**
 * Cadence accepts either a named mode or ANY millisecond interval — the AI
 * sets this at runtime via set_screen_updates (e.g. 1000 while placing an
 * annotation, 30000 once settled).
 */
export type MirrorCadence = 'off' | 'input' | number;

const MIN_CADENCE_MS = 500;
const MAX_CADENCE_MS = 30 * 60_000;

const MAX_DIMENSION = 960;
const INPUT_DEBOUNCE_MS = 350;

interface MirrorDoc {
  contentDocument: Document | null;
}

export class ScreenMirror {
  private timer: number | null = null;
  private debounceTimer: number | null = null;
  private hooked: Document | null = null;
  private lastSentAt = 0;
  private currentCadence: MirrorCadence = 'off';
  private canvas: HTMLCanvasElement | null = null;
  // Phase 4 focus-sleep: the cadence the user/model chose, and whether the
  // page is currently dimmed (tab hidden or window unfocused for >5s). While
  // dimmed the mirror idles at a 60s heartbeat; the assistant can still
  // captureNow (explicit request always wakes one frame).
  private userCadence: MirrorCadence = 'off';
  private focusSuspended = false;
  private suspendTimer: number | null = null;

  uploadStats = { attempts: 0, sent: 0, lastError: '' };

  /**
   * Phase 5 item 3: fired on real user input inside the VNC iframe (throttled
   * by the consumer). The management server relays this to the C# power gate
   * as a wake signal — the gate's own input monitor is blind in containers.
   */
  public onUserActivity: ((kind: 'move' | 'click' | 'key') => void) | null = null;

  constructor(private iframeGetter: () => HTMLIFrameElement | null) {
    // Bench/e2e introspection hook.
    (window as unknown as Record<string, unknown>).__ocMirror = this;
    this.hookFocusSleep();
  }

  /** Phase 4: idle the mirror when the user is not looking at the page. */
  private hookFocusSleep(): void {
    const suspendSoon = (): void => {
      if (this.suspendTimer !== null) return;
      this.suspendTimer = window.setTimeout(() => {
        this.suspendTimer = null;
        if (!this.focusSuspended) {
          this.focusSuspended = true;
          this.applyCadence();
        }
      }, 5000);
    };
    const wake = (): void => {
      if (this.suspendTimer !== null) {
        window.clearTimeout(this.suspendTimer);
        this.suspendTimer = null;
      }
      if (this.focusSuspended) {
        this.focusSuspended = false;
        this.applyCadence();
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) suspendSoon(); else wake();
    });
    window.addEventListener('blur', suspendSoon);
    window.addEventListener('focus', wake);
  }

  public get isFocusSuspended(): boolean { return this.focusSuspended; }

  setCadence(mode: MirrorCadence): void {
    this.userCadence = mode;
    this.applyCadence();
  }

  private applyCadence(): void {
    const mode: MirrorCadence = this.userCadence;
    this.currentCadence = mode;
    this.stopTimer();
    this.unhookInput();
    if (mode === 'off') { void this.upload('manual', true); return; }
    // Immediate snapshot on enable so see_screen has something fresh.
    void this.upload('manual', true);
    if (mode !== 'input') {
      const raw = Number(mode);
      const ms = this.focusSuspended
        ? 60_000
        : Math.min(MAX_CADENCE_MS, Math.max(MIN_CADENCE_MS, raw));
      this.currentCadence = this.focusSuspended ? mode : ms;
      this.timer = window.setInterval(() => void this.upload('interval'), ms);
    } else {
      this.currentCadence = 'input';
      // Input-driven: hook events; heartbeat so idle-but-changing content
      // still lands eventually. While focus-suspended the heartbeat idles
      // at 60s instead of 10s — nothing is watching, and the assistant can
      // always captureNow for an on-demand frame.
      this.timer = window.setInterval(() => void this.upload('interval', !this.focusSuspended), this.focusSuspended ? 60_000 : 10_000);
    }
    // First-frame guarantee: captureFrame can fail while the VNC client is
    // still connecting (no painted canvas yet). Retry aggressively until we
    // have ONE real frame; without it the assistant is blind forever under
    // input-driven mode in automated sessions.
    let attempts = 0;
    const boot = window.setInterval(() => {
      attempts++;
      void (async () => {
        const probe = await this.captureFrame();
        if (probe?.canvasOut) {
          clearInterval(boot);
          await this.send(probe.canvasOut, 'manual', probe, undefined);
        } else if (attempts > 40) {
          clearInterval(boot);
        }
      })();
    }, 1500);
    this.hookInput();
    this.startRehookWatchdog();
  }

  /** Compose ghost preview of a candidate overlay over the freshest frame. */
  async composePreview(spec: { x: number; y: number; width: number; height: number; color?: string }): Promise<void> {
    const frame = await this.captureFrame();
    if (!frame) return;
    const img = frame.img;
    const out = document.createElement('canvas');
    out.width = img.width; out.height = img.height;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const sx = img.width / frame.displayWidth;
    const sy = img.height / frame.displayHeight;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = spec.color ?? '#ffff00';
    ctx.fillStyle = spec.color ?? '#ffff00';
    ctx.lineWidth = Math.max(3, spec.width * sx * 0.06);
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(spec.x * sx, spec.y * sy, spec.width * sx, spec.height * sy);
    ctx.globalAlpha = 0.18;
    ctx.fillRect(spec.x * sx, spec.y * sy, spec.width * sx, spec.height * sy);
    ctx.restore();
    await this.send(out, 'preview', {
      displayWidth: frame.displayWidth,
      displayHeight: frame.displayHeight,
    }, undefined, true);
  }

  private stopTimer(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  // Stable wrapper identities — inline arrows would leak on re-hook cycles.
  private readonly onMove = (): void => this.onInput('move');
  private readonly onScroll = (): void => this.onInput('move');

  private unhookInput(): void {
    if (!this.hooked) return;
    try {
      this.hooked.removeEventListener('mousemove', this.onMove);
      this.hooked.removeEventListener('wheel', this.onMove);
      this.hooked.removeEventListener('scroll', this.onScroll, true);
      this.hooked.removeEventListener('mousedown', this.onClick);
      this.hooked.removeEventListener('keydown', this.onKey);
      document.removeEventListener('keydown', this.onKey);
    } catch { /* iframe torn down */ }
    this.hooked = null;
  }

  private hookInput(): void {
    this.unhookInput();
    const doc: Document | null = (this.iframeGetter() as unknown as MirrorDoc | null)?.contentDocument ?? null;
    if (!doc) return;
    try {
      doc.addEventListener('mousemove', this.onMove, { passive: true });
      doc.addEventListener('wheel', this.onMove, { passive: true });
      doc.addEventListener('scroll', this.onScroll, true);
      doc.addEventListener('mousedown', this.onClick, { passive: true });
      doc.addEventListener('keydown', this.onKey);
      // Tab/Enter etc. while focus is on the outer page must count too.
      document.addEventListener('keydown', this.onKey);
      this.hooked = doc;
    } catch { /* not same-origin */ }
  }

  /**
   * Phase 6 FIX: the KasmVNC iframe loads (and navigates on reconnect) AFTER
   * applyCadence hooks it — hooks on the initial about:blank document are
   * dead, so wake/auto-continue never saw a single real input event. A cheap
   * watchdog re-hooks whenever the iframe's document identity changes.
   */
  private rehookTimer: number | null = null;

  private startRehookWatchdog(): void {
    if (this.rehookTimer !== null) return;
    this.rehookTimer = window.setInterval(() => {
      if (this.currentCadence === 'off') return;
      const doc: Document | null = (this.iframeGetter() as unknown as MirrorDoc | null)?.contentDocument ?? null;
      if (doc && doc !== this.hooked) this.hookInput();
    }, 4000);
  }

  private onClick = (): void => {
    // Phase 6: clicks are intent — a distinct kind so consumers can treat
    // them as stronger evidence than drift (auto-continue reacts faster).
    try { this.onUserActivity?.('click'); } catch { /* never break the mirror */ }
    this.onInput('click');
  };

  private onKey = (): void => {
    try { this.onUserActivity?.('key'); } catch { /* never break the mirror */ }
    this.onInput('key');
  };

  private onInput = (kind: 'move' | 'click' | 'key' = 'move'): void => {
    // Phase 5 item 3: real VM user input = wake signal (consumer throttles).
    try { this.onUserActivity?.(kind); } catch { /* never break the mirror */ }
    if (this.currentCadence === 'off') return;
    if (this.debounceTimer !== null) return;
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.upload('input');
    }, INPUT_DEBOUNCE_MS);
  };

  private upload(trigger: 'interval' | 'input' | 'manual' | 'connect', allowLowFreq: boolean = true): Promise<void> {
    return new Promise((resolve) => {
      void (async () => {
        const minGap = trigger === 'interval' && !allowLowFreq ? 250 : 1200;
        if (Date.now() - this.lastSentAt < minGap) { resolve(); return; }
        this.lastSentAt = Date.now();
        this.uploadStats.attempts++;
        const frame = await this.captureFrame();
        if (!frame?.canvasOut) {
          this.uploadStats.lastError = 'captureFrame null';
          console.warn('[mirror] captureFrame returned nothing for', trigger);
          resolve(); return;
        }
        this.uploadStats.sent++;
        try {
          await this.send(frame.canvasOut, trigger, frame, frame.cadenceMs, trigger !== 'connect');
        } catch (e) {
          console.warn('[mirror] send failed', String(e).slice(0, 80));
        }
        resolve();
      })();
    });
  }

  private async captureFrame(): Promise<{ img: HTMLImageElement; canvasOut?: HTMLCanvasElement; displayWidth: number; displayHeight: number; cadenceMs?: number } | null> {
    const iframe = this.iframeGetter();
    const doc: Document | null = (iframe as unknown as MirrorDoc | null)?.contentDocument ?? null;
    if (!doc) return null;
    // KasmVNC's DOM holds several canvases: an invisible multi-monitor
    // widget, background layers, and the real framebuffer. Pick the largest
    // VISIBLY-SIZED canvas — zero-rect layers otherwise win creation races.
    let vncCanvas: HTMLCanvasElement | null = null;
    let bestArea = 0;
    for (const c of Array.from(doc.querySelectorAll('canvas')) as HTMLCanvasElement[]) {
      const rect = c.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 30) continue;
      const area = c.width * c.height;
      if (c.width > 2 && c.height > 2 && area > bestArea) {
        bestArea = area;
        vncCanvas = c;
      }
    }
    if (!vncCanvas) return null;

    // Publish the TRUE guest resolution; overlay coordinate mapping and the
    // assistant's spatial reasoning consume this instead of stale host data.
    (window as unknown as Record<string, unknown>).__ocDisplay =
      { width: vncCanvas.width, height: vncCanvas.height };
    const scale = Math.min(1, MAX_DIMENSION / Math.max(vncCanvas.width, vncCanvas.height));
    const out = document.createElement('canvas');
    out.width = Math.max(64, Math.floor(vncCanvas.width * scale));
    out.height = Math.max(36, Math.floor(vncCanvas.height * scale));
    const ctx = out.getContext('2d')!;
    try {
      ctx.drawImage(vncCanvas, 0, 0, out.width, out.height); // may throw if tainted
    } catch {
      return null;
    }

    // COMPOSITE (A1): stamp the annotation layer on top so mirror frames show
    // overlays exactly as the user sees them. Without this the assistant
    // sees a pristine desktop while the user looks at a pile of circles —
    // the root cause of the "screen is already clear" hallucinations.
    // The overlay canvas is element-sized over the same screen rect, so a
    // direct draw maps coordinates correctly.
    const overlayCanvas = document.getElementById('overlay-canvas') as HTMLCanvasElement | null;
    if (overlayCanvas && overlayCanvas.width > 0 && overlayCanvas.height > 0) {
      try {
        ctx.drawImage(overlayCanvas, 0, 0, out.width, out.height);
      } catch { /* overlay layer absent/unreadable — desktop-only frame still useful */ }
    }

    // Resolve guest logical resolution from the attribute set by the client
    // (falls back to the canvas backing size).
    const dw = Number(iframe?.dataset.ocDisplayWidth ?? vncCanvas.width);
    const dh = Number(iframe?.dataset.ocDisplayHeight ?? vncCanvas.height);
    const contentBounds = this.detectContentBounds(out, dw || vncCanvas.width, dh || vncCanvas.height);

    const meta = { displayWidth: dw || vncCanvas.width, displayHeight: dh || vncCanvas.height, contentBounds };
    let dataUrl: string;
    try {
      dataUrl = out.toDataURL('image/jpeg', 0.62);
    } catch (e) {
      console.warn('[mirror] toDataURL failed (tainted canvas?)', String(e).slice(0, 80));
      return null;
    }
    return { img: await loadImage(dataUrl), canvasOut: out, ...meta, cadenceMs: this.currentCadence === 'input' ? 0 : Number(this.currentCadence) };
  }

  private async send(
    canvas: HTMLCanvasElement,
    trigger: string,
    meta: { displayWidth: number; displayHeight: number; contentBounds?: { x: number; y: number; width: number; height: number } | null },
    cadenceMs: number | undefined,
    isPreview = false,
  ): Promise<void> {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.62);
    try {
      await fetch(isPreview ? '/api/screen-mirror/preview' : '/api/screen-mirror/frame', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          dataUrl,
          width: canvas.width,
          height: canvas.height,
          displayWidth: meta.displayWidth,
          displayHeight: meta.displayHeight,
          contentBounds: meta.contentBounds ?? null,
          trigger: trigger,
          cadenceMs,
        }),
      });
    } catch { /* offline moments are fine */ }
  }

  /**
   * Phase 6: black-bar (letterbox) detection. The guest desktop can sit
   * inside uniform dark margins; markings aimed there are invisible junk.
   * Scans the downscaled frame for fully-dark edge rows/cols and returns the
   * interior in DISPLAY coordinates. Null when there are no real bars — or
   * when the "interior" is suspiciously tiny (a dark page must not collapse
   * the bounds). Throttled; pixels are only read every ~2s.
   */
  private lastBoundsScan = 0;
  private cachedContentBounds: { x: number; y: number; width: number; height: number } | null = null;

  private detectContentBounds(out: HTMLCanvasElement, dw: number, dh: number): { x: number; y: number; width: number; height: number } | null {
    const now = Date.now();
    if (now - this.lastBoundsScan < 2000) return this.cachedContentBounds;
    this.lastBoundsScan = now;
    try {
      const ctx = out.getContext('2d');
      if (!ctx) return this.cachedContentBounds;
      const w = out.width, h = out.height;
      const px = ctx.getImageData(0, 0, w, h).data;
      const dark = (i: number): boolean => px[i] < 28 && px[i + 1] < 28 && px[i + 2] < 28;
      const rowDark = (y: number): boolean => {
        for (let x = 0; x < w; x += 4) { if (!dark((y * w + x) * 4)) return false; }
        return true;
      };
      const colDark = (x: number): boolean => {
        for (let y = 0; y < h; y += 4) { if (!dark((y * w + x) * 4)) return false; }
        return true;
      };
      let top = 0; while (top < h - 2 && rowDark(top)) top++;
      let bottom = h - 1; while (bottom > top && rowDark(bottom)) bottom--;
      let left = 0; while (left < w - 2 && colDark(left)) left++;
      let right = w - 1; while (right > left && colDark(right)) right--;
      const interior = ((right - left + 1) / w) * ((bottom - top + 1) / h);
      // No meaningful bars, or the scan collapsed a dark page into nothing.
      if (interior > 0.94 || interior < 0.3) { this.cachedContentBounds = null; return null; }
      const sx = dw / w, sy = dh / h;
      this.cachedContentBounds = {
        x: Math.round(left * sx),
        y: Math.round(top * sy),
        width: Math.round((right - left + 1) * sx),
        height: Math.round((bottom - top + 1) * sy),
      };
      return this.cachedContentBounds;
    } catch { return this.cachedContentBounds; }
  }

  /** A4: immediate capture+upload, used when see_screen requests fresh pixels. */
  async captureNow(): Promise<void> {
    const frame = await this.captureFrame();
    if (frame?.canvasOut) {
      this.lastSentAt = Date.now();
      await this.send(frame.canvasOut, 'manual', frame, undefined);
    }
  }

  public get cadence(): MirrorCadence { return this.currentCadence; }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}
