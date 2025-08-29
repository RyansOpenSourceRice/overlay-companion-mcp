/**
 * Connection Manager for Overlay Companion MCP
 * 
 * Handles secure connection testing and proxy functionality
 * for various remote desktop protocols (KasmVNC, VNC, RDP)
 * 
 * SECURITY: Implements SSRF protection with host validation
 */

const net = require('net');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const ipaddr = require('ipaddr.js');
const securityConfig = require('./security-config');

class ConnectionManager {
    constructor() {
        this.activeConnections = new Map();

        // SECURITY: Load explicit KasmVNC allowlist
        // Example format: { kasm1: { host: 'kasm1.example.com', port: 6901, ssl: true }, ... }
        this.kasmVncAllowlist = securityConfig.kasmVncAllowlist || {};
        
        // SECURITY: Load security configuration (legacy patterns, still used for other protocols)
        this.allowedHostPatterns = securityConfig.allowedHostPatterns;
        this.blockedHostPatterns = securityConfig.blockedHostPatterns;
        this.limits = securityConfig.limits;
        this.allowedProtocols = securityConfig.allowedProtocols;
        this.portRestrictions = securityConfig.portRestrictions;
        this.logging = securityConfig.logging;
        
        console.log('🔒 SECURITY: Connection manager initialized with explicit KasmVNC allowlist for SSRF protection');
        console.log(`🔒 SECURITY: ${Object.keys(this.kasmVncAllowlist).length} allowed KasmVNC targets configured`);
        console.log(`🔒 SECURITY: ${this.allowedHostPatterns.length} allowed host patterns configured`);
        console.log(`🔒 SECURITY: ${this.blockedHostPatterns.length} blocked host patterns configured`);
    }

    /**
     * SECURITY: Validate host to prevent SSRF attacks
     * @param {string} host - Host to validate
     * @returns {boolean} True if host is allowed
     */
    validateHost(host) {
        if (!host || typeof host !== 'string') {
            return false;
        }

        // Normalize host (remove protocol, port, path)
        let normalizedHost = host.toLowerCase().trim();
        
        // Remove protocol if present
        normalizedHost = normalizedHost.replace(/^https?:\/\//, '');
        
        // Remove port if present
        normalizedHost = normalizedHost.split(':')[0];
        
        // Remove path if present
        normalizedHost = normalizedHost.split('/')[0];

        // Check against blocked patterns first (security priority)
        for (const pattern of this.blockedHostPatterns) {
            if (pattern.test(normalizedHost)) {
                if (this.logging.logBlockedHosts) {
                    console.warn(`🚫 SECURITY: Blocked host access attempt: ${host} (matched pattern: ${pattern})`);
                }
                return false;
            }
        }

        // Check against allowed patterns
        for (const pattern of this.allowedHostPatterns) {
            if (pattern.test(normalizedHost)) {
                return true;
            }
        }

        // If no explicit allow pattern matches, check if it's a valid external host
        // Only allow well-formed hostnames/IPs that are not in private ranges
        const isValidExternalHost = this.isValidExternalHost(normalizedHost);
        if (!isValidExternalHost) {
            console.warn(`🚫 SECURITY: Invalid or private host rejected: ${host}`);
        }
        
        return isValidExternalHost;
    }

    /**
     * SECURITY: Check if host is a valid external host (not private/internal)
     * @param {string} host - Normalized host
     * @returns {boolean} True if valid external host
     */
    isValidExternalHost(host) {
        // Basic hostname/IP validation
        const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        
        if (!hostnameRegex.test(host) && !ipRegex.test(host)) {
            return false;
        }

        // If it's an IP, ensure it's not in private ranges (already checked in blockedHostPatterns)
        if (ipRegex.test(host)) {
            const parts = host.split('.').map(Number);
            
            // Additional IP validation
            if (parts.some(part => part < 0 || part > 255)) {
                return false;
            }
            
            // Block additional dangerous ranges
            if (parts[0] === 0 || parts[0] === 255) {
                return false;
            }
        }

        return true;
    }

    /**
     * Test connection to a remote desktop server
     * @param {Object} connection - Connection configuration
     * @returns {Promise<Object>} Test result
     */
    async testConnection(connection) {
        const { protocol } = connection;
        
        try {
            switch (protocol) {
                case 'kasmvnc': {
                    // SECURITY: Only accept connection.targetId and map from allowlist
                    const { targetId } = connection;
                    if (!targetId || typeof targetId !== 'string' || !(targetId in this.kasmVncAllowlist)) {
                        throw new Error('KasmVNC target not allowed');
                    }
                    const target = this.kasmVncAllowlist[targetId];
                    // Optionally: Validate further (host/port non-falsy, correct types)
                    return await this.testKasmVNC(target.host, target.port, !!target.ssl);
                }
                case 'vnc': {
                    // Legacy: Still allow host/port, but require host pattern validation
                    const { host, port } = connection;
                    if (!this.validateHost(host)) {
                        throw new Error('Host not allowed - potential security risk detected');
                    }
                    if (!port || port < 1 || port > 65535) {
                        throw new Error('Invalid port number');
                    }
                    return await this.testVNC(host, port);
                }
                case 'rdp': {
                    const { host, port } = connection;
                    if (!this.validateHost(host)) {
                        throw new Error('Host not allowed - potential security risk detected');
                    }
                    if (!port || port < 1 || port > 65535) {
                        throw new Error('Invalid port number');
                    }
                }
                    return await this.testRDP(host, port);
                default:
                    throw new Error(`Unsupported protocol: ${protocol}`);
            }
            const host = connection.host || (connection.targetId && this.kasmVncAllowlist[connection.targetId]?.host) || '(unknown)';
            const port = connection.port || (connection.targetId && this.kasmVncAllowlist[connection.targetId]?.port) || '';
        } catch (error) {
            console.error(`🚫 Connection test failed for ${host}:${port}:`, error.message);
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
     * Test KasmVNC connection with SSRF protection
     * SECURITY: Host validation already performed in testConnection()
     */
    async testKasmVNC(host, port, ssl = false) {
        const protocol = ssl ? 'https:' : 'http:';
        const url = `${protocol}//${host}:${port}/api/health`;
        
        return new Promise((resolve) => {
            const client = ssl ? https : http;
            const timeout = 5000; // SECURITY: Short timeout to prevent resource exhaustion
            
            // SECURITY: Additional request options for safety
            const options = {
                timeout,
                headers: {
                    'User-Agent': 'OverlayCompanion-HealthCheck/1.0',
                    'Accept': 'application/json'
                },
                // SECURITY: Prevent following redirects that could lead to SSRF
                maxRedirects: 0
            };
            
            // SECURITY: URL constructed from validated host - safe for HTTP request
            const req = client.get(url, options, (res) => {
                // SECURITY: Limit response size to prevent memory exhaustion
                let data = '';
                const maxResponseSize = 1024; // 1KB limit for health check
                
                res.on('data', (chunk) => {
                    data += chunk;
                    if (data.length > maxResponseSize) {
                        req.destroy();
                        resolve({
                            success: false,
                            protocol: 'kasmvnc',
                            host,
                            port,
                            ssl,
                            error: 'Response too large'
                        });
                    }
                });
                
                res.on('end', () => {
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
     * Test VNC connection with SSRF protection
     * SECURITY: Host validation already performed in testConnection()
     */
    async testVNC(host, port) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            const timeout = 5000; // SECURITY: Short timeout to prevent resource exhaustion

            socket.setTimeout(timeout);

            // SECURITY: Set socket options to prevent abuse
            socket.setNoDelay(true);
            socket.setKeepAlive(false);

            // SECURITY: Host has been validated in testConnection() against SSRF patterns - safe to connect
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
                socket.destroy();
                resolve({
                    success: false,
                    protocol: 'vnc',
                    host,
                    port,
                    error: error.message
                });
            });

            // SECURITY: Force cleanup after timeout
            setTimeout(() => {
                if (!socket.destroyed) {
                    socket.destroy();
                }
            }, timeout + 1000);
        });
    }

    /**
     * Test RDP connection with SSRF protection
     * SECURITY: Host validation already performed in testConnection()
     */
    async testRDP(host, port) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            const timeout = 5000; // SECURITY: Short timeout to prevent resource exhaustion

            socket.setTimeout(timeout);

            // SECURITY: Set socket options to prevent abuse
            socket.setNoDelay(true);
            socket.setKeepAlive(false);

            // SECURITY: Host has been validated in testConnection() against SSRF patterns - safe to connect
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
                socket.destroy();
                resolve({
                    success: false,
                    protocol: 'rdp',
                    host,
                    port,
                    error: error.message
                });
            });

            // SECURITY: Force cleanup after timeout
            setTimeout(() => {
                if (!socket.destroyed) {
                    socket.destroy();
                }
            }, timeout + 1000);
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
     * Validate connection configuration with security checks
     */
    validateConnection(connection) {
        const errors = [];

        // SECURITY: Basic input validation
        if (!connection.host || typeof connection.host !== 'string') {
            errors.push('Host is required and must be a string');
        } else {
            // SECURITY: Validate host against SSRF patterns
            if (!this.validateHost(connection.host)) {
                errors.push('Host not allowed - potential security risk detected');
            }
        }

        // SECURITY: Port validation with restrictions
        if (!connection.port || !Number.isInteger(connection.port)) {
            errors.push('Port must be a valid integer');
        } else if (connection.port < this.portRestrictions.min || connection.port > this.portRestrictions.max) {
            errors.push(`Port must be between ${this.portRestrictions.min} and ${this.portRestrictions.max}`);
        }

        // SECURITY: Protocol validation
        if (!connection.protocol || !this.allowedProtocols.includes(connection.protocol)) {
            errors.push(`Protocol must be one of: ${this.allowedProtocols.join(', ')}`);
        }

        // Protocol-specific validation (warnings, not errors)
        if (connection.protocol === 'rdp' && connection.port === 6901) {
            console.warn('⚠️  RDP typically uses port 3389, not 6901');
        }

        if (connection.protocol === 'vnc' && connection.port === 3389) {
            console.warn('⚠️  VNC typically uses ports 5900-5999, not 3389');
        }

        const isValid = errors.length === 0;
        
        if (this.logging.logSecurityEvents && !isValid) {
            console.warn('🚫 SECURITY: Connection validation failed:', errors);
        }

        return {
            valid: isValid,
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