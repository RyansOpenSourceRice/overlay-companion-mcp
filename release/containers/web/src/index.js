/**
 * ⚠️ DEPRECATED: Overlay Companion MCP - Web Frontend (Guacamole-based)
 *
 * This frontend is DEPRECATED in favor of the KasmVNC-based version.
 *
 * ⚠️ WARNING: This frontend uses deprecated Guacamole architecture.
 * Use the KasmVNC-based frontend instead for:
 * ✅ No database required
 * ✅ True multi-monitor support
 * ✅ Modern WebSocket/WebRTC protocols
 * ✅ Simpler configuration
 *
 * This frontend provides:
 * - Guacamole-based remote desktop access to Fedora Silverblue VM (DEPRECATED)
 * - MCP configuration management with copy-to-clipboard functionality
 * - WebSocket overlay system for AI-assisted screen interaction
 * - Status monitoring and health checks
 */

import './styles/main.css';
import DOMPurify from 'dompurify';
import he from 'he';
import GuacamoleClient from './components/GuacamoleClient';
import MCPConfigManager from './components/MCPConfigManager';
import OverlaySystem from './components/OverlaySystem';
import StatusMonitor from './components/StatusMonitor';

class OverlayCompanionApp {
    constructor() {
        this.guacamoleClient = null;
        this.mcpConfigManager = null;
        this.overlaySystem = null;
        this.statusMonitor = null;
        this.websocket = null;

        this.init();
    }

    async init() {
        console.warn('⚠️ DEPRECATION WARNING: This Guacamole-based frontend is DEPRECATED');
        console.warn('Use the KasmVNC-based version for better multi-monitor support and simpler setup');
        console.log('🚀 Initializing Overlay Companion MCP (DEPRECATED Guacamole version)');

        try {
            // Initialize components
            await this.initializeComponents();

            // Setup WebSocket connection
            await this.setupWebSocket();

            // Render the application
            this.render();

            // Start status monitoring
            this.statusMonitor.start();

            console.log('✅ Overlay Companion MCP initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize application:', error);
            this.showError('Failed to initialize application', error.message);
        }
    }

    async initializeComponents() {
        // Initialize status monitor first
        this.statusMonitor = new StatusMonitor();

        // Initialize MCP configuration manager
        this.mcpConfigManager = new MCPConfigManager();

        // Initialize overlay system
        this.overlaySystem = new OverlaySystem();

        // Initialize Guacamole client
        this.guacamoleClient = new GuacamoleClient({
            onConnect: () => this.onGuacamoleConnect(),
            onDisconnect: () => this.onGuacamoleDisconnect(),
            onError: (error) => this.onGuacamoleError(error)
        });
    }

    async setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

        this.websocket = new WebSocket(wsUrl);

        this.websocket.onopen = () => {
            console.log('✅ WebSocket connected');
            this.updateConnectionStatus('connected');
        };

        this.websocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleWebSocketMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        this.websocket.onclose = (event) => {
            console.log('🔌 WebSocket disconnected:', event.code, event.reason);
            this.updateConnectionStatus('disconnected');

            // Attempt to reconnect after 5 seconds
            setTimeout(() => this.setupWebSocket(), 5000);
        };

        this.websocket.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            this.updateConnectionStatus('error');
        };
    }

    handleWebSocketMessage(message) {
        console.log('📨 WebSocket message:', message);

        switch (message.type) {
            case 'welcome':
                console.log('👋 Welcome message received:', message.message);
                break;

            case 'overlay_broadcast':
                this.overlaySystem.handleOverlayCommand(message.payload);
                break;

            case 'server_shutdown':
                this.showNotification('Server is shutting down', 'warning');
                break;

            default:
                console.log('Unknown WebSocket message type:', message.type);
        }
    }

    onGuacamoleConnect() {
        console.log('✅ Guacamole connected');
        this.updateConnectionStatus('guacamole-connected');
        this.showNotification('Connected to Fedora Silverblue VM', 'success');
    }

    onGuacamoleDisconnect() {
        console.log('🔌 Guacamole disconnected');
        this.updateConnectionStatus('guacamole-disconnected');
        this.showNotification('Disconnected from VM', 'info');
    }

    onGuacamoleError(error) {
        console.error('❌ Guacamole error:', error);
        this.showNotification('VM connection error', 'error');
    }

    render() {
        const app = document.getElementById('app');

        app.innerHTML = `
            <div class="app-container">
                <!-- Header -->
                <header class="app-header">
                    <div class="header-content">
                        <h1 class="app-title">
                            <span class="title-icon">🎯</span>
                            Overlay Companion MCP
                        </h1>
                        <div class="header-actions">
                            <div id="connection-status" class="connection-status">
                                <span class="status-indicator"></span>
                                <span class="status-text">Connecting...</span>
                            </div>
                            <button id="mcp-config-btn" class="btn btn-primary">
                                📋 Copy MCP Config
                            </button>
                        </div>
                    </div>
                </header>

                <!-- Main Content -->
                <main class="app-main">
                    <!-- VM Display Area -->
                    <div class="vm-container">
                        <div id="guacamole-display" class="guacamole-display">
                            <div class="vm-loading">
                                <div class="loading-spinner"></div>
                                <p>Connecting to Fedora Silverblue VM...</p>
                            </div>
                        </div>

                        <!-- Overlay Canvas -->
                        <canvas id="overlay-canvas" class="overlay-canvas"></canvas>
                    </div>

                    <!-- Side Panel -->
                    <aside class="side-panel">
                        <div class="panel-section">
                            <h3>🖥️ VM Status</h3>
                            <div id="vm-status" class="status-display">
                                <div class="status-item">
                                    <span class="label">Connection:</span>
                                    <span class="value" id="vm-connection-status">Connecting...</span>
                                </div>
                                <div class="status-item">
                                    <span class="label">Resolution:</span>
                                    <span class="value" id="vm-resolution">1920x1080</span>
                                </div>
                            </div>
                        </div>

                        <div class="panel-section">
                            <h3>🔌 MCP Integration</h3>
                            <div id="mcp-status" class="status-display">
                                <div class="status-item">
                                    <span class="label">WebSocket:</span>
                                    <span class="value" id="ws-status">Connecting...</span>
                                </div>
                                <div class="status-item">
                                    <span class="label">Overlay System:</span>
                                    <span class="value" id="overlay-status">Ready</span>
                                </div>
                            </div>

                            <div class="mcp-actions">
                                <button id="test-overlay-btn" class="btn btn-secondary">
                                    🎨 Test Overlay
                                </button>
                                <button id="clear-overlay-btn" class="btn btn-secondary">
                                    🧹 Clear Overlay
                                </button>
                            </div>
                        </div>

                        <div class="panel-section">
                            <h3>📊 System Info</h3>
                            <div id="system-info" class="status-display">
                                <div class="status-item">
                                    <span class="label">Uptime:</span>
                                    <span class="value" id="system-uptime">Loading...</span>
                                </div>
                                <div class="status-item">
                                    <span class="label">Memory:</span>
                                    <span class="value" id="system-memory">Loading...</span>
                                </div>
                            </div>
                        </div>
                    </aside>
                </main>

                <!-- Footer -->
                <footer class="app-footer">
                    <div class="footer-content">
                        <span class="footer-text">
                            AI-assisted screen interaction • Single-user development package
                        </span>
                        <div class="footer-links">
                            <a href="/health" target="_blank">Health Check</a>
                            <a href="https://github.com/RyansOpenSourceRice/overlay-companion-mcp" target="_blank">GitHub</a>
                        </div>
                    </div>
                </footer>

                <!-- Notification Container -->
                <div id="notifications" class="notifications-container"></div>

                <!-- MCP Config Modal -->
                <div id="mcp-config-modal" class="modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h2>MCP Configuration for Cherry Studio</h2>
                            <button class="modal-close">&times;</button>
                        </div>
                        <div class="modal-body">
                            <p>Copy this JSON configuration and paste it into Cherry Studio's MCP settings:</p>
                            <div class="config-container">
                                <pre id="mcp-config-json" class="config-json"></pre>
                                <button id="copy-config-btn" class="btn btn-primary">
                                    📋 Copy to Clipboard
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Attach event listeners
        this.attachEventListeners();

        // Initialize components with DOM elements
        this.guacamoleClient.initialize(document.getElementById('guacamole-display'));
        this.overlaySystem.initialize(document.getElementById('overlay-canvas'));
        this.mcpConfigManager.initialize();
    }

    attachEventListeners() {
        // MCP Config button
        document.getElementById('mcp-config-btn').addEventListener('click', () => {
            this.mcpConfigManager.showConfigModal();
        });

        // Test overlay button
        document.getElementById('test-overlay-btn').addEventListener('click', () => {
            this.overlaySystem.testOverlay();
        });

        // Clear overlay button
        document.getElementById('clear-overlay-btn').addEventListener('click', () => {
            this.overlaySystem.clearOverlay();
        });

        // Modal close
        document.querySelector('.modal-close').addEventListener('click', () => {
            this.mcpConfigManager.hideConfigModal();
        });

        // Copy config button
        document.getElementById('copy-config-btn').addEventListener('click', () => {
            this.mcpConfigManager.copyConfigToClipboard();
        });

        // Close modal when clicking outside
        document.getElementById('mcp-config-modal').addEventListener('click', (e) => {
            if (e.target.id === 'mcp-config-modal') {
                this.mcpConfigManager.hideConfigModal();
            }
        });
    }

    updateConnectionStatus(status) {
        const statusElement = document.getElementById('connection-status');
        const indicator = statusElement.querySelector('.status-indicator');
        const text = statusElement.querySelector('.status-text');

        // Remove existing status classes
        statusElement.className = 'connection-status';

        switch (status) {
            case 'connected':
                statusElement.classList.add('status-connected');
                text.textContent = 'Connected';
                break;
            case 'disconnected':
                statusElement.classList.add('status-disconnected');
                text.textContent = 'Disconnected';
                break;
            case 'error':
                statusElement.classList.add('status-error');
                text.textContent = 'Connection Error';
                break;
            case 'guacamole-connected':
                statusElement.classList.add('status-connected');
                text.textContent = 'VM Connected';
                break;
            case 'guacamole-disconnected':
                statusElement.classList.add('status-warning');
                text.textContent = 'VM Disconnected';
                break;
            default:
                statusElement.classList.add('status-connecting');
                text.textContent = 'Connecting...';
        }
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;

        const icon = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        }[type] || 'ℹ️';

        // Sanitize message content to prevent XSS
        const sanitizedMessage = he.encode(message);
        const safeHTML = DOMPurify.sanitize(`
            <span class="notification-icon">${icon}</span>
            <span class="notification-message">${sanitizedMessage}</span>
            <button class="notification-close">&times;</button>
        `);

        notification.innerHTML = safeHTML;

        // Add close functionality
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.remove();
        });

        container.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    showError(title, message) {
        const app = document.getElementById('app');
        app.innerHTML = `
            <div class="error-screen">
                <div class="error-content">
                    <h1>❌ ${title}</h1>
                    <p>${message}</p>
                    <button onclick="location.reload()" class="btn btn-primary">
                        🔄 Reload Application
                    </button>
                </div>
            </div>
        `;
    }
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.overlayCompanionApp = new OverlayCompanionApp();
});
