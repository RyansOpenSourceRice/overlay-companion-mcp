#!/usr/bin/env node

/**
 * Overlay Companion MCP - Management Server
 *
 * This server provides:
 * - Web interface with Remote Desktop integration (via KasmVNC)
 * - MCP WebSocket bridge for overlay broadcasting
 * - Static file serving for frontend assets
 * - Health monitoring and status endpoints
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
// const fs = require('fs').promises; // Reserved for future file operations
const { createProxyMiddleware } = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit');
const ConnectionManager = require('./connection-manager');
const { createRemoteJWKSet, jwtVerify } = require('jose');

// Configuration
const config = {
  projectName: process.env.PROJECT_NAME || 'overlay-companion-mcp',
  bindAddress: process.env.BIND_ADDRESS || '0.0.0.0',
  httpPort: parseInt(process.env.HTTP_PORT) || 8080,
  wsPort: parseInt(process.env.WS_PORT) || 8081,
  kasmvncUrl: process.env.KASMVNC_URL || 'http://localhost:6901',
  kasmvncApiUrl: process.env.KASMVNC_API_URL || 'http://localhost:6902',
  mcpServerUrl: process.env.MCP_SERVER_URL || 'http://localhost:3001',
  mcpWsEnabled: process.env.MCP_WS_ENABLED === 'true',
  nodeEnv: process.env.NODE_ENV || 'development',
  oidcEnabled: process.env.OIDC_ENABLED === 'true',
  oidcIssuer: process.env.OIDC_ISSUER, // e.g. https://keycloak.example.com/realms/overlay
  oidcAudience: process.env.OIDC_AUDIENCE, // expected aud claim
  oidcRequiredRole: process.env.OIDC_REQUIRED_ROLE || 'overlay:user'
};

// Logging utility
const log = {
  info: (msg, ...args) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, ...args),
  debug: (msg, ...args) => {
    if (config.nodeEnv === 'development') {
      console.debug(`[DEBUG] ${new Date().toISOString()} ${msg}`, ...args);
    }
  }
};

// Express app setup
const app = express();
const server = http.createServer(app);
const connectionManager = new ConnectionManager();


// Optional OIDC/JWT middleware (no-op if OIDC is disabled)
let jwks = null;
if (config.oidcEnabled && config.oidcIssuer) {
  try {
    jwks = createRemoteJWKSet(new URL(`${config.oidcIssuer}/.well-known/openid-configuration/jwks`));
  } catch (e) {
    log.error('Invalid OIDC issuer URL. OIDC will be disabled.', e);
    config.oidcEnabled = false;
  }
}

async function requireAuth(req, res, next) {
  if (!config.oidcEnabled) return next();
  try {
    const auth = req.get('authorization') || req.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'missing_bearer', message: 'Authorization: Bearer <token> required' });
    }
    const token = auth.slice('Bearer '.length);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.oidcIssuer,
      audience: config.oidcAudience,
    });

    // Simple RBAC: check roles in realm_access.roles or groups
    const roles = new Set([
      ...(payload?.realm_access?.roles || []),
      ...((payload?.roles || [])),
      ...((payload?.groups || [])).map(g => g.replace(/^\//, '')),
    ].flat().filter(Boolean));

    if (config.oidcRequiredRole && !roles.has(config.oidcRequiredRole)) {
      return res.status(403).json({ error: 'forbidden', message: 'Required role missing' });
    }

    // Attach identity for downstream scoping
    req.user = {
      sub: payload.sub,
      email: payload.email,
      preferred_username: payload.preferred_username,
      roles: Array.from(roles),
    };
    next();
  } catch (err) {
    log.warn('JWT validation failed:', err?.message || err);
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Request logging
app.use((req, res, next) => {

// Optional OIDC/JWT middleware (no-op if OIDC is disabled)
let jwks = null;
if (config.oidcEnabled && config.oidcIssuer) {
  try {
    jwks = createRemoteJWKSet(new URL(`${config.oidcIssuer}/.well-known/openid-configuration/jwks`));
  } catch (e) {
    log.error('Invalid OIDC issuer URL. OIDC will be disabled.', e);
    config.oidcEnabled = false;
  }
}

async function requireAuth(req, res, next) {
  if (!config.oidcEnabled) return next();
  try {
    const auth = req.get('authorization') || req.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'missing_bearer', message: 'Authorization: Bearer <token> required' });
    }
    const token = auth.slice('Bearer '.length);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.oidcIssuer,
      audience: config.oidcAudience,
    });

    // Simple RBAC: check roles in realm_access.roles or groups
    const roles = new Set([
      ...(payload?.realm_access?.roles || []),
      ...((payload?.roles || [])),
      ...((payload?.groups || [])).map(g => g.replace(/^\//, '')),
    ].flat().filter(Boolean));

    if (config.oidcRequiredRole && !roles.has(config.oidcRequiredRole)) {
      return res.status(403).json({ error: 'forbidden', message: 'Required role missing' });
    }

    // Attach identity for downstream scoping
    req.user = {
      sub: payload.sub,
      email: payload.email,
      preferred_username: payload.preferred_username,
      roles: Array.from(roles),
    };
    next();
  } catch (err) {
    log.warn('JWT validation failed:', err?.message || err);
    return res.status(401).json({ error: 'invalid_token' });
  }
}

  log.debug(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// Protect MCP and Control MCP routes if OIDC is enabled
const authMiddleware = requireAuth;

// WebSocket server for MCP overlay broadcasting
let wss = null;
const overlayClients = new Set();

if (config.mcpWsEnabled) {
  wss = new WebSocket.Server({
    server,
    path: '/ws',
    clientTracking: true
  });

  wss.on('connection', (ws, req) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    overlayClients.add(ws);

    log.info(`WebSocket client connected: ${clientId}`, {
      ip: req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      clientId,
      timestamp: new Date().toISOString(),
      message: 'Connected to Overlay Companion MCP WebSocket'
    }));

    // Handle messages from client
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        log.debug(`WebSocket message from ${clientId}:`, message);

        // Handle different message types
        switch (message.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            break;

          case 'overlay_command':
            // Broadcast overlay command to all clients
            broadcastOverlay(message.payload, clientId);
            break;

          case 'viewport_update':
            // Handle viewport configuration updates
            handleViewportUpdate(message.payload, clientId);
            break;

          default:
            log.warn(`Unknown message type from ${clientId}:`, message.type);
        }
      } catch (error) {
        log.error(`Error processing WebSocket message from ${clientId}:`, error);
      }
    });

    // Handle client disconnect
    ws.on('close', (code, reason) => {
      overlayClients.delete(ws);
      log.info(`WebSocket client disconnected: ${clientId}`, { code, reason: reason.toString() });
    });

    // Handle errors
    ws.on('error', (error) => {
      log.error(`WebSocket error for ${clientId}:`, error);
      overlayClients.delete(ws);
    });
  });

  log.info(`WebSocket server enabled on path /ws`);
}

// Broadcast overlay command to all connected clients
function broadcastOverlay(payload) {
  // Note: excludeClientId parameter removed as it's not currently used
  const message = JSON.stringify({
    type: 'overlay_broadcast',
    payload,
    timestamp: new Date().toISOString()
  });

  let broadcastCount = 0;
  overlayClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      broadcastCount++;
    }
  });

  log.debug(`Broadcasted overlay command to ${broadcastCount} clients`, payload);
}

// Handle viewport updates
function handleViewportUpdate(payload, clientId) {
  log.debug(`Viewport update from ${clientId}:`, payload);
  // Store viewport configuration for session management
  // This could be persisted to a database in production
}

// MCP Server proxy - forward requests to C# MCP server
app.use('/mcp', authMiddleware, createProxyMiddleware({
  target: config.mcpServerUrl,
  changeOrigin: true,
  pathRewrite: {
    '^/mcp': '' // Remove /mcp prefix when forwarding
  },
  onError: (err, req, res) => {
    log.error('MCP server proxy error:', err.message);
    res.status(503).json({
      error: 'MCP server unavailable',
      message: 'The C# MCP server is not responding. It may not be running or configured.'
    });
  },
  onProxyReq: (proxyReq, req) => {
    log.debug(`Proxying ${req.method} ${req.url} to MCP server`);
    if (req.user) {
      proxyReq.setHeader('X-User-Id', req.user.sub || 'unknown');
      proxyReq.setHeader('X-User-Roles', (req.user.roles || []).join(','));
    }
  }
}));

// SECURITY: Rate limiting for connection testing to prevent abuse
const connectionTestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 connection tests per minute
  message: {
    success: false,
    error: 'Too many connection test attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Connection testing endpoint with SSRF protection
app.post('/api/test-connection', connectionTestLimiter, async (req, res) => {
  try {
    const connection = req.body;

    // SECURITY: Additional input validation
    if (!connection || typeof connection !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid connection configuration'
      });
    }

    // SECURITY: Sanitize/allow only expected fields
    let sanitizedConnection;
    if (typeof connection.protocol === 'string' && connection.protocol.toLowerCase() === 'kasmvnc') {
      // Only allow client to specify a known targetId
      sanitizedConnection = {
        targetId: typeof connection.targetId === 'string' ? connection.targetId : '',
        protocol: 'kasmvnc'
      };
    } else {
      sanitizedConnection = {
        host: typeof connection.host === 'string' ? connection.host.trim() : '',
        port: parseInt(connection.port),
        protocol: typeof connection.protocol === 'string' ? connection.protocol.toLowerCase() : '',
        ssl: Boolean(connection.ssl)
      };
    }

    // Validate connection configuration (for non-kasmvnc only)
    if (sanitizedConnection.protocol !== 'kasmvnc') {
      const validation = connectionManager.validateConnection(sanitizedConnection);
      if (!validation.valid) {
        log.warn(`🚫 SECURITY: Invalid connection attempt from ${req.ip}:`, validation.errors);
        return res.status(400).json({
          success: false,
          errors: validation.errors
        });
      }
    }

    // Test the connection (includes SSRF protection)
    const result = await connectionManager.testConnection(sanitizedConnection);

    // SECURITY: Log connection test attempts for monitoring
    let logTarget;
    if (sanitizedConnection.protocol === 'kasmvnc') {
      logTarget = sanitizedConnection.targetId;
    } else {
      logTarget = `${sanitizedConnection.host}:${sanitizedConnection.port}`;
    }
    log.info(`Connection test: ${sanitizedConnection.protocol} - ${logTarget} - ${result.success ? 'SUCCESS' : 'FAILED'}`);

    res.json(result);
  } catch (error) {
    log.error('Connection test failed:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during connection test'
    });
  }
});

// Protocol defaults endpoint
app.get('/api/protocol-defaults/:protocol', (req, res) => {
  const { protocol } = req.params;
  const defaults = connectionManager.getProtocolDefaults(protocol);

  if (Object.keys(defaults).length === 0) {
    return res.status(404).json({
      error: 'Unknown protocol'
    });
  }

  res.json(defaults);
});

// Connection manager stats endpoint
app.get('/api/connection-stats', (req, res) => {
  const stats = connectionManager.getStats();
  res.json(stats);
});

// Health check endpoint
app.get('/health', async (req, res) => {
  // Check MCP server health
  let mcpServerStatus = 'unknown';
  try {
    const response = await fetch(`${config.mcpServerUrl}/health`, {
      timeout: 5000,
      signal: AbortSignal.timeout(5000)
    });
    mcpServerStatus = response.ok ? 'healthy' : 'unhealthy';
  } catch (error) {
    mcpServerStatus = 'unavailable';
  }

  // Check KasmVNC health
  let kasmvncStatus = 'unknown';
  try {
    const response = await fetch(`${config.kasmvncApiUrl}/api/health`, {
      timeout: 5000,
      signal: AbortSignal.timeout(5000)
    });
    kasmvncStatus = response.ok ? 'healthy' : 'unhealthy';
  } catch (error) {
    kasmvncStatus = 'unavailable';
  }

  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    config: {
      projectName: config.projectName,
      httpPort: config.httpPort,
      wsPort: config.wsPort,
      mcpWsEnabled: config.mcpWsEnabled,
      mcpServerUrl: config.mcpServerUrl,
      kasmvncUrl: config.kasmvncUrl,
      kasmvncApiUrl: config.kasmvncApiUrl
    },
    services: {
      webServer: 'running',
      websocket: config.mcpWsEnabled ? 'enabled' : 'disabled',
      mcpServer: mcpServerStatus,
      kasmvnc: kasmvncStatus,
      connectedClients: overlayClients.size
    }
  };

  res.json(health);
});

// MCP configuration endpoint for Cherry Studio integration
app.get('/mcp-config', (req, res) => {
  const hostHeader = req.get('host') || `${config.bindAddress}:${config.httpPort}`;
  const protocol = req.secure ? 'https' : 'http';
  const wsProtocol = req.secure ? 'wss' : 'ws';

  const mcpConfig = {
    mcp_version: '1.0',
    session_id: `${config.projectName}-${Date.now()}`,
    mcp_ws_url: `${wsProtocol}://${hostHeader}/ws`,
    mcp_http_url: `${protocol}://${hostHeader}/mcp`,
    auth: {
      type: 'session',
      token: `dev-token-${Date.now()}`
    },
    desktop: {
      target: 'kasmvnc-session',
      kasmvnc_url: config.kasmvncUrl,
      kasmvnc_api_url: config.kasmvncApiUrl,
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
      websocket_streaming: config.mcpWsEnabled
    },
    notes: 'Single-user dev package. Copy this JSON into Cherry Studio MCP slot.'
  };

  res.json(mcpConfig);
});

// Serve static files (web frontend)
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: config.nodeEnv === 'production' ? '1d' : '0',
  etag: true,
  lastModified: true
}));

// Rate limiter for SPA route to prevent abuse
const spaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP, please try again later.'
  }
});

// Catch-all route for SPA
app.get('*', spaLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
server.listen(config.httpPort, config.bindAddress, () => {
  log.info(`🚀 Overlay Companion MCP Management Server started`);
  log.info(`📍 HTTP server: http://${config.bindAddress}:${config.httpPort}`);
  log.info(`🔌 WebSocket: ${config.mcpWsEnabled ? 'enabled' : 'disabled'} on /ws`);
  log.info(`🌍 Environment: ${config.nodeEnv}`);
  log.info(`📊 Health check: http://${config.bindAddress}:${config.httpPort}/health`);
});
