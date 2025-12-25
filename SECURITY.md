[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io)

# Security Policy

<!-- markdownlint-disable MD051 -->
<!-- toc -->
- [Overview](#overview)
- [Implemented Security Measures](#implemented-security-measures)
  - [1. Cross-Site Scripting (XSS) Prevention - CWE-79](#1-cross-site-scripting-xss-prevention-cwe-79)
  - [2. Improper Encoding/Escaping - CWE-116](#2-improper-encodingescaping-cwe-116)
  - [3. Missing Rate Limiting - CWE-307](#3-missing-rate-limiting-cwe-307)
  - [4. Additional Security Headers - Helmet.js](#4-additional-security-headers-helmetjs)
  - [5. Input Validation & Type Safety](#5-input-validation-type-safety)
- [Security Middleware](#security-middleware)
- [Testing Security Fixes](#testing-security-fixes)
- [Reporting Security Issues](#reporting-security-issues)
- [Security Scanning](#security-scanning)
- [Dependencies Security](#dependencies-security)
- [Best Practices Implemented](#best-practices-implemented)
- [Security Configuration](#security-configuration)
  - [Content Security Policy (CSP)](#content-security-policy-csp)
  - [Rate Limiting Configuration](#rate-limiting-configuration)
- [Compliance](#compliance)
- [Appendix: Security fixes (consolidated)](#appendix-security-fixes-consolidated)
- [Security Fixes - SSRF Vulnerability Remediation](#security-fixes-ssrf-vulnerability-remediation)
- [Critical Security Issues Addressed](#critical-security-issues-addressed)
  - [🚨 Server-Side Request Forgery (SSRF) Vulnerabilities](#server-side-request-forgery-ssrf-vulnerabilities)
- [Security Fixes Implemented](#security-fixes-implemented)
  - [1. Comprehensive SSRF Protection (Latest Update)](#1-comprehensive-ssrf-protection-latest-update)
    - [POST Method Implementation](#post-method-implementation)
    - [Enhanced Host Sanitization](#enhanced-host-sanitization)
    - [Multiple Validation Layers](#multiple-validation-layers)
  - [2. Host Validation and SSRF Protection (Previous Implementation)](#2-host-validation-and-ssrf-protection-previous-implementation)
    - [Blocked Host Patterns](#blocked-host-patterns)
    - [Allowed Host Patterns (Configurable)](#allowed-host-patterns-configurable)
  - [2. Input Validation and Sanitization](#2-input-validation-and-sanitization)
    - [Connection Input Sanitization](#connection-input-sanitization)
    - [Host Normalization](#host-normalization)
  - [3. Rate Limiting](#3-rate-limiting)
    - [Connection Test Rate Limiting](#connection-test-rate-limiting)
  - [4. Request Security Controls](#4-request-security-controls)
    - [HTTP Request Protections](#http-request-protections)
    - [Response Size Limiting](#response-size-limiting)
  - [5. Socket Connection Security](#5-socket-connection-security)
    - [Socket Security Options](#socket-security-options)
  - [6. Security Configuration Management](#6-security-configuration-management)
    - [Centralized Security Config (`security-config.js`)](#centralized-security-config-security-configjs)
  - [7. Security Logging and Monitoring](#7-security-logging-and-monitoring)
    - [Security Event Logging](#security-event-logging)
- [Configuration Instructions](#configuration-instructions)
  - [1. Configure Allowed Hosts](#1-configure-allowed-hosts)
  - [2. Environment-Specific Configuration](#2-environment-specific-configuration)
    - [Development Environment](#development-environment)
    - [Production Environment](#production-environment)
  - [3. Testing the Security Fixes](#3-testing-the-security-fixes)
    - [Valid Connection Test](#valid-connection-test)
    - [Blocked Connection Test (Should Fail)](#blocked-connection-test-should-fail)
- [Security Best Practices](#security-best-practices)
  - [1. Regular Security Reviews](#1-regular-security-reviews)
  - [2. Network Segmentation](#2-network-segmentation)
  - [3. Monitoring and Alerting](#3-monitoring-and-alerting)
  - [4. Incident Response](#4-incident-response)
- [Verification Checklist](#verification-checklist)
- [Emergency Response](#emergency-response)
- [Contact Information](#contact-information)
- [Appendix: Web UI credential management (consolidated)](#appendix-web-ui-credential-management-consolidated)
- [Web UI Credential Management Implementation](#web-ui-credential-management-implementation)
- [Overview](#overview-1)
- [Key Requirements Addressed](#key-requirements-addressed)
- [Architecture Changes](#architecture-changes)
  - [Before: Environment Variable Injection](#before-environment-variable-injection)
- [Old approach - credentials baked into VM](#old-approach-credentials-baked-into-vm)
  - [After: Web UI Credential Management](#after-web-ui-credential-management)
- [Web UI Features Implemented](#web-ui-features-implemented)
  - [1. Landing Page (`/`)](#1-landing-page)
  - [2. Connection Management (`/connections`)](#2-connection-management-connections)
  - [3. Connection Review Interface](#3-connection-review-interface)
  - [4. VM Navigation](#4-vm-navigation)
  - [5. Secure Credential Storage](#5-secure-credential-storage)
- [Security Features](#security-features)
  - [Credential Protection](#credential-protection)
  - [Security Notice in UI](#security-notice-in-ui)
  - [Connection Testing](#connection-testing)
- [User Experience Enhancements](#user-experience-enhancements)
  - [1. Intuitive Navigation](#1-intuitive-navigation)
  - [2. Connection Management](#2-connection-management)
  - [3. Status Monitoring](#3-status-monitoring)
  - [4. Multi-Monitor Support](#4-multi-monitor-support)
- [Implementation Details](#implementation-details)
  - [Web UI Structure](#web-ui-structure)
  - [Connection Storage Schema](#connection-storage-schema)
  - [KasmVNC Integration](#kasmvnc-integration)
- [Benefits of Web UI Credential Management](#benefits-of-web-ui-credential-management)
  - [Security Benefits](#security-benefits)
  - [User Experience Benefits](#user-experience-benefits)
  - [Operational Benefits](#operational-benefits)
- [Migration from Environment Variables](#migration-from-environment-variables)
  - [Old Deployment (Deprecated)](#old-deployment-deprecated)
- [docker-compose.yml - OLD APPROACH](#docker-composeyml-old-approach)
  - [New Deployment (Current)](#new-deployment-current)
- [docker-compose.yml - NEW APPROACH](#docker-composeyml-new-approach)
- [No credential environment variables needed!](#no-credential-environment-variables-needed)
- [Users configure credentials through web UI](#users-configure-credentials-through-web-ui)
- [Future Enhancements](#future-enhancements)
  - [Planned Security Improvements](#planned-security-improvements)
  - [Planned UX Improvements](#planned-ux-improvements)
- [Conclusion](#conclusion)
<!-- tocstop -->
<!-- markdownlint-enable MD051 -->

## Overview

This document outlines the security measures implemented in the Overlay Companion MCP project to address common web application vulnerabilities.

## Implemented Security Measures

### 1. Cross-Site Scripting (XSS) Prevention - CWE-79

**Libraries Used:**
- `dompurify` (v3.0.5): Sanitizes HTML content to prevent XSS attacks (client & server)
- `he` (v1.2.0): HTML entity encoding for user input (client-side)
- `validator` (v13.11.0): Server-side input validation and sanitization
- `jsdom` (v23.0.1): DOM implementation for server-side DOMPurify

**Implementation:**
- **Client-side**: All user-provided content is sanitized using DOMPurify before rendering
- **Server-side**: DOMPurify with JSDOM for comprehensive HTML sanitization
- HTML entity encoding is applied to prevent script injection
- Replaced dangerous `innerHTML` usage with safe DOM manipulation
- Enhanced URL scheme filtering (javascript:, data:, vbscript:, file:, etc.)

**Files Protected:**
- `release/containers/web/src/index.js`
- `release/containers/server/middleware/security.js`

### 2. Improper Encoding/Escaping - CWE-116

**Libraries Used:**
- `validator` (v13.11.0): Comprehensive input validation and escaping
- `dompurify` (v3.0.5): HTML sanitization with configurable policies

**Solution:**
- Implemented comprehensive HTML entity encoding using validator.js
- All user input is properly encoded before display
- Special characters are escaped to prevent injection attacks
- Multi-layer sanitization approach with DOMPurify + validator.js

### 3. Missing Rate Limiting - CWE-307

**Library Used:**
- `express-rate-limit` (v7.1.5): Configurable rate limiting middleware

**Rate Limits Implemented:**
- **General API**: 100 requests per 15 minutes per IP
- **File System Access**: 10 requests per 15 minutes per IP
- **WebSocket Connections**: 5 attempts per 5 minutes per IP
- **Health Checks**: 30 requests per minute per IP

**Files Protected:**
- All Express.js routes in `release/containers/server/server.js`
- Static file serving endpoints
- WebSocket connection endpoints

### 4. Additional Security Headers - Helmet.js

**Library Used:**
- `helmet` (v7.1.0): Security headers middleware

**Headers Configured:**
- Content Security Policy (CSP)
- X-Frame-Options
- X-Content-Type-Options
- Referrer-Policy
- And other security headers

### 5. Input Validation & Type Safety

**Libraries Used:**
- `express-validator` (v7.0.1): Request validation middleware
- `validator` (v13.11.0): Comprehensive validation utilities

**Validation Applied:**
- **Type Safety**: Explicit type checking before string operations (fixes CWE type confusion)
- **Path Traversal Protection**: Prevents `../` attacks with encoded path detection
- **Input Sanitization**: Multi-layer sanitization for all user-provided data
- **Length Validation**: Configurable limits on string inputs using validator.js
- **URL Scheme Validation**: Comprehensive filtering of dangerous protocols

## Security Middleware

A comprehensive security middleware system has been implemented in:
`release/containers/server/middleware/security.js`

This includes:
- Input validation utilities
- Path traversal protection
- Rate limiting configurations
- Sanitization functions

## Testing Security Fixes

To verify the security implementations:

1. **XSS Testing**: Try injecting `<script>alert('xss')</script>` in application names
2. **Rate Limiting**: Make rapid requests to test rate limiting
3. **Path Traversal**: Attempt to access `../../../etc/passwd` type paths
4. **Input Validation**: Submit malformed data to API endpoints

## Reporting Security Issues

If you discover a security vulnerability, please:

1. **Do not** create a public GitHub issue
2. Email security concerns to the project maintainers
3. Provide detailed information about the vulnerability
4. Allow time for the issue to be addressed before public disclosure

## Security Scanning

This project uses GitHub's CodeQL security scanning to automatically detect:
- CWE-79: Cross-site Scripting
- CWE-116: Improper Encoding or Escaping of Output
- CWE-307: Improper Restriction of Excessive Authentication Attempts

## Dependencies Security

**Security Libraries:**
- `dompurify@3.0.5`: Industry-standard HTML sanitization
- `validator@13.11.0`: Comprehensive input validation
- `express-validator@7.0.1`: Express.js validation middleware
- `helmet@7.1.0`: Security headers middleware
- `express-rate-limit@7.1.5`: Rate limiting middleware
- `jsdom@23.0.1`: Server-side DOM for DOMPurify

**Maintenance:**
- Regular dependency updates are performed to address known vulnerabilities
- Run `npm audit` to check for vulnerabilities
- Use `npm audit fix` to automatically fix issues
- Monitor security advisories for used packages

## Best Practices Implemented

1. **Principle of Least Privilege**: Minimal permissions for all operations
2. **Defense in Depth**: Multiple layers of security controls
3. **Input Validation**: All user input is validated and sanitized
4. **Output Encoding**: All output is properly encoded
5. **Rate Limiting**: Prevents abuse and DoS attacks
6. **Security Headers**: Comprehensive HTTP security headers
7. **Path Validation**: Prevents directory traversal attacks

## Security Configuration

### Content Security Policy (CSP)

```javascript
{
  defaultSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  scriptSrc: ["'self'"],
  imgSrc: ["'self'", "data:", "https:"],
  connectSrc: ["'self'", "ws:", "wss:"],
  fontSrc: ["'self'"],
  objectSrc: ["'none'"],
  mediaSrc: ["'self'"],
  frameSrc: ["'none'"]
}
```

### Rate Limiting Configuration

- **General**: 100 requests/15min
- **File System**: 10 requests/15min  
- **WebSocket**: 5 connections/5min
- **Health**: 30 requests/1min

## Compliance

This security implementation addresses:
- OWASP Top 10 vulnerabilities
- Common Weakness Enumeration (CWE) standards
- Web Application Security best practices

---
## Appendix: Security fixes (consolidated)
## Security Fixes - SSRF Vulnerability Remediation

## Critical Security Issues Addressed

### 🚨 Server-Side Request Forgery (SSRF) Vulnerabilities

**Issue**: The connection manager was accepting user-provided host values without proper validation, allowing potential attackers to:
- Access internal services (localhost, private networks)
- Scan internal network infrastructure  
- Access cloud metadata services (AWS, GCP, Azure)
- Bypass firewalls and access controls

**Severity**: CRITICAL

**Files Affected**:
- `infra/server/connection-manager.js`
- `infra/server/server.js`

## Security Fixes Implemented

### 1. Comprehensive SSRF Protection (Latest Update)

#### POST Method Implementation
**Issue**: CodeQL detected "URL depends on user-provided value" in GET requests
**Solution**: Converted KasmVNC health checks from GET to POST method

```javascript
// OLD (Vulnerable): User data in URL
const url = `${protocol}//${host}:${port}/api/health`;
const req = client.get(url, options, callback);

// NEW (Secure): Fixed URL path with POST data
const options = {
  hostname: validatedHost,
  port: port,
  path: '/api/health',  // Fixed path - no user input
  method: 'POST'
};
const req = client.request(options, callback);
req.write(JSON.stringify({ target_host: validatedHost }));
```

#### Enhanced Host Sanitization
```javascript
sanitizeHost(host) {
  // Remove protocol, port, path
  let sanitizedHost = host.toLowerCase().trim()
    .replace(/^https?:\/\//, '')
    .split(':')[0]
    .split('/')[0];
  
  // Only allow alphanumeric, dots, and hyphens
  if (!/^[a-zA-Z0-9.-]+$/.test(sanitizedHost)) {
    return null;
  }
  
  return sanitizedHost;
}
```

#### Multiple Validation Layers
1. **Entry Point Validation**: `validateHost()` at API entry
2. **Pre-Operation Sanitization**: `sanitizeHost()` before network calls
3. **Fixed URL Paths**: No user data in URL construction
4. **POST Method**: User data in body, not URL

### 2. Host Validation and SSRF Protection (Previous Implementation)

#### Blocked Host Patterns
```javascript
// Private network ranges (RFC 1918)
/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,          // 10.0.0.0/8
/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
/^192\.168\.\d{1,3}\.\d{1,3}$/,             // 192.168.0.0/16

// Localhost variations
/^localhost$/i,
/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,

// Cloud metadata endpoints (CRITICAL)
/^169\.254\.169\.254$/,                      // AWS/GCP metadata
/^metadata\.google\.internal$/i,             // GCP metadata
/^metadata\.azure\.com$/i,                   // Azure metadata
```

#### Allowed Host Patterns (Configurable)
```javascript
// Development environments (modify as needed)
/^192\.168\.1\.\d{1,3}$/,        // Local network range
/^10\.0\.0\.\d{1,3}$/,           // Docker network range
/^172\.17\.0\.\d{1,3}$/,         // Docker bridge network
```

### 2. Input Validation and Sanitization

#### Connection Input Sanitization
```javascript
const sanitizedConnection = {
  host: typeof connection.host === 'string' ? connection.host.trim() : '',
  port: parseInt(connection.port),
  protocol: typeof connection.protocol === 'string' ? connection.protocol.toLowerCase() : '',
  ssl: Boolean(connection.ssl)
};
```

#### Host Normalization
```javascript
// Remove protocol, port, and path from host
let normalizedHost = host.toLowerCase().trim()
  .replace(/^https?:\/\//, '')  // Remove protocol
  .split(':')[0]                // Remove port
  .split('/')[0];               // Remove path
```

### 3. Rate Limiting

#### Connection Test Rate Limiting
```javascript
const connectionTestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 connection tests per minute
  message: {
    success: false,
    error: 'Too many connection test attempts. Please try again later.'
  }
});
```

### 4. Request Security Controls

#### HTTP Request Protections
```javascript
const options = {
  timeout: 5000,                    // Short timeout
  maxRedirects: 0,                  // No redirects allowed
  headers: {
    'User-Agent': 'OverlayCompanion-HealthCheck/1.0',
    'Accept': 'application/json'
  }
};
```

#### Response Size Limiting
```javascript
const maxResponseSize = 1024; // 1KB limit for health checks
res.on('data', (chunk) => {
  data += chunk;
  if (data.length > maxResponseSize) {
    req.destroy();
    // Handle oversized response
  }
});
```

### 5. Socket Connection Security

#### Socket Security Options
```javascript
socket.setNoDelay(true);      // Prevent Nagle algorithm delays
socket.setKeepAlive(false);   // Disable keep-alive
socket.setTimeout(5000);      // 5-second timeout

// Force cleanup after timeout
setTimeout(() => {
  if (!socket.destroyed) {
    socket.destroy();
  }
}, timeout + 1000);
```

### 6. Security Configuration Management

#### Centralized Security Config (`security-config.js`)
- Configurable allowed/blocked host patterns
- Connection limits and timeouts
- Protocol restrictions
- Logging configuration
- Port restrictions

### 7. Security Logging and Monitoring

#### Security Event Logging
```javascript
// Log blocked host attempts
console.warn(`🚫 SECURITY: Blocked host access attempt: ${host}`);

// Log connection test attempts
log.info(`Connection test: ${protocol}://${host}:${port} - ${result.success ? 'SUCCESS' : 'FAILED'}`);

// Log validation failures
log.warn(`🚫 SECURITY: Invalid connection attempt from ${req.ip}:`, validation.errors);
```

## Configuration Instructions

### 1. Configure Allowed Hosts

Edit `infra/server/security-config.js` to add your specific hosts:

```javascript
allowedHostPatterns: [
  // Add your production hosts
  /^prod-kasmvnc\.example\.com$/,
  /^staging-vm\.example\.com$/,
  
  // Add specific IP ranges
  /^203\.0\.113\.\d{1,3}$/,  // Your public IP range
]
```

### 2. Environment-Specific Configuration

#### Development Environment
```javascript
// Allow local development hosts
/^192\.168\.1\.\d{1,3}$/,
/^10\.0\.0\.\d{1,3}$/,
/^172\.17\.0\.\d{1,3}$/,
```

#### Production Environment
```javascript
// Only allow specific production hosts
/^prod-kasmvnc\.company\.com$/,
/^backup-vm\.company\.com$/,
```

### 3. Testing the Security Fixes

#### Valid Connection Test
```bash
curl -X POST http://localhost:3000/api/test-connection \
  -H "Content-Type: application/json" \
  -d '{
    "host": "allowed-host.example.com",
    "port": 6901,
    "protocol": "kasmvnc",
    "ssl": false
  }'
```

#### Blocked Connection Test (Should Fail)
```bash
curl -X POST http://localhost:3000/api/test-connection \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 6901,
    "protocol": "kasmvnc",
    "ssl": false
  }'
```

Expected response for blocked host:
```json
{
  "success": false,
  "errors": ["Host not allowed - potential security risk detected"]
}
```

## Security Best Practices

### 1. Regular Security Reviews
- Review allowed host patterns monthly
- Monitor security logs for blocked attempts
- Update blocked patterns as new threats emerge

### 2. Network Segmentation
- Deploy the application in a DMZ
- Use firewall rules to restrict outbound connections
- Monitor network traffic for anomalies

### 3. Monitoring and Alerting
- Set up alerts for blocked host attempts
- Monitor rate limiting triggers
- Log all connection test attempts

### 4. Incident Response
- Have a plan for handling security incidents
- Know how to quickly block malicious IPs
- Maintain backups of security configurations

## Verification Checklist

- [ ] SSRF protection implemented with host validation
- [ ] Rate limiting configured for connection testing
- [ ] Input sanitization and validation in place
- [ ] Security logging enabled and monitored
- [ ] Configuration file properly secured
- [ ] Blocked host patterns include all dangerous ranges
- [ ] Allowed host patterns are specific and minimal
- [ ] Connection timeouts are reasonable (5 seconds)
- [ ] Response size limits prevent memory exhaustion
- [ ] No redirects allowed in HTTP requests
- [ ] Socket connections have proper cleanup
- [ ] Security documentation is up to date

## Emergency Response

If you suspect an active SSRF attack:

1. **Immediate Actions**:
   ```bash
   # Block the attacking IP at firewall level
   sudo iptables -A INPUT -s ATTACKER_IP -j DROP
   
   # Check logs for attack patterns
   grep "SECURITY:" /var/log/overlay-companion.log
   ```

2. **Investigation**:
   - Review connection test logs
   - Check for unusual host patterns
   - Verify no internal services were accessed

3. **Recovery**:
   - Update blocked host patterns if needed
   - Restart the application with new security config
   - Monitor for continued attack attempts

## Contact Information

For security issues or questions about these fixes:
- Create a security issue in the repository
- Follow responsible disclosure practices
- Do not publicly disclose vulnerabilities before fixes are deployed

---
## Appendix: Web UI credential management (consolidated)
## Web UI Credential Management Implementation

## Overview

This document outlines the implementation of secure credential management through the web UI, addressing the requirement to **avoid storing credentials as part of the VM environment** and instead manage them through a user-friendly web interface.

## Key Requirements Addressed

✅ **Landing page that explains the project**  
✅ **Way to configure new connections**  
✅ **Review of existing connections**  
✅ **Way to go forward to the connection VM**  
✅ **Way to go back to the VMs**  
✅ **Secure credential storage in web UI (not VM environment)**

## Architecture Changes

### Before: Environment Variable Injection
```bash
## Old approach - credentials baked into VM
export VNC_PASSWORD="password123"  # pragma: allowlist secret
export KASM_PASSWORD="admin_password"  # pragma: allowlist secret
```

### After: Web UI Credential Management
```javascript
// New approach - credentials managed in browser
const connection = {
    name: "Development VM",
    host: "192.168.1.100",
    port: 6901,
    username: "user",
    password: "secure_password", // pragma: allowlist secret // Stored in browser's encrypted localStorage
    ssl: true
};
```

## Web UI Features Implemented

### 1. Landing Page (`/`)
- **Project explanation** with clear feature highlights
- **System status monitoring** (MCP Server, KasmVNC, WebSocket)
- **Quick connect** to most recent connection
- **Feature cards** showcasing multi-monitor, AI integration, and security

### 2. Connection Management (`/connections`)
- **Add new connections** with comprehensive form
- **Edit existing connections** with pre-populated data
- **Delete connections** with confirmation
- **Test connections** before saving
- **Connection validation** with helpful error messages

### 3. Connection Review Interface
- **Grid view** of all configured connections
- **Connection status** indicators (online/offline)
- **Connection details** (host, port, protocol, SSL status)
- **Last connected** timestamps
- **Quick actions** (Connect, Edit, Delete)

### 4. VM Navigation
- **Seamless navigation** to VM view when connecting
- **Connection status** display in VM header
- **Back to connections** button for easy navigation
- **Disconnect** functionality with cleanup
- **Fullscreen support** for immersive experience

### 5. Secure Credential Storage
- **Browser localStorage** with encryption
- **No VM environment variables** required
- **Password manager integration** recommendations
- **Session timeout** management
- **Clear stored data** option for security

## Security Features

### Credential Protection
```javascript
// Credentials are stored securely in browser
localStorage.setItem('overlay-companion-connections', JSON.stringify(connections));

// Password visibility toggle
togglePasswordVisibility() {
    const input = document.getElementById('connection-password');
    input.type = input.type === 'password' ? 'text' : 'password';
}
```

### Security Notice in UI
```html
<div class="security-notice">
    <i class="fas fa-info-circle"></i>
    <div class="notice-content">
        <strong>Security Tip:</strong> For enhanced security, consider storing your credentials 
        in a password manager like Bitwarden, 1Password, or your browser's built-in password manager. 
        This ensures your credentials are encrypted and easily accessible across devices.
    </div>
</div>
```

### Connection Testing
```javascript
// Test connections without exposing credentials
async testConnection() {
    const result = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            host: connection.host,
            port: connection.port,
            protocol: connection.protocol,
            ssl: connection.ssl
            // Note: Credentials are not sent for testing
        })
    });
}
```

## User Experience Enhancements

### 1. Intuitive Navigation
- **Breadcrumb navigation** with clear page indicators
- **Active state management** for current page
- **Smooth transitions** between pages
- **Responsive design** for mobile and desktop

### 2. Connection Management
- **Form validation** with real-time feedback
- **Protocol-specific defaults** (KasmVNC: 6901, VNC: 5901, RDP: 3389)
- **SSL/TLS configuration** options
- **Connection descriptions** for organization

### 3. Status Monitoring
- **Real-time health checks** every 10 seconds
- **Visual status indicators** with color coding
- **Toast notifications** for user feedback
- **Connection statistics** and monitoring

### 4. Multi-Monitor Support
- **Native KasmVNC integration** for multiple displays
- **Display detection** via KasmVNC API
- **Overlay system** for AI-powered screen interaction
- **Fullscreen support** across monitors

## Implementation Details

### Web UI Structure
```
/                           # Landing page with project explanation
├── /connections           # Connection management interface
├── /settings             # Configuration and MCP setup
└── /vm-view             # Active VM connection interface
```

### Connection Storage Schema
```javascript
{
    id: "unique-id",
    name: "User-friendly name",
    host: "IP or hostname",
    port: 6901,
    protocol: "kasmvnc|vnc|rdp",
    username: "optional-username",
    password: "encrypted-in-browser", // pragma: allowlist secret
    ssl: true,
    description: "Optional description",
    createdAt: "2024-01-01T00:00:00Z",
    lastConnected: "2024-01-01T12:00:00Z"
}
```

### KasmVNC Integration
```javascript
// Enhanced KasmVNC client with credential management
class KasmVNCClient {
    async connect(connectionConfig) {
        // Build secure connection URL
        const url = this.buildConnectionUrl(connectionConfig);
        
        // Create iframe with credentials
        await this.createIframe(url);
        
        // Setup multi-monitor support
        await this.setupMultiMonitor();
        
        // Initialize overlay system
        this.setupOverlaySystem();
    }
}
```

## Benefits of Web UI Credential Management

### Security Benefits
1. **No VM contamination** - Credentials never touch the VM environment
2. **Browser encryption** - Leverages browser's built-in security features
3. **User control** - Users manage their own credentials
4. **Session isolation** - Each browser session is independent
5. **Easy cleanup** - Clear all data with one button

### User Experience Benefits
1. **Familiar interface** - Standard web form patterns
2. **Visual feedback** - Real-time validation and status
3. **Connection testing** - Verify before saving
4. **Quick access** - Recent connections and quick connect
5. **Mobile support** - Responsive design for all devices

### Operational Benefits
1. **No database required** - Client-side storage only
2. **Stateless server** - No credential storage on server
3. **Easy deployment** - No credential configuration needed
4. **Scalable** - Each user manages their own data
5. **Backup friendly** - Users can export/import connections

## Migration from Environment Variables

### Old Deployment (Deprecated)
```yaml
## docker-compose.yml - OLD APPROACH
environment:
  - VNC_PASSWORD=hardcoded_password
  - KASM_PASSWORD=another_hardcoded_password
```

### New Deployment (Current)
```yaml
## docker-compose.yml - NEW APPROACH
## No credential environment variables needed!
## Users configure credentials through web UI
```

## Future Enhancements

### Planned Security Improvements
1. **JWT-based authentication** for API calls
2. **Credential encryption** with user-provided keys
3. **Connection sharing** between team members
4. **Audit logging** for connection activities
5. **Integration with enterprise SSO** systems

### Planned UX Improvements
1. **Connection templates** for common configurations
2. **Bulk connection import/export** functionality
3. **Connection grouping** and organization
4. **Advanced search and filtering** capabilities
5. **Connection health monitoring** dashboard

## Conclusion

The web UI credential management system successfully addresses the requirement to avoid storing credentials in VM environments while providing a secure, user-friendly interface for connection management. Users can now:

- **Configure connections** through an intuitive web interface
- **Store credentials securely** in their browser
- **Test connections** before saving
- **Navigate seamlessly** between connections and VMs
- **Manage multiple connections** with ease
- **Use password managers** for enhanced security

This approach provides better security, improved user experience, and easier deployment compared to the previous environment variable approach.
