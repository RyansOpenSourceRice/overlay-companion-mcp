# Security Fixes - SSRF Vulnerability Remediation

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