/**
 * Enhanced KasmVNC Client Component
 * 
 * Handles KasmVNC connections with:
 * - Secure credential management from web UI
 * - Multi-monitor support
 * - Real-time overlay integration
 * - Connection health monitoring
 */

export class KasmVNCClient {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            autoScale: true,
            showCursor: true,
            multiMonitor: true,
            overlaySupport: true,
            ...options
        };
        
        this.connection = null;
        this.iframe = null;
        this.isConnected = false;
        this.monitors = [];
        this.overlayCanvas = null;
        this.healthCheckInterval = null;
        
        console.log('🖥️ Enhanced KasmVNC Client initialized with credential management');
    }

    /**
     * Connect to KasmVNC server using web UI credentials
     * @param {Object} connectionConfig - Connection configuration from web UI
     */
    async connect(connectionConfig) {
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
            this.onError(error);
            throw error;
        }
    }

    /**
     * Validate connection configuration
     */
    validateConnection(config) {
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
    buildConnectionUrl(config) {
        const protocol = config.ssl ? 'https' : 'http';
        let url = `${protocol}://${config.host}:${config.port}`;
        
        // For KasmVNC, we can pass credentials via URL parameters
        const params = new URLSearchParams();
        
        if (config.username) {
            params.set('username', config.username);
        }
        
        // Note: In production, consider using a more secure method
        // like session tokens instead of passing passwords in URLs
        params.set('password', config.password);
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
    async createIframe(url) {
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
                this.onError(error);
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
    async setupMultiMonitor() {
        try {
            const protocol = this.connection.ssl ? 'https' : 'http';
            const apiUrl = `${protocol}://${this.connection.host}:${this.connection.port}/api/displays`;
            
            // Add authentication headers if needed
            const headers = {};
            if (this.connection.username && this.connection.password) {
                const auth = btoa(`${this.connection.username}:${this.connection.password}`);
                headers['Authorization'] = `Basic ${auth}`;
            }
            
            const response = await fetch(apiUrl, { headers });
            
            if (response.ok) {
                this.monitors = await response.json();
                console.log(`🖥️ Detected ${this.monitors.length} monitors via KasmVNC API`);
                this.onMonitorsDetected(this.monitors);
            } else {
                throw new Error(`API request failed: ${response.status}`);
            }
        } catch (error) {
            console.warn('⚠️ Could not query KasmVNC displays, using fallback:', error.message);
            
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
    setupOverlaySystem() {
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
                this.handleOverlayCommand(event.data.command);
            }
        });
        
        console.log('🎯 Overlay system initialized');
    }

    /**
     * Handle overlay commands from MCP server
     */
    handleOverlayCommand(command) {
        if (!this.overlayCanvas) return;
        
        const ctx = this.overlayCanvas.getContext('2d');
        
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
    drawOverlay(ctx, command) {
        ctx.save();
        
        // Set overlay properties
        ctx.fillStyle = command.color || '#ff0000';
        ctx.globalAlpha = command.opacity || 0.5;
        
        // Draw overlay rectangle
        ctx.fillRect(command.x, command.y, command.width, command.height);
        
        // Draw border if specified
        if (command.border) {
            ctx.strokeStyle = command.borderColor || '#ffffff';
            ctx.lineWidth = command.borderWidth || 2;
            ctx.strokeRect(command.x, command.y, command.width, command.height);
        }
        
        // Draw label if provided
        if (command.label) {
            ctx.fillStyle = command.textColor || '#ffffff';
            ctx.font = `${command.fontSize || 14}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(
                command.label,
                command.x + command.width / 2,
                command.y + command.height / 2
            );
        }
        
        ctx.restore();
    }

    /**
     * Update existing overlay
     */
    updateOverlay(ctx, command) {
        // For now, just redraw - could be optimized for specific updates
        this.drawOverlay(ctx, command);
    }

    /**
     * Start health monitoring
     */
    startHealthMonitoring() {
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
    async checkHealth() {
        if (!this.connection) return false;
        
        try {
            const protocol = this.connection.ssl ? 'https' : 'http';
            const healthUrl = `${protocol}://${this.connection.host}:${this.connection.port}/api/health`;
            
            const response = await fetch(healthUrl, {
                method: 'GET',
                timeout: 5000
            });
            
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Disconnect from KasmVNC
     */
    disconnect() {
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
    getStatus() {
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
    toggleFullscreen() {
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
    onConnected() {
        // Override in implementation
    }

    onDisconnected() {
        // Override in implementation
    }

    onError(error) {
        // Override in implementation
    }

    onMonitorsDetected(monitors) {
        // Override in implementation
    }

    onHealthCheckFailed() {
        // Override in implementation
    }
}