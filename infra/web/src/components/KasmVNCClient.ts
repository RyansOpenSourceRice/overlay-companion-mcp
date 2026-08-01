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
        break;
      case 'clear':
        ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        break;
      case 'update':
        this.updateOverlay(ctx, command);
        break;
      default:
        console.warn('Unknown overlay command:', command.type);
    }
  }

  /**
   * Draw overlay on canvas
   */
  drawOverlay(ctx: CanvasRenderingContext2D, command: OverlayCommandData): void {
    ctx.save();

    // Set overlay properties
    ctx.fillStyle = command.color || '#ff0000';
    ctx.globalAlpha = command.opacity || 0.5;

    // Draw overlay rectangle
    ctx.fillRect(command.x ?? 0, command.y ?? 0, command.width ?? 0, command.height ?? 0);

    // Draw border if specified
    if (command.border) {
      ctx.strokeStyle = command.borderColor || '#ffffff';
      ctx.lineWidth = command.borderWidth || 2;
      ctx.strokeRect(command.x ?? 0, command.y ?? 0, command.width ?? 0, command.height ?? 0);
    }

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
