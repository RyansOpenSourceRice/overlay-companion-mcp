/**
 * Enhanced KasmVNC Client Component
 *
 * Handles KasmVNC connections with:
 * - Secure credential management from web UI
 * - Multi-monitor support
 * - Real-time overlay integration
 * - Connection health monitoring
 */

export interface KasmVNCConnectionConfig {
  name?: string;
  host: string;
  port: number;
  protocol: string;
  ssl: boolean;
  username?: string;
  password?: string;
}

export interface KasmVNCOptions {
  autoScale?: boolean;
  showCursor?: boolean;
  multiMonitor?: boolean;
  overlaySupport?: boolean;
}

export interface MonitorInfo {
  index: number;
  width: number;
  height: number;
  x: number;
  y: number;
  primary: boolean;
  name: string;
}

export interface OverlayCommandData {
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  opacity?: number;
  label?: string;
  border?: boolean;
  borderColor?: string;
  borderWidth?: number;
  textColor?: string;
  fontSize?: number;
  // Template-backed overlays (template_overlay tool)
  template?: string;
  template_params?: Record<string, unknown>;
  svg?: string;
  accessible_name?: string;
  object_data?: unknown;
}

export class KasmVNCClient {
  private container: HTMLElement;
  private options: KasmVNCOptions;
  private connection: KasmVNCConnectionConfig | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private isConnected = false;
  private monitors: MonitorInfo[] = [];
  private overlayCanvas: HTMLCanvasElement | null = null;
  private healthCheckInterval: number | null = null;

  constructor(container: HTMLElement, options: KasmVNCOptions = {}) {
    this.container = container;
    this.options = {
      autoScale: true,
      showCursor: true,
      multiMonitor: true,
      overlaySupport: true,
      ...options
    };

    console.log('🖥️ Enhanced KasmVNC Client initialized with credential management');
  }

  /**
   * Connect to KasmVNC server using web UI credentials
   */
  async connect(connectionConfig: KasmVNCConnectionConfig): Promise<void> {
    try {
      console.log('🔌 Connecting to KasmVNC with secure credentials:', connectionConfig.host);

      // Validate connection config
      this.validateConnection(connectionConfig);
      this.connection = connectionConfig;

      // Build KasmVNC URL with authentication
      const url = this.buildConnectionUrl(connectionConfig);

      // Create and configure iframe
      await this.createIframe(url);

      // Setup multi-monitor support
      if (this.options.multiMonitor) {
        await this.setupMultiMonitor();
      }

      // Setup overlay system
      if (this.options.overlaySupport) {
        this.setupOverlaySystem();
      }

      // Start health monitoring
      this.startHealthMonitoring();

    } catch (error) {
      console.error('❌ KasmVNC connection error:', error);
      this.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Validate connection configuration
   */
  validateConnection(config: KasmVNCConnectionConfig): void {
    if (!config.host || !config.port) {
      throw new Error('Host and port are required');
    }

    if (!config.password) {
      throw new Error('Password is required for KasmVNC connection');
    }

    if (config.port < 1 || config.port > 65535) {
      throw new Error('Port must be between 1 and 65535');
    }
  }

  /**
   * Build connection URL with embedded credentials
   */
  buildConnectionUrl(config: KasmVNCConnectionConfig): string {
    const protocol = config.ssl ? 'https' : 'http';
    let url = `${protocol}://${config.host}:${config.port}`;

    // For KasmVNC, we can pass credentials via URL parameters
    const params = new URLSearchParams();

    if (config.username) {
      params.set('username', config.username);
    }

    // Note: In production, consider using a more secure method
    // like session tokens instead of passing passwords in URLs
    params.set('password', config.password ?? '');
    params.set('autoconnect', 'true');
    params.set('resize', this.options.autoScale ? 'scale' : 'off');
    params.set('show_cursor', this.options.showCursor ? '1' : '0');

    if (params.toString()) {
      url += '?' + params.toString();
    }

    return url;
  }

  /**
   * Create and configure iframe
   */
  async createIframe(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.iframe = document.createElement('iframe');
      this.iframe.src = url;
      this.iframe.style.width = '100%';
      this.iframe.style.height = '100%';
      this.iframe.style.border = 'none';
      this.iframe.style.background = '#000';
      this.iframe.allow = 'clipboard-read; clipboard-write; fullscreen';

      // Timeout handler
      const timeout = setTimeout(() => {
        if (!this.isConnected) {
          const error = new Error('Connection timeout');
          this.onError(error);
          reject(error);
        }
      }, 30000); // 30 second timeout

      this.iframe.onload = () => {
        clearTimeout(timeout);
        this.isConnected = true;
        console.log('✅ KasmVNC connected successfully');
        this.onConnected();
        resolve();
      };

      this.iframe.onerror = (error) => {
        clearTimeout(timeout);
        console.error('❌ KasmVNC iframe error:', error);
        this.onError(new Error('KasmVNC iframe error'));
        reject(error);
      };

      // Clear container and add iframe
      this.container.innerHTML = '';
      this.container.appendChild(this.iframe);
    });
  }

  /**
   * Setup multi-monitor support with KasmVNC API
   */
  async setupMultiMonitor(): Promise<void> {
    if (!this.connection) return;

    try {
      const protocol = this.connection.ssl ? 'https' : 'http';
      const apiUrl = `${protocol}://${this.connection.host}:${this.connection.port}/api/displays`;

      // Add authentication headers if needed
      const headers: Record<string, string> = {};
      if (this.connection.username && this.connection.password) {
        const auth = btoa(`${this.connection.username}:${this.connection.password}`);
        headers['Authorization'] = `Basic ${auth}`;
      }

      const response = await fetch(apiUrl, { headers });

      if (response.ok) {
        this.monitors = await response.json() as MonitorInfo[];
        console.log(`🖥️ Detected ${this.monitors.length} monitors via KasmVNC API`);
        this.onMonitorsDetected(this.monitors);
      } else {
        throw new Error(`API request failed: ${response.status}`);
      }
    } catch (error) {
      console.warn('⚠️ Could not query KasmVNC displays, using fallback:', error instanceof Error ? error.message : String(error));

      // Fallback to single monitor configuration
      this.monitors = [{
        index: 0,
        width: 1920,
        height: 1080,
        x: 0,
        y: 0,
        primary: true,
        name: 'Primary Display'
      }];

      this.onMonitorsDetected(this.monitors);
    }
  }

  /**
   * Setup overlay system for AI-powered screen interaction
   */
  setupOverlaySystem(): void {
    // Create overlay canvas
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.width = '100%';
    this.overlayCanvas.style.height = '100%';
    this.overlayCanvas.style.pointerEvents = 'none';
    this.overlayCanvas.style.zIndex = '10';

    // Add to container
    this.container.style.position = 'relative';
    this.container.appendChild(this.overlayCanvas);

    // Setup message listener for overlay commands
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'overlay_command') {
        this.handleOverlayCommand(event.data.command as OverlayCommandData);
      }
    });

    console.log('🎯 Overlay system initialized');
  }

  /**
   * Handle overlay commands from MCP server
   */
  handleOverlayCommand(command: OverlayCommandData): void {
    if (!this.overlayCanvas) return;

    const ctx = this.overlayCanvas.getContext('2d');
    if (!ctx) return;

    switch (command.type) {
      case 'create':
        this.drawOverlay(ctx, command);
        this.updateOverlayA11y(command, 'add');
        break;
      case 'clear':
        ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        this.updateOverlayA11y(null, 'clear');
        break;
      case 'update':
        this.updateOverlay(ctx, command);
        this.updateOverlayA11y(command, 'update');
        break;
      default:
        console.warn('Unknown overlay command:', command.type);
    }
  }

  /**
   * Maintain a queryable, screen-reader-accessible representation of active overlays.
   * Every overlay maps to an element in a hidden semantic tree (role + accessible
   * name + bounds), announced via an ARIA live region. This gives real a11y users a
   * usable annotation surface AND lets CI assert on semantic output deterministically.
   */
  private updateOverlayA11y(command: OverlayCommandData | null, action: 'add' | 'update' | 'clear' | 'remove'): void {
    let tree = document.getElementById('overlay-companion-a11y');
    if (!tree) {
      tree = document.createElement('section');
      tree.id = 'overlay-companion-a11y';
      tree.setAttribute('aria-label', 'Overlay annotations');
      tree.style.position = 'absolute';
      tree.style.width = '1px';
      tree.style.height = '1px';
      tree.style.overflow = 'hidden';
      tree.style.clip = 'rect(0 0 0 0)';
      tree.style.whiteSpace = 'nowrap';
      document.body.appendChild(tree);
    }
    // aria-live region announces newly added annotations to assistive tech.
    let live = document.getElementById('overlay-companion-live');
    if (!live) {
      live = document.createElement('div');
      live.id = 'overlay-companion-live';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('role', 'status');
      live.style.position = 'absolute';
      live.style.width = '1px';
      live.style.height = '1px';
      live.style.overflow = 'hidden';
      live.style.clip = 'rect(0 0 0 0)';
      document.body.appendChild(live);
    }

    if (action === 'clear') {
      tree.replaceChildren();
      return;
    }

    if (!command) return;

    const name = command.accessible_name ?? command.label ?? command.template ?? 'annotation';
    const key = `${command.type}-${command.x ?? 0}-${command.y ?? 0}-${command.width ?? 0}-${command.height ?? 0}`;
    let node = tree.querySelector(`[data-overlay-a11y][data-overlay-id="${key}"]`) as HTMLElement | null;
    if (action === 'update' && !node || action === 'add') {
      node = document.createElement('div');
      node.setAttribute('data-overlay-id', key);
      node.setAttribute('data-overlay-a11y', 'true');
      node.setAttribute('role', command.template ? 'region' : 'img');
      node.setAttribute('aria-label', name);
      node.setAttribute('data-x', String(command.x ?? 0));
      node.setAttribute('data-y', String(command.y ?? 0));
      node.setAttribute('data-width', String(command.width ?? 0));
      node.setAttribute('data-height', String(command.height ?? 0));
      node.setAttribute('data-template', command.template ?? '');
      tree.appendChild(node);
      if (live) { live.textContent = `Annotation: ${name}`; }
    } else if (node) {
      node.setAttribute('aria-label', name);
    }
  }

  /**
   * Draw overlay on canvas
   */
  drawOverlay(ctx: CanvasRenderingContext2D, command: OverlayCommandData): void {
    ctx.save();

    // Template-backed overlays render via a named routine; geometry passthrough
    // (rectangle/circle/highlight/arrow) uses the existing primitives.
    if (command.template) {
      this.drawTemplate(ctx, command);
      ctx.restore();
      return;
    }

    // Legacy bare overlay (no template).
    ctx.fillStyle = command.color || '#ff0000';
    ctx.globalAlpha = command.opacity || 0.5;
    ctx.fillRect(command.x ?? 0, command.y ?? 0, command.width ?? 0, command.height ?? 0);
    this.drawBorder(ctx, command);

    // Draw label if provided
    if (command.label) {
      ctx.fillStyle = command.textColor || '#ffffff';
      ctx.font = `${command.fontSize || 14}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        command.label,
        (command.x ?? 0) + (command.width ?? 0) / 2,
        (command.y ?? 0) + (command.height ?? 0) / 2
      );
    }

    ctx.restore();
  }

  private drawBorder(ctx: CanvasRenderingContext2D, command: OverlayCommandData): void {
    if (command.border) {
      ctx.strokeStyle = command.borderColor || '#ffffff';
      ctx.lineWidth = command.borderWidth || 2;
      ctx.strokeRect(command.x ?? 0, command.y ?? 0, command.width ?? 0, command.height ?? 0);
    }
  }

  /**
   * Render a named template overlay (text/button/region/rectangle/circle/highlight/arrow/svg/object).
   * Text templates support multi-line and centered-in-box layout.
   */
  private drawTemplate(ctx: CanvasRenderingContext2D, command: OverlayCommandData): void {
    const p = command.template_params ?? {};
    const x = numOf(p, 'x', command.x ?? 0) + (p.xOffset as number | undefined ?? 0);
    const y = numOf(p, 'y', command.y ?? 0) + (p.yOffset as number | undefined ?? 0);
    const width = (numOf(p, 'width', command.width ?? numOf(p, 'endX', x) - numOf(p, 'startX', x)) || 120);
    const height = numOf(p, 'height', command.height ?? 120);
    const color = strOf(p, 'color', command.color ?? '#ff0000');
    const opacity = numOf(p, 'opacity', command.opacity ?? 0.85);
    const text = strOf(p, 'text', command.label ?? command.accessible_name ?? '');
    const size = numOf(p, 'size', command.fontSize ?? 14);

    ctx.globalAlpha = opacity;
    ctx.font = `${strOf(p, 'bold', '') === 'true' || p.bold === true ? 'bold ' : ''}${size}px ${strOf(p, 'font', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif')}`;

    switch (command.template) {
      case 'text':
        this.renderTextTemplate(ctx, command, x, y, width, height, color, text, size);
        break;
      case 'button':
        this.renderButtonTemplate(ctx, command, x, y, width, height, color, text, size);
        break;
      case 'region':
        this.renderRegionTemplate(ctx, x, y, width, height, color, text);
        break;
      case 'rectangle':
        this.renderShapeRect(ctx, x, y, width, height, color, text);
        break;
      case 'circle': {
        const r = numOf(p, 'radius', 50);
        this.renderShapeCircle(ctx, x, y, r, color, text);
        break;
      }
      case 'highlight':
        this.renderHighlight(ctx, x, y, width, height, color, text);
        break;
      case 'arrow': {
        const sx = numOf(p, 'startX', x);
        const sy = numOf(p, 'startY', y);
        const ex = numOf(p, 'endX', sx + 100);
        const ey = numOf(p, 'endY', sy + 100);
        this.renderShapeArrow(ctx, sx, sy, ex, ey, color, text);
        break;
      }
      case 'svg':
        this.renderSvgTemplate(ctx, command, x, y);
        break;
      case 'object':
        this.renderObjectTemplate(command);
        break;
      default:
        console.warn('Unknown overlay template:', command.template);
    }
  }

  /**
   * Multi-line text, optionally centered inside a box (align/valign/background). Wrap by width.
   */
  private renderTextTemplate(
    ctx: CanvasRenderingContext2D,
    command: OverlayCommandData,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    text: string,
    size: number
  ): void {
    const p = command.template_params ?? {};
    const align = strOf(p, 'align', 'left');
    const valign = strOf(p, 'valign', 'top');
    const bg = p.background === true || strOf(p, 'background', '') === 'true';
    const bgColor = strOf(p, 'bg_color', 'rgba(0,0,0,0.75)');
    const pad = numOf(p, 'padding', 4);

    if (!text) {
      // Even without text, honor the background box so a region is visible.
      if (bg) { fillBox(ctx, x, y, width, height, bgColor); }
      return;
    }

    const lines = wrapText(ctx, text, Math.max(40, width - pad * 2));
    const lineHeight = size * 1.35;
    const blockH = lines.length * lineHeight;
    const blockW = Math.max(...lines.map((l) => ctx.measureText(l).width));

    // Background box sizing.
    const boxW = Math.max(width > 0 ? width : blockW + pad * 2, blockW + pad * 2);
    const boxH = Math.max(height > 0 ? height : blockH + pad * 2, blockH + pad * 2);
    if (bg) { fillBox(ctx, x, y, boxW, boxH, bgColor); }

    ctx.textBaseline = 'top';
    const originX =
      align === 'center' ? x + boxW / 2 :
      align === 'right' ? x + boxW - pad : x + pad;
    ctx.textAlign = align as CanvasTextAlign;
    const originY = valign === 'middle' ? y + (boxH - blockH) / 2 :
      valign === 'bottom' ? y + boxH - blockH - pad : y + pad;

    ctx.fillStyle = color;
    lines.forEach((line, i) => {
      ctx.fillText(line, originX, originY + i * lineHeight);
    });

    void command;
  }

  private renderButtonTemplate(
    ctx: CanvasRenderingContext2D,
    command: OverlayCommandData,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    text: string,
    size: number
  ): void {
    const p = command.template_params ?? {};
    const bgColor = strOf(p, 'bg_color', 'rgba(0,0,0,0.70)');
    const w = width > 0 ? width : 140;
    const h = height > 0 ? height : size + 24;

    fillBox(ctx, x, y, w, h, bgColor);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    wrapText(ctx, text, w - 12).forEach((line, i) => {
      const lineH = size * 1.3;
      ctx.fillText(line, x + w / 2, y + h / 2 + (i - (wrapText(ctx, text, w - 12).length - 1) / 2) * lineH);
    });
  }

  private renderRegionTemplate(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    text: string
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    if (text) {
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(text, x + 4, y + 4);
    }
  }

  private renderShapeRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string, text: string): void {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
    renderCenteredLabel(ctx, x, y, width, height, text, color);
  }

  private renderShapeCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, text: string): void {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    renderCenteredLabel(ctx, x - r, y - r, r * 2, r * 2, text, color);
  }

  private renderHighlight(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string, text: string): void {
    const pulse = 0.6 + 0.4 * Math.sin(Date.now() * 0.005);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.globalAlpha *= pulse;
    ctx.strokeRect(x - 3, y - 3, width + 6, height + 6);
    renderCenteredLabel(ctx, x, y, width, height, text, color);
  }

  private renderShapeArrow(ctx: CanvasRenderingContext2D, sx: number, sy: number, ex: number, ey: number, color: string, text: string): void {
    const angle = Math.atan2(ey - sy, ex - sx);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    const headLen = 12;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - headLen * Math.cos(angle - 0.4), ey - headLen * Math.sin(angle - 0.4));
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - headLen * Math.cos(angle + 0.4), ey - headLen * Math.sin(angle + 0.4));
    ctx.stroke();
    if (text) {
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(text, (sx + ex) / 2 + 6, (sy + ey) / 2 - 6);
    }
  }

  /**
   * Render raw SVG passthrough by injecting into a detached <svg> and drawing to canvas.
   */
  private renderSvgTemplate(ctx: CanvasRenderingContext2D, command: OverlayCommandData, x: number, y: number): void {
    const svg = command.svg;
    if (!svg) {
      console.warn('template=svg received without svg payload');
      return;
    }
    const p = command.template_params ?? {};
    const width = numOf(p, 'width', 200);
    const height = numOf(p, 'height', 200);
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    const img = new Image();
    img.onload = () => ctx.drawImage(img, x, y, width, height);
    img.onerror = () => console.warn('Failed to render SVG overlay');
    img.src = url;
  }

  /**
   * Opaque object passthrough — stored on the DOM for host render hooks / CI assertions.
   */
  private renderObjectTemplate(command: OverlayCommandData): void {
    const el = document.createElement('div');
    el.style.display = 'none';
    el.setAttribute('data-overlay-object', 'true');
    el.setAttribute('data-overlay-id', command.accessible_name ?? command.type);
    el.textContent = JSON.stringify(command.object_data ?? command.template_params ?? {});
    document.body.appendChild(el);
  }

  /**
   * Update existing overlay
   */
  updateOverlay(ctx: CanvasRenderingContext2D, command: OverlayCommandData): void {
    // For now, just redraw - could be optimized for specific updates
    this.drawOverlay(ctx, command);
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const isHealthy = await this.checkHealth();
        if (!isHealthy && this.isConnected) {
          console.warn('⚠️ KasmVNC health check failed');
          this.onHealthCheckFailed();
        }
      } catch (error) {
        console.error('❌ Health check error:', error);
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Check connection health
   */
  async checkHealth(): Promise<boolean> {
    if (!this.connection) return false;

    try {
      const protocol = this.connection.ssl ? 'https' : 'http';
      const healthUrl = `${protocol}://${this.connection.host}:${this.connection.port}/api/health`;

      const response = await fetch(healthUrl, {
        method: 'GET'
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Disconnect from KasmVNC
   */
  disconnect(): void {
    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Remove iframe
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }

    // Remove overlay canvas
    if (this.overlayCanvas) {
      this.overlayCanvas.remove();
      this.overlayCanvas = null;
    }

    // Reset state
    this.isConnected = false;
    this.connection = null;
    this.monitors = [];

    console.log('🔌 KasmVNC disconnected');
    this.onDisconnected();
  }

  /**
   * Get current connection status
   */
  getStatus(): Record<string, unknown> {
    return {
      connected: this.isConnected,
      connection: this.connection ? {
        name: this.connection.name,
        host: this.connection.host,
        port: this.connection.port,
        protocol: this.connection.protocol,
        ssl: this.connection.ssl
      } : null,
      monitors: this.monitors,
      client: 'KasmVNC Enhanced',
      features: {
        multiMonitor: this.options.multiMonitor,
        overlaySupport: this.options.overlaySupport,
        credentialManagement: true
      }
    };
  }

  /**
   * Toggle fullscreen mode
   */
  toggleFullscreen(): void {
    if (!this.iframe) return;

    if (!document.fullscreenElement) {
      this.container.requestFullscreen().catch(err => {
        console.error('Failed to enter fullscreen:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  /**
   * Event handlers (can be overridden)
   */
  onConnected(): void {
    // Override in implementation
  }

  onDisconnected(): void {
    // Override in implementation
  }

  onError(_error: Error): void {
    // Override in implementation
  }

  onMonitorsDetected(_monitors: MonitorInfo[]): void {
    // Override in implementation
  }

  onHealthCheckFailed(): void {
    // Override in implementation
  }
}

function numOf(p: Record<string, unknown>, key: string, fallback: number): number {
  const v = p[key];
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function strOf(p: Record<string, unknown>, key: string, fallback: string): string {
  const v = p[key];
  return typeof v === 'string' ? v : fallback;
}

function fillBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  if (text.includes('\n')) return text.split('\n');
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

function renderCenteredLabel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, text: string, color: string): void {
  if (!text) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y - 6);
  ctx.restore();
}
