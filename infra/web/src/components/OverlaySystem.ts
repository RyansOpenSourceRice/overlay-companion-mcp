/**
 * Overlay System Component
 * Handles overlay rendering and WebSocket-based overlay commands from MCP clients
 */

export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CircleBounds {
  x: number;
  y: number;
  radius: number;
}

export interface ArrowBounds {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export type OverlayBounds = RectBounds | CircleBounds | ArrowBounds;

export interface OverlayData {
  id: string;
  type: 'rectangle' | 'circle' | 'highlight' | 'arrow' | string;
  bounds: OverlayBounds;
  color?: string;
  opacity?: number;
  label?: string;
  timestamp: number;
}

export interface OverlayCommand {
  type: 'draw' | 'clear' | 'remove' | string;
  id?: string;
  data?: OverlayData;
}

type OverlayType = 'rectangle' | 'circle' | 'highlight' | 'arrow';

export default class OverlaySystem {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private overlays: Map<string, OverlayData> = new Map();
  private animationFrame: number | null = null;
  private isInitialized = false;

  initialize(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    if (!this.canvas) {
      console.error('❌ Overlay canvas not found');
      return;
    }

    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) {
      console.error('❌ Unable to get 2D rendering context');
      return;
    }
    this.setupCanvas();
    this.startRenderLoop();
    this.isInitialized = true;

    console.log('✅ Overlay system initialized');
    this.updateStatus('Ready');
  }

  setupCanvas(): void {
    // Set canvas size to match container
    this.resizeCanvas();

    // Handle window resize
    window.addEventListener('resize', () => {
      this.resizeCanvas();
    });

    // Set up canvas properties
    if (this.ctx) {
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
    }
  }

  resizeCanvas(): void {
    if (!this.canvas) return;
    const container = this.canvas.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();

    // Set canvas size
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;

    // Update canvas style
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    console.log(`📐 Canvas resized to ${rect.width}x${rect.height}`);
  }

  startRenderLoop(): void {
    const render = () => {
      this.renderOverlays();
      this.animationFrame = requestAnimationFrame(render);
    };

    render();
  }

  stopRenderLoop(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  renderOverlays(): void {
    if (!this.ctx || !this.canvas) return;

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Render all active overlays
    for (const overlay of this.overlays.values()) {
      this.renderOverlay(overlay);
    }
  }

  renderOverlay(overlay: OverlayData): void {
    if (!this.ctx) return;
    const { type, bounds, color, opacity, label, timestamp } = overlay;

    // Calculate age-based opacity fade
    const age = Date.now() - timestamp;
    const maxAge = 10000; // 10 seconds
    const ageFactor = Math.max(0, 1 - (age / maxAge));
    const finalOpacity = (opacity || 0.5) * ageFactor;

    if (finalOpacity <= 0.01) {
      // Remove expired overlay
      this.overlays.delete(overlay.id);
      return;
    }

    this.ctx.save();

    switch (type as OverlayType) {
      case 'rectangle':
        this.renderRectangle(bounds as RectBounds, color, finalOpacity, label);
        break;
      case 'circle':
        this.renderCircle(bounds as CircleBounds, color, finalOpacity, label);
        break;
      case 'highlight':
        this.renderHighlight(bounds as RectBounds, color, finalOpacity, label);
        break;
      case 'arrow':
        this.renderArrow(bounds as ArrowBounds, color, finalOpacity, label);
        break;
      default:
        this.renderRectangle(bounds as RectBounds, color, finalOpacity, label);
    }

    this.ctx.restore();
  }

  renderRectangle(bounds: RectBounds, color = '#ff0000', opacity = 0.5, label = ''): void {
    if (!this.ctx) return;
    const { x, y, width, height } = bounds;

    // Draw filled rectangle
    this.ctx.fillStyle = this.hexToRgba(color, opacity * 0.3);
    this.ctx.fillRect(x, y, width, height);

    // Draw border
    this.ctx.strokeStyle = this.hexToRgba(color, opacity);
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, width, height);

    // Draw label if provided
    if (label) {
      this.renderLabel(x, y - 5, label, color);
    }
  }

  renderCircle(bounds: CircleBounds, color = '#ff0000', opacity = 0.5, label = ''): void {
    if (!this.ctx) return;
    const { x, y, radius } = bounds;

    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, 2 * Math.PI);

    // Fill circle
    this.ctx.fillStyle = this.hexToRgba(color, opacity * 0.3);
    this.ctx.fill();

    // Stroke circle
    this.ctx.strokeStyle = this.hexToRgba(color, opacity);
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Draw label if provided
    if (label) {
      this.renderLabel(x, y - radius - 5, label, color);
    }
  }

  renderHighlight(bounds: RectBounds, color = '#ffff00', opacity = 0.7, label = ''): void {
    if (!this.ctx) return;
    const { x, y, width, height } = bounds;

    // Create pulsing effect
    const pulseOpacity = opacity * (0.5 + 0.5 * Math.sin(Date.now() * 0.005));

    // Draw highlight with glow effect
    this.ctx.shadowColor = color;
    this.ctx.shadowBlur = 10;
    this.ctx.fillStyle = this.hexToRgba(color, pulseOpacity * 0.4);
    this.ctx.fillRect(x, y, width, height);

    // Reset shadow
    this.ctx.shadowBlur = 0;

    // Draw border
    this.ctx.strokeStyle = this.hexToRgba(color, pulseOpacity);
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(x, y, width, height);

    // Draw label if provided
    if (label) {
      this.renderLabel(x, y - 5, label, color);
    }
  }

  renderArrow(bounds: ArrowBounds, color = '#00ff00', opacity = 0.8, label = ''): void {
    if (!this.ctx) return;
    const { startX, startY, endX, endY } = bounds;

    // Calculate arrow properties
    const angle = Math.atan2(endY - startY, endX - startX);
    const arrowLength = 15;
    const arrowAngle = Math.PI / 6;

    // Draw arrow line
    this.ctx.strokeStyle = this.hexToRgba(color, opacity);
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = 'round';

    this.ctx.beginPath();
    this.ctx.moveTo(startX, startY);
    this.ctx.lineTo(endX, endY);
    this.ctx.stroke();

    // Draw arrowhead
    this.ctx.beginPath();
    this.ctx.moveTo(endX, endY);
    this.ctx.lineTo(
      endX - arrowLength * Math.cos(angle - arrowAngle),
      endY - arrowLength * Math.sin(angle - arrowAngle)
    );
    this.ctx.moveTo(endX, endY);
    this.ctx.lineTo(
      endX - arrowLength * Math.cos(angle + arrowAngle),
      endY - arrowLength * Math.sin(angle + arrowAngle)
    );
    this.ctx.stroke();

    // Draw label if provided
    if (label) {
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      this.renderLabel(midX, midY - 10, label, color);
    }
  }

  renderLabel(x: number, y: number, text: string, color: string): void {
    if (!this.ctx) return;
    this.ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'bottom';

    // Measure text
    const metrics = this.ctx.measureText(text);
    const padding = 4;

    // Draw background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    this.ctx.fillRect(
      x - padding,
      y - metrics.actualBoundingBoxAscent - padding,
      metrics.width + padding * 2,
      metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + padding * 2
    );

    // Draw text
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillText(text, x, y);

    // Color is used only when drawing labels with distinct styling; kept for
    // callers that pass it through renderRectangle/renderCircle/etc.
    void color;
  }

  hexToRgba(hex: string, alpha = 1): string {
    // Convert hex color to rgba
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Handle overlay commands from WebSocket
  handleOverlayCommand(command: OverlayCommand): void {
    console.log('🎨 Overlay command received:', command);

    switch (command.type) {
      case 'draw':
        if (command.data) this.addOverlay(command.data);
        break;
      case 'clear':
        this.clearOverlay();
        break;
      case 'remove':
        if (command.id) this.removeOverlay(command.id);
        break;
      default:
        console.warn('Unknown overlay command type:', command.type);
    }

    this.updateStatus(`Active overlays: ${this.overlays.size}`);
  }

  addOverlay(overlayData: OverlayData): void {
    const overlay: OverlayData = {
      ...overlayData,
      timestamp: overlayData.timestamp ? new Date(overlayData.timestamp).getTime() : Date.now()
    };

    this.overlays.set(overlay.id, overlay);
    console.log(`✅ Added overlay: ${overlay.id}`);
  }

  removeOverlay(id: string): void {
    if (this.overlays.has(id)) {
      this.overlays.delete(id);
      console.log(`🗑️ Removed overlay: ${id}`);
    }
  }

  clearOverlay(): void {
    const count = this.overlays.size;
    this.overlays.clear();
    console.log(`🧹 Cleared ${count} overlays`);
    this.updateStatus('Ready');
  }

  // Test overlay functionality
  testOverlay(): void {
    const testOverlays: OverlayData[] = [
      {
        id: `test-rect-${Date.now()}`,
        type: 'rectangle',
        bounds: { x: 100, y: 100, width: 200, height: 150 },
        color: '#ff0000',
        opacity: 0.6,
        label: 'Test Rectangle',
        timestamp: Date.now()
      },
      {
        id: `test-circle-${Date.now() + 1}`,
        type: 'circle',
        bounds: { x: 400, y: 200, radius: 75 },
        color: '#00ff00',
        opacity: 0.5,
        label: 'Test Circle',
        timestamp: Date.now()
      },
      {
        id: `test-highlight-${Date.now() + 2}`,
        type: 'highlight',
        bounds: { x: 150, y: 300, width: 300, height: 50 },
        color: '#ffff00',
        opacity: 0.7,
        label: 'Test Highlight',
        timestamp: Date.now()
      },
      {
        id: `test-arrow-${Date.now() + 3}`,
        type: 'arrow',
        bounds: { startX: 500, startY: 100, endX: 600, endY: 200 },
        color: '#0066ff',
        opacity: 0.8,
        label: 'Test Arrow',
        timestamp: Date.now()
      }
    ];

    testOverlays.forEach(overlay => {
      this.addOverlay(overlay);
    });

    console.log('🎨 Test overlays added');

    // Show notification
    if (window.overlayCompanionApp) {
      window.overlayCompanionApp.showNotification('Test overlays added - they will fade after 10 seconds', 'info');
    }
  }

  updateStatus(status: string): void {
    const statusElement = document.getElementById('overlay-status');
    if (statusElement) {
      statusElement.textContent = status;
    }
  }

  // Get overlay system status
  getStatus(): Record<string, unknown> {
    return {
      initialized: this.isInitialized,
      activeOverlays: this.overlays.size,
      canvasSize: this.canvas ? {
        width: this.canvas.width,
        height: this.canvas.height
      } : null,
      renderLoop: this.animationFrame !== null
    };
  }

  // Cleanup
  destroy(): void {
    this.stopRenderLoop();
    this.clearOverlay();
    this.isInitialized = false;
    console.log('🗑️ Overlay system destroyed');
  }
}
