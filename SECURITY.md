# Security Policy

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