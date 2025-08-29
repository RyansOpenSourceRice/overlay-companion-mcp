/**
 * Connection Manager for Overlay Companion MCP
 * 
 * Handles secure connection testing and proxy functionality
 * for various remote desktop protocols (KasmVNC, VNC, RDP)
 */

const net = require('net');
const http = require('http');
const https = require('https');

class ConnectionManager {
    constructor() {
        this.activeConnections = new Map();
    }

    /**
     * Test connection to a remote desktop server
     * @param {Object} connection - Connection configuration
     * @returns {Promise<Object>} Test result
     */
    async testConnection(connection) {
        const { host, port, protocol, ssl } = connection;
        
        try {
            switch (protocol) {
                case 'kasmvnc':
                    return await this.testKasmVNC(host, port, ssl);
                case 'vnc':
                    return await this.testVNC(host, port);
                case 'rdp':
                    return await this.testRDP(host, port);
                default:
                    throw new Error(`Unsupported protocol: ${protocol}`);
            }
        } catch (error) {
            return {
                success: false,
                error: error.message,
                protocol,
                host,
                port
            };
        }
    }

    /**
     * Test KasmVNC connection
     */
    async testKasmVNC(host, port, ssl = false) {
        const protocol = ssl ? 'https:' : 'http:';
        const url = `${protocol}//${host}:${port}/api/health`;
        
        return new Promise((resolve) => {
            const client = ssl ? https : http;
            const timeout = 5000;
            
            const req = client.get(url, { timeout }, (res) => {
                resolve({
                    success: res.statusCode === 200,
                    protocol: 'kasmvnc',
                    host,
                    port,
                    ssl,
                    statusCode: res.statusCode,
                    message: res.statusCode === 200 ? 'KasmVNC server is accessible' : `HTTP ${res.statusCode}`
                });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({
                    success: false,
                    protocol: 'kasmvnc',
                    host,
                    port,
                    ssl,
                    error: 'Connection timeout'
                });
            });

            req.on('error', (error) => {
                resolve({
                    success: false,
                    protocol: 'kasmvnc',
                    host,
                    port,
                    ssl,
                    error: error.message
                });
            });
        });
    }

    /**
     * Test VNC connection
     */
    async testVNC(host, port) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            const timeout = 5000;

            socket.setTimeout(timeout);

            socket.connect(port, host, () => {
                socket.destroy();
                resolve({
                    success: true,
                    protocol: 'vnc',
                    host,
                    port,
                    message: 'VNC server is accessible'
                });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({
                    success: false,
                    protocol: 'vnc',
                    host,
                    port,
                    error: 'Connection timeout'
                });
            });

            socket.on('error', (error) => {
                resolve({
                    success: false,
                    protocol: 'vnc',
                    host,
                    port,
                    error: error.message
                });
            });
        });
    }

    /**
     * Test RDP connection
     */
    async testRDP(host, port) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            const timeout = 5000;

            socket.setTimeout(timeout);

            socket.connect(port, host, () => {
                socket.destroy();
                resolve({
                    success: true,
                    protocol: 'rdp',
                    host,
                    port,
                    message: 'RDP server is accessible'
                });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({
                    success: false,
                    protocol: 'rdp',
                    host,
                    port,
                    error: 'Connection timeout'
                });
            });

            socket.on('error', (error) => {
                resolve({
                    success: false,
                    protocol: 'rdp',
                    host,
                    port,
                    error: error.message
                });
            });
        });
    }

    /**
     * Create a proxy URL for non-KasmVNC connections
     * This allows the web UI to connect to standard VNC/RDP servers
     * through a WebSocket proxy
     */
    createProxyUrl(connection) {
        const { host, port, protocol, ssl } = connection;
        const proxyId = `${protocol}-${host}-${port}-${Date.now()}`;
        
        this.activeConnections.set(proxyId, {
            ...connection,
            createdAt: new Date(),
            lastUsed: new Date()
        });

        // Clean up old connections (older than 1 hour)
        this.cleanupOldConnections();

        return `/proxy/${proxyId}`;
    }

    /**
     * Get connection details for a proxy ID
     */
    getProxyConnection(proxyId) {
        const connection = this.activeConnections.get(proxyId);
        if (connection) {
            connection.lastUsed = new Date();
            return connection;
        }
        return null;
    }

    /**
     * Clean up old proxy connections
     */
    cleanupOldConnections() {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        
        for (const [proxyId, connection] of this.activeConnections.entries()) {
            if (connection.lastUsed < oneHourAgo) {
                this.activeConnections.delete(proxyId);
            }
        }
    }

    /**
     * Get statistics about active connections
     */
    getStats() {
        return {
            activeProxies: this.activeConnections.size,
            connections: Array.from(this.activeConnections.values()).map(conn => ({
                protocol: conn.protocol,
                host: conn.host,
                port: conn.port,
                createdAt: conn.createdAt,
                lastUsed: conn.lastUsed
            }))
        };
    }

    /**
     * Validate connection configuration
     */
    validateConnection(connection) {
        const errors = [];

        if (!connection.host || typeof connection.host !== 'string') {
            errors.push('Host is required and must be a string');
        }

        if (!connection.port || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) {
            errors.push('Port must be a valid integer between 1 and 65535');
        }

        if (!connection.protocol || !['kasmvnc', 'vnc', 'rdp'].includes(connection.protocol)) {
            errors.push('Protocol must be one of: kasmvnc, vnc, rdp');
        }

        // Protocol-specific validation
        if (connection.protocol === 'rdp' && connection.port === 6901) {
            errors.push('RDP typically uses port 3389, not 6901');
        }

        if (connection.protocol === 'vnc' && connection.port === 3389) {
            errors.push('VNC typically uses ports 5900-5999, not 3389');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Get recommended settings for a protocol
     */
    getProtocolDefaults(protocol) {
        const defaults = {
            kasmvnc: {
                port: 6901,
                ssl: false,
                description: 'KasmVNC provides web-native remote desktop with multi-monitor support'
            },
            vnc: {
                port: 5901,
                ssl: false,
                description: 'Standard VNC protocol for remote desktop access'
            },
            rdp: {
                port: 3389,
                ssl: false,
                description: 'Microsoft Remote Desktop Protocol'
            }
        };

        return defaults[protocol] || {};
    }
}

module.exports = ConnectionManager;