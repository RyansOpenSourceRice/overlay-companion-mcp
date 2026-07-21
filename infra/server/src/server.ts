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

import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware, Options as ProxyOptions } from 'http-proxy-middleware';
import rateLimit from 'express-rate-limit';
import { ConnectionManager } from './connection-manager.js';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

// ESM-safe __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Augment Express Request with our optional user field
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

interface AuthUser {
  sub?: string;
  email?: string;
  preferred_username?: string;
  roles: string[];
}

interface ServerConfig {
  projectName: string;
  bindAddress: string;
  httpPort: number;
  wsPort: number;
  kasmvncUrl: string;
  kasmvncApiUrl: string;
  mcpServerUrl: string;
  mcpWsEnabled: boolean;
  nodeEnv: string;
  oidcEnabled: boolean;
  oidcIssuer?: string;
  oidcAudience?: string;
  oidcRequiredRole: string;
}

interface OverlayMessage {
  type: string;
  payload?: unknown;
  [key: string]: unknown;
}

// Configuration
const config: ServerConfig = {
  projectName: process.env.PROJECT_NAME || 'overlay-companion-mcp',
  bindAddress: process.env.BIND_ADDRESS || '0.0.0.0',
  httpPort: parseInt(process.env.HTTP_PORT || '8080', 10) || 8080,
  wsPort: parseInt(process.env.WS_PORT || '8081', 10) || 8081,
  kasmvncUrl: process.env.KASMVNC_URL || 'http://localhost:6901',
  kasmvncApiUrl: process.env.KASMVNC_API_URL || 'http://localhost:6902',
  mcpServerUrl: process.env.MCP_SERVER_URL || 'http://localhost:3001',
  mcpWsEnabled: process.env.MCP_WS_ENABLED === 'true',
  nodeEnv: process.env.NODE_ENV || 'development',
  oidcEnabled: process.env.OIDC_ENABLED === 'true',
  oidcIssuer: process.env.OIDC_ISSUER, // e.g. https://keycloak.example.com/realms/overlay
  oidcAudience: process.env.OIDC_AUDIENCE, // expected aud claim
  oidcRequiredRole: process.env.OIDC_REQUIRED_ROLE || 'overlay:user',
};

// Logging utility
const log = {
  info: (msg: string, ...args: unknown[]): void =>
    console.log(`[INFO] ${new Date().toISOString()} ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]): void =>
    console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]): void =>
    console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, ...args),
  debug: (msg: string, ...args: unknown[]): void => {
    if (config.nodeEnv === 'development') {
      console.debug(`[DEBUG] ${new Date().toISOString()} ${msg}`, ...args);
    }
  },
};

// Express app setup
const app = express();
// Trust reverse proxy (e.g., Caddy/Traefik) so req.secure and X-Forwarded-* are respected
app.set('trust proxy', true);
const server = http.createServer(app);
const connectionManager = new ConnectionManager();

// Optional OIDC/JWT middleware (no-op if OIDC is disabled)
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
if (config.oidcEnabled && config.oidcIssuer) {
  try {
    jwks = createRemoteJWKSet(new URL(`${config.oidcIssuer}/.well-known/openid-configuration/jwks`));
  } catch (e) {
    log.error('Invalid OIDC issuer URL. OIDC will be disabled.', e);
    config.oidcEnabled = false;
  }
}

async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!config.oidcEnabled) {
    next();
    return;
  }
  try {
    const auth = req.get('authorization') || req.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing_bearer', message: 'Authorization: Bearer <token> required' });
      return;
    }
    const token = auth.slice('Bearer '.length);
    const { payload } = await jwtVerify(token, jwks!, {
      issuer: config.oidcIssuer,
      audience: config.oidcAudience,
    });

    // Simple RBAC: check roles in realm_access.roles or groups
    const realmAccess = (payload as JWTPayload & { realm_access?: { roles?: string[] } }).realm_access;
    const roles = new Set<string>(
      [
        ...(realmAccess?.roles || []),
        ...((payload as JWTPayload & { roles?: string[] }).roles || []),
        ...((payload as JWTPayload & { groups?: string[] }).groups || []).map((g) => g.replace(/^\//, '')),
      ]
        .flat()
        .filter(Boolean) as string[],
    );

    if (config.oidcRequiredRole && !roles.has(config.oidcRequiredRole)) {
      res.status(403).json({ error: 'forbidden', message: 'Required role missing' });
      return;
    }

    // Attach identity for downstream scoping
    req.user = {
      sub: payload.sub,
      email: (payload as JWTPayload & { email?: string }).email,
      preferred_username: (payload as JWTPayload & { preferred_username?: string }).preferred_username,
      roles: Array.from(roles),
    };
    next();
  } catch (err) {
    log.warn('JWT validation failed:', (err as Error)?.message || err);
    res.status(401).json({ error: 'invalid_token' });
  }
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS middleware
app.use(((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
}) as RequestHandler);

// Request logging
app.use(((req, res, next) => {
  log.debug(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });
  next();
}) as RequestHandler);

// Protect MCP and Control MCP routes if OIDC is enabled
const authMiddleware = requireAuth;

// WebSocket server for MCP overlay broadcasting
let wss: WebSocketServer | null = null;
const overlayClients = new Set<WebSocket>();

if (config.mcpWsEnabled) {
  wss = new WebSocketServer({
    server,
    path: '/ws',
    clientTracking: true,
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    overlayClients.add(ws);

    log.info(`WebSocket client connected: ${clientId}`, {
      ip: req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: 'welcome',
        clientId,
        timestamp: new Date().toISOString(),
        message: 'Connected to Overlay Companion MCP WebSocket',
      }),
    );

    // Handle messages from client
    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString()) as OverlayMessage;
        log.debug(`WebSocket message from ${clientId}:`, message);

        // Handle different message types
        switch (message.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            break;

          case 'overlay_command':
            // Broadcast overlay command to all clients
            broadcastOverlay(message.payload);
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
    ws.on('close', (code: number, reason: Buffer) => {
      overlayClients.delete(ws);
      log.info(`WebSocket client disconnected: ${clientId}`, { code, reason: reason.toString() });
    });

    // Handle errors
    ws.on('error', (error: Error) => {
      log.error(`WebSocket error for ${clientId}:`, error);
      overlayClients.delete(ws);
    });
  });

  log.info(`WebSocket server enabled on path /ws`);
}

// Broadcast overlay command to all connected clients
function broadcastOverlay(payload: unknown): void {
  const message = JSON.stringify({
    type: 'overlay_broadcast',
    payload,
    timestamp: new Date().toISOString(),
  });

  let broadcastCount = 0;
  overlayClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      broadcastCount++;
    }
  });

  log.debug(`Broadcasted overlay command to ${broadcastCount} clients`, payload);
}

// Handle viewport updates
function handleViewportUpdate(payload: unknown, clientId: string): void {
  log.debug(`Viewport update from ${clientId}:`, payload);
  // Store viewport configuration for session management
  // This could be persisted to a database in production
}

// SECURITY: Rate limiting for authentication and MCP proxy to prevent abuse
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 auth attempts per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});

// SECURITY: Rate limiting for MCP proxy to prevent abuse
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});

// MCP Server proxy - forward requests to C# MCP server
const mcpProxyOptions: ProxyOptions = {
  target: config.mcpServerUrl,
  changeOrigin: true,
  pathRewrite: {
    '^/mcp': '', // Remove /mcp prefix when forwarding
  },
  onError: (err, _req, res) => {
    log.error('MCP server proxy error:', (err as Error).message);
    (res as Response).status(503).json({
      error: 'MCP server unavailable',
      message: 'The C# MCP server is not responding. It may not be running or configured.',
    });
  },
  onProxyReq: (proxyReq, req) => {
    log.debug(`Proxying ${req.method} ${req.url} to MCP server`);
    if (req.user) {
      proxyReq.setHeader('X-User-Id', req.user.sub || 'unknown');
      proxyReq.setHeader('X-User-Roles', (req.user.roles || []).join(','));
    }
  },
};

app.use('/mcp', authLimiter, authMiddleware, mcpLimiter, createProxyMiddleware(mcpProxyOptions));

// SECURITY: Rate limiting for connection testing to prevent abuse
const connectionTestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 connection tests per minute
  message: {
    success: false,
    error: 'Too many connection test attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Connection testing endpoint with SSRF protection
app.post(
  '/api/test-connection',
  connectionTestLimiter,
  (async (req: Request, res: Response) => {
    try {
      const connection = req.body as Record<string, unknown>;

      // SECURITY: Additional input validation
      if (!connection || typeof connection !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Invalid connection configuration',
        });
      }

      // SECURITY: Sanitize/allow only expected fields
      let sanitizedConnection;
      if (typeof connection.protocol === 'string' && connection.protocol.toLowerCase() === 'kasmvnc') {
        // Only allow client to specify a known targetId
        sanitizedConnection = {
          targetId: typeof connection.targetId === 'string' ? connection.targetId : '',
          protocol: 'kasmvnc' as const,
        };
      } else {
        sanitizedConnection = {
          host: typeof connection.host === 'string' ? connection.host.trim() : '',
          port: parseInt(String(connection.port)),
          protocol: typeof connection.protocol === 'string' ? connection.protocol.toLowerCase() : '',
          ssl: Boolean(connection.ssl),
        };
      }

      // Validate connection configuration (for non-kasmvnc only)
      if (sanitizedConnection.protocol !== 'kasmvnc') {
        const validation = connectionManager.validateConnection(sanitizedConnection);
        if (!validation.valid) {
          log.warn(`🚫 SECURITY: Invalid connection attempt from ${req.ip}:`, validation.errors);
          return res.status(400).json({
            success: false,
            errors: validation.errors,
          });
        }
      }

      // Test the connection (includes SSRF protection)
      const result = await connectionManager.testConnection(sanitizedConnection);

      // SECURITY: Log connection test attempts for monitoring
      let logTarget: string;
      if (sanitizedConnection.protocol === 'kasmvnc') {
        logTarget = sanitizedConnection.targetId || '(unknown)';
      } else {
        logTarget = `${sanitizedConnection.host}:${sanitizedConnection.port}`;
      }
      log.info(`Connection test: ${sanitizedConnection.protocol} - ${logTarget} - ${result.success ? 'SUCCESS' : 'FAILED'}`);

      res.json(result);
    } catch (error) {
      log.error('Connection test failed:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error during connection test',
      });
    }
  }) as RequestHandler,
);

// Protocol defaults endpoint
app.get('/api/protocol-defaults/:protocol', (req: Request, res: Response) => {
  const { protocol } = req.params;
  const defaults = connectionManager.getProtocolDefaults(protocol);

  if (Object.keys(defaults).length === 0) {
    return res.status(404).json({
      error: 'Unknown protocol',
    });
  }

  res.json(defaults);
});

// Connection manager stats endpoint
app.get('/api/connection-stats', (_req: Request, res: Response) => {
  const stats = connectionManager.getStats();
  res.json(stats);
});

// Health check endpoint
app.get('/health', (async (_req: Request, res: Response) => {
  // Check MCP server health
  let mcpServerStatus = 'unknown';
  try {
    const response = await fetch(`${config.mcpServerUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    mcpServerStatus = response.ok ? 'healthy' : 'unhealthy';
  } catch {
    mcpServerStatus = 'unavailable';
  }

  // Check KasmVNC health
  let kasmvncStatus = 'unknown';
  try {
    const response = await fetch(`${config.kasmvncApiUrl}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    kasmvncStatus = response.ok ? 'healthy' : 'unhealthy';
  } catch {
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
      kasmvncApiUrl: config.kasmvncApiUrl,
    },
    services: {
      webServer: 'running',
      websocket: config.mcpWsEnabled ? 'enabled' : 'disabled',
      mcpServer: mcpServerStatus,
      kasmvnc: kasmvncStatus,
      connectedClients: overlayClients.size,
    },
  };

  res.json(health);
}) as RequestHandler);

// MCP configuration endpoint for Cherry Studio integration
app.get('/mcp-config', (req: Request, res: Response) => {
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
      token: `dev-token-${Date.now()}`,
    },
    desktop: {
      target: 'kasmvnc-session',
      kasmvnc_url: config.kasmvncUrl,
      kasmvnc_api_url: config.kasmvncApiUrl,
      viewport: {
        w: 1920,
        h: 1080,
        devicePixelRatio: 1.0,
      },
    },
    capabilities: {
      overlay_system: true,
      multi_monitor: true,
      click_through: true,
      websocket_streaming: config.mcpWsEnabled,
    },
    notes: 'Single-user dev package. Copy this JSON into Cherry Studio MCP slot.',
  };

  res.json(mcpConfig);
});

// Serve static files (web frontend)
app.use(
  express.static(path.join(__dirname, '../public'), {
    maxAge: config.nodeEnv === 'production' ? '1d' : '0',
    etag: true,
    lastModified: true,
  }),
);

// Rate limiter for SPA route to prevent abuse
const spaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
});

// Catch-all route for SPA
app.get('*', spaLimiter, ((req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
}) as RequestHandler);

// Start server
server.listen(config.httpPort, config.bindAddress, () => {
  log.info(`🚀 Overlay Companion MCP Management Server started`);
  log.info(`📍 HTTP server: http://${config.bindAddress}:${config.httpPort}`);
  log.info(`🔌 WebSocket: ${config.mcpWsEnabled ? 'enabled' : 'disabled'} on /ws`);
  log.info(`🌍 Environment: ${config.nodeEnv}`);
  log.info(`📊 Health check: http://${config.bindAddress}:${config.httpPort}/health`);
});
