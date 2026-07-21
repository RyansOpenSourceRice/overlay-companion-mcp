/**
 * MCP Configuration Manager
 * Handles MCP configuration generation and clipboard operations for Cherry Studio integration
 */

export default class MCPConfigManager {
    constructor() {
        this.config = null;
        this.modal = null;
    }

    initialize() {
        this.modal = document.getElementById('mcp-config-modal');
        this.loadConfiguration();
    }

    async loadConfiguration() {
        try {
            const response = await fetch('/mcp-config');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            this.config = await response.json();
            console.log('✅ MCP configuration loaded:', this.config);
        } catch (error) {
            console.error('❌ Failed to load MCP configuration:', error);

            // Fallback configuration
            this.config = this.generateFallbackConfig();
        }
    }

    generateFallbackConfig() {
        const host = window.location.host;
        const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
        const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

        return {
            mcp_version: '1.0',
            session_id: `overlay-companion-mcp-${Date.now()}`,
            mcp_ws_url: `${wsProtocol}://${host}/ws`,
            mcp_http_url: `${protocol}://${host}/mcp`,
            auth: {
                type: 'session',
                token: `dev-token-${Date.now()}`
            },
            desktop: {
                target: 'fedora-silverblue',
                viewport: {
                    w: 1920,
                    h: 1080,
                    devicePixelRatio: 1.0
                }
            },
            capabilities: {
                overlay_system: true,
                multi_monitor: true,
                click_through: true,
                websocket_streaming: true
            },
            notes: 'Single-user dev package. Copy this JSON into Cherry Studio MCP slot.'
        };
    }

    showConfigModal() {
        if (!this.modal) return;

        // Update configuration display
        const configJson = document.getElementById('mcp-config-json');
        if (configJson && this.config) {
            configJson.textContent = JSON.stringify(this.config, null, 2);
        }

        // Show modal
        this.modal.classList.add('show');

        // Focus on the copy button
        setTimeout(() => {
            const copyButton = document.getElementById('copy-config-btn');
            if (copyButton) {
                copyButton.focus();
            }
        }, 100);
    }

    hideConfigModal() {
        if (!this.modal) return;
        this.modal.classList.remove('show');
    }

    async copyConfigToClipboard() {
        if (!this.config) {
            this.showNotification('Configuration not available', 'error');
            return;
        }

        const configText = JSON.stringify(this.config, null, 2);

        try {
            // Try modern clipboard API first
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(configText);
                this.showNotification('✅ MCP configuration copied to clipboard!', 'success');
            } else {
                // Fallback for older browsers or non-secure contexts
                this.fallbackCopyToClipboard(configText);
                this.showNotification('✅ MCP configuration copied to clipboard!', 'success');
            }

            // Update button text temporarily
            const copyButton = document.getElementById('copy-config-btn');
            if (copyButton) {
                const originalText = copyButton.innerHTML;
                copyButton.innerHTML = '✅ Copied!';
                copyButton.disabled = true;

                setTimeout(() => {
                    copyButton.innerHTML = originalText;
                    copyButton.disabled = false;
                }, 2000);
            }

            // Hide modal after successful copy
            setTimeout(() => {
                this.hideConfigModal();
            }, 1500);

        } catch (error) {
            console.error('Failed to copy to clipboard:', error);
            this.showNotification('❌ Failed to copy configuration', 'error');

            // Show manual copy instructions
            this.showManualCopyInstructions(configText);
        }
    }

    fallbackCopyToClipboard(text) {
        // Create a temporary textarea element
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);

        // Select and copy the text
        textArea.focus();
        textArea.select();

        try {
            document.execCommand('copy');
        } catch (error) {
            throw new Error('Fallback copy failed');
        } finally {
            document.body.removeChild(textArea);
        }
    }

    showManualCopyInstructions(configText) {
        // Create a modal with manual copy instructions
        const instructionsModal = document.createElement('div');
        instructionsModal.className = 'modal show';
        instructionsModal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Manual Copy Required</h2>
                    <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    <p>Please manually copy the configuration below:</p>
                    <div class="config-container">
                        <textarea readonly style="width: 100%; height: 200px; font-family: monospace; font-size: 12px; padding: 10px; border: 1px solid #ccc; border-radius: 4px;">${configText}</textarea>
                        <p style="margin-top: 10px; font-size: 14px; color: #666;">
                            Select all text above (Ctrl+A) and copy (Ctrl+C), then paste into Cherry Studio's MCP settings.
                        </p>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(instructionsModal);

        // Auto-select the text
        const textarea = instructionsModal.querySelector('textarea');
        setTimeout(() => {
            textarea.focus();
            textarea.select();
        }, 100);
    }

    showNotification(message, type = 'info') {
        // Use the global notification system
        if (window.overlayCompanionApp) {
            window.overlayCompanionApp.showNotification(message, type);
        } else {
            // Fallback notification
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    // Generate configuration for different MCP clients
    generateCherryStudioConfig() {
        return {
            ...this.config,
            client_type: 'cherry-studio',
            integration_notes: [
                '1. Copy this entire JSON configuration',
                '2. Open Cherry Studio settings',
                '3. Navigate to MCP (Model Context Protocol) section',
                '4. Add new MCP server configuration',
                '5. Paste this JSON into the configuration field',
                '6. Save and restart Cherry Studio',
                '7. The AI will now have access to screen interaction capabilities'
            ]
        };
    }

    generateGenericMCPConfig() {
        return {
            ...this.config,
            client_type: 'generic-mcp',
            setup_instructions: {
                websocket_url: this.config.mcp_ws_url,
                http_endpoint: this.config.mcp_http_url,
                authentication: this.config.auth,
                capabilities: this.config.capabilities
            }
        };
    }

    // Validate configuration
    validateConfiguration() {
        const required = ['mcp_version', 'session_id', 'mcp_ws_url', 'auth', 'desktop'];
        const missing = required.filter(field => !this.config[field]);

        if (missing.length > 0) {
            console.warn('Missing required configuration fields:', missing);
            return false;
        }

        // Validate WebSocket URL
        try {
            new URL(this.config.mcp_ws_url);
        } catch (error) {
            console.warn('Invalid WebSocket URL:', this.config.mcp_ws_url);
            return false;
        }

        return true;
    }

    // Get configuration status
    getConfigurationStatus() {
        return {
            loaded: !!this.config,
            valid: this.config ? this.validateConfiguration() : false,
            websocket_url: this.config?.mcp_ws_url,
            session_id: this.config?.session_id,
            capabilities: this.config?.capabilities || {}
        };
    }

    // Refresh configuration from server
    async refreshConfiguration() {
        console.log('🔄 Refreshing MCP configuration...');
        await this.loadConfiguration();

        // Update modal if it's open
        if (this.modal && this.modal.classList.contains('show')) {
            const configJson = document.getElementById('mcp-config-json');
            if (configJson && this.config) {
                configJson.textContent = JSON.stringify(this.config, null, 2);
            }
        }

        return this.config;
    }
}
