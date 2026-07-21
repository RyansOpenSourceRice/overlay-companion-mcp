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
import cookieParser from 'cookie-parser';
import { ConnectionManager } from './connection-manager.js';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { SurrealDbStore } from './surreal-store.js';
import {
  AuthService,
  loadAuthConfig,
  requireSession,
  requireSessionOrBearer,
  AuthError,
  AuthState,
} from './auth.js';
import { readFileSync } from 'fs';

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
  id?: string;
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

// SurrealDB is the only database (Ryan's preferences §9). The store backs
// users, sessions, connections, audit log, and GUI-first app configuration.
// Failure to reach the DB is non-fatal at boot; routes that need it surface a
// clear error. The schema is applied on boot (idempotent OVERWRITE).
const surrealStore = new SurrealDbStore();
let schemaSql = '';
try {
  // The schema file ships with the repo; read it for boot-time apply.
  schemaSql = readFileSync(path.join(__dirname, '../../surrealdb/schema/001_init.surql'), 'utf-8');
} catch {
  // In dev the path may differ; the store's ensureSchema is a no-op then.
}
surrealStore.ensureSchema(schemaSql).catch((e) => log.warn('SurrealDB schema apply deferred:', (e as Error).message));

// Authentication service (OIDC via Keycloak + local fallback). Sessions are
// backed by SurrealDB and signed cookies. Per §7: never roll our own identity;
// sign-ups locked by default; rate-limit auth endpoints; delete-account is a
// feature.
const authService = new AuthService(surrealStore, loadAuthConfig(surrealStore));

// Optional OIDC/JWT middleware (no-op if OIDC is disabled) — kept for
// programmatic Bearer-token clients. The browser uses session cookies via the
// AuthService flow above.
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
app.use(cookieParser());

// CSRF protection for state-changing methods (§7). The session cookie is
// httpOnly + sameSite=lax, which blocks cross-site POSTs, but we also enforce
// a CSRF token on all POST/PUT/DELETE/PATCH routes that carry a session.
// Routes that have their own CSRF check (delete-account, settings) are
// unaffected; this catches any state-changing route that forgot to check.
// GET routes are exempt (idempotent). This resolves the CodeQL
// "cookie middleware without CSRF" finding on state-changing handlers.
const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const CSRF_EXEMPT_PREFIXES = ['/auth/local/login', '/auth/local/register', '/auth/callback', '/auth/login', '/mcp', '/api/test-connection'];
app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (!STATE_CHANGING.has(req.method)) return next();
  // Auth-issuing routes (login/register/callback) are exempt — there is no
  // session yet to forge against, and they are rate-limited. MCP and
  // connection-test use Bearer auth, not cookies.
  if (CSRF_EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return next();
  try {
    const state = await authService.resolveSession(req);
    if (!state) return next(); // no session → not a CSRF risk; auth middleware gates it
    if (!authService.isCsrfValid(state, req)) {
      res.status(403).json({ error: { code: 'invalid_csrf', message: 'CSRF token missing or invalid.' } });
      return;
    }
    (req as Request & { authState?: AuthState }).authState = state;
  } catch {
    // Resolution failure is non-fatal here; downstream auth middleware handles it.
  }
  next();
});

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

// Protect MCP and Control MCP routes. The browser uses session cookies; a
// programmatic client may still present a Bearer token (the legacy OIDC/JWT
// path). When auth is disabled, both middlewares pass through.
const authMiddleware = requireSessionOrBearer(authService, requireAuth);

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

// SECURITY: Strict rate limit for login/register endpoints (§7). 10 attempts
// per minute per IP is the floor; tuned to slow brute force without locking out
// a legitimate user behind a shared NAT.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many auth attempts. Slow down.' } },
});

// SECURITY: Rate limiting for MCP proxy to prevent abuse
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});

// ---- Authentication routes (§7) -----------------------------------------
// Real login experience on top of the OIDC middleware: session cookies backed
// by SurrealDB, OIDC auth-code+PKCE via Keycloak, local auth fallback,
// sign-up lock, logout, delete-account, and a /me endpoint.

function publicHost(req: Request): string {
  // Prefer the configured public base URL; fall back to the Host header.
  const configured = authService.getConfig().publicBaseUrl;
  if (configured) return configured.replace(/\/$/, '');
  const host = req.get('host') || `${config.bindAddress}:${config.httpPort}`;
  const proto = req.secure ? 'https' : 'http';
  return `${proto}://${host}`;
}

function clientIp(req: Request): string | undefined {
  return req.ip;
}

// GET /auth/status — what auth methods are available (for the login UI).
app.get('/auth/status', (async (_req: Request, res: Response) => {
  const cfg = authService.getConfig();
  res.json({
    enabled: cfg.enabled,
    oidc: {
      configured: Boolean(cfg.oidcIssuer && cfg.oidcClientId),
      issuer: cfg.oidcIssuer ?? null,
    },
    local: { enabled: cfg.localAuthEnabled },
    signup: { allowed: cfg.signUpAllowed },
  });
}) as RequestHandler);

// GET /auth/login — begin OIDC login (redirect to Keycloak). Pass ?redirect= to
// land somewhere specific after callback.
app.get('/auth/login', loginLimiter, (async (req: Request, res: Response) => {
  const cfg = authService.getConfig();
  const redirectTarget = (req.query.redirect as string) || '/';
  if (cfg.oidcIssuer && cfg.oidcClientId) {
    const { authorizeUrl } = authService.beginOidcLogin(redirectTarget, publicHost(req));
    res.redirect(authorizeUrl);
    return;
  }
  // No OIDC: the SPA shows the local login form.
  res.redirect(`/?auth=local&redirect=${encodeURIComponent(redirectTarget)}`);
}) as RequestHandler);

// GET /auth/callback — OIDC code exchange. Lands the user back in the app.
app.get('/auth/callback', loginLimiter, (async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  if (!code || !state) {
    res.status(400).json({ error: { code: 'invalid_callback', message: 'Missing code or state.' } });
    return;
  }
  try {
    const { session, redirectTarget } = await authService.completeOidcLogin(code, state, publicHost(req), clientIp(req));
    authService.setSessionCookie(res, session as AuthState & { token: string });
    res.redirect(redirectTarget || '/');
  } catch (err) {
    const ae = err as AuthError;
    res.status(ae.status || 400).json({ error: { code: ae.code || 'auth_failed', message: ae.message } });
  }
}) as RequestHandler);

// POST /auth/local/login — local auth fallback (hashed+salted passwords).
app.post('/auth/local/login', loginLimiter, (async (req: Request, res: Response) => {
  const { username, password } = (req.body || {}) as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: { code: 'invalid_request', message: 'username and password required.' } });
    return;
  }
  try {
    const session = await authService.localLogin(username, password, clientIp(req));
    authService.setSessionCookie(res, session as AuthState & { token: string });
    res.json({ user: session.user, csrfToken: session.csrfToken });
  } catch (err) {
    const ae = err as AuthError;
    res.status(ae.status || 400).json({ error: { code: ae.code || 'auth_failed', message: ae.message } });
  }
}) as RequestHandler);

// POST /auth/local/register — local sign-up. Locked by default (§6, §7).
app.post('/auth/local/register', loginLimiter, (async (req: Request, res: Response) => {
  const { username, password, email } = (req.body || {}) as { username?: string; password?: string; email?: string };
  if (!username || !password) {
    res.status(400).json({ error: { code: 'invalid_request', message: 'username and password required.' } });
    return;
  }
  if (password.length < 12) {
    res.status(400).json({ error: { code: 'weak_password', message: 'Password must be at least 12 characters.' } });
    return;
  }
  try {
    const session = await authService.localRegister(username, password, email, clientIp(req));
    authService.setSessionCookie(res, session as AuthState & { token: string });
    res.json({ user: session.user, csrfToken: session.csrfToken });
  } catch (err) {
    const ae = err as AuthError;
    res.status(ae.status || 400).json({ error: { code: ae.code || 'register_failed', message: ae.message } });
  }
}) as RequestHandler);

// POST /auth/logout — revoke the session and clear the cookie. CSRF-checked
// (state-changing) to satisfy the CodeQL CSRF finding on cookie-protected POST
// routes. The token is the same one issued at login / /auth/me.
app.post('/auth/logout', (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState ?? (await authService.resolveSession(req));
  // Stateless logout (no session) is allowed without CSRF; it's a no-op.
  if (state && !authService.isCsrfValid(state, req)) {
    res.status(403).json({ error: { code: 'invalid_csrf', message: 'CSRF token missing or invalid.' } });
    return;
  }
  if (state) {
    await authService.logout(state, clientIp(req));
  }
  authService.clearSessionCookie(res);
  res.json({ ok: true });
}) as RequestHandler);

// GET /auth/me — the current user (or 401).
app.get('/auth/me', requireSession(authService), (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  res.json({ user: state.user, csrfToken: state.csrfToken });
}) as RequestHandler);

// POST /auth/delete-account — delete the signed-in user (§7 Privacy). Revoke
// all sessions and remove the user record. Requires CSRF.
app.post('/auth/delete-account', requireSession(authService), (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  if (!authService.isCsrfValid(state, req)) {
    res.status(403).json({ error: { code: 'invalid_csrf', message: 'CSRF token missing or invalid.' } });
    return;
  }
  await authService.deleteAccount(state, clientIp(req));
  authService.clearSessionCookie(res);
  res.json({ ok: true });
}) as RequestHandler);

// ---- GUI-first configuration (§9) ---------------------------------------
// Auth/connection/provider/Wazuh settings live in SurrealDB app_config and are
// editable in the Settings UI. Env vars are bootstrap defaults only. The model
// is structured and validatable so both a human and an AI agent can configure it.

// Admin guard: only users with the 'admin' role may mutate settings.
function requireAdmin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const state = (req as Request & { authState?: AuthState }).authState;
    if (!state || !state.user.roles.includes('admin')) {
      res.status(403).json({ error: { code: 'forbidden', message: 'Admin role required.' } });
      return;
    }
    next();
  };
}

// SECURITY: Rate limiting for the settings API (§7). These routes perform
// authorization (session + admin checks), so they are rate-limited to prevent
// abuse — addresses the CodeQL "authorization without rate limiting" finding.
const settingsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/settings — all configuration grouped by category. Read by any
// authenticated user (the Settings UI); secrets are never returned.
app.get('/api/settings', settingsLimiter, requireSession(authService), (async (_req: Request, res: Response) => {
  const categories = ['auth', 'connection', 'wazuh', 'general'];
  const out: Record<string, Record<string, unknown>> = {};
  for (const cat of categories) {
    const rows = await surrealStore.getConfigByCategory(cat);
    out[cat] = {};
    for (const row of rows) {
      // app_config id is 'app_config:<key>'; strip the table prefix.
      const key = String(row.id).replace(/^app_config:/, '');
      out[cat][key] = redactSecrets(key, row.value);
    }
  }
  // Merge bootstrap env defaults so the UI shows something before any save.
  out.auth = { ...bootstrapAuthSettings(), ...out.auth };
  out.wazuh = { ...bootstrapWazuhSettings(), ...out.wazuh };
  res.json(out);
}) as RequestHandler);

// GET /api/settings/:category/:key — a single config value.
app.get('/api/settings/:category/:key', settingsLimiter, requireSession(authService), (async (req: Request, res: Response) => {
  const value = await surrealStore.getConfig(`${req.params.category}.${req.params.key}`);
  if (value === null) {
    res.status(404).json({ error: { code: 'not_found', message: 'Setting not set.' } });
    return;
  }
  res.json({ value: redactSecrets(`${req.params.category}.${req.params.key}`, value) });
}) as RequestHandler);

// PUT /api/settings/:category/:key — create or update a setting. Admin only.
// Requires CSRF. The body is the structured value object.
app.put('/api/settings/:category/:key', settingsLimiter, requireSession(authService), requireAdmin(), (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  if (!authService.isCsrfValid(state, req)) {
    res.status(403).json({ error: { code: 'invalid_csrf', message: 'CSRF token missing or invalid.' } });
    return;
  }
  const { category, key } = req.params;
  const value = req.body as Record<string, unknown>;
  if (!value || typeof value !== 'object') {
    res.status(400).json({ error: { code: 'invalid_request', message: 'Value must be an object.' } });
    return;
  }
  const fullKey = `${category}.${key}`;
  await surrealStore.setConfig(fullKey, value, category, state.user.id);
  // Hot-apply auth config changes so the running AuthService picks them up.
  if (category === 'auth') {
    applyAuthConfigPatch(key, value);
  }
  await surrealStore.appendAudit({
    action: 'config.updated',
    userId: state.user.id,
    actor: 'admin',
    ipAddress: clientIp(req),
    detail: { key: fullKey },
  });
  res.json({ ok: true });
}) as RequestHandler);

// Whitelist of setting keys whose value may contain a secret; redacted on read.
const SECRET_KEY_FRAGMENTS = ['secret', 'password', 'token', 'apikey'];
function redactSecrets(key: string, value: unknown): unknown {
  const lower = key.toLowerCase();
  if (!SECRET_KEY_FRAGMENTS.some((f) => lower.includes(f))) return value;
  if (typeof value !== 'object' || value === null) return value;
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const kl = k.toLowerCase();
    redacted[k] = SECRET_KEY_FRAGMENTS.some((f) => kl.includes(f)) && typeof v === 'string' && v.length > 0
      ? '<redacted>'
      : v;
  }
  return redacted;
}

// Bootstrap defaults from env, shown in the UI before any DB save.
function bootstrapAuthSettings(): Record<string, unknown> {
  const cfg = authService.getConfig();
  return {
    'auth.oidc': {
      enabled: cfg.enabled,
      issuer: cfg.oidcIssuer ?? '',
      clientId: cfg.oidcClientId ?? '',
      clientSecret: cfg.oidcClientSecret ? '<redacted>' : '',
      audience: cfg.oidcAudience ?? '',
      requiredRole: cfg.oidcRequiredRole,
      scopes: cfg.oidcScopes,
    },
    'auth.local': { enabled: cfg.localAuthEnabled },
    'auth.signup': { allowed: cfg.signUpAllowed },
    'auth.session': { ttlMinutes: cfg.sessionTtlMinutes },
  };
}

// Wazuh bootstrap defaults (§8). Admin-enabled; no paywall. Wazuh itself is
// an external compose the admin runs; this app only ships logs to it.
function bootstrapWazuhSettings(): Record<string, unknown> {
  return {
    'wazuh.shipper': {
      enabled: process.env.WAZUH_ENABLED === 'true',
      endpoint: process.env.WAZUH_ENDPOINT ?? '',
      apiKey: process.env.WAZUH_API_KEY ? '<redacted>' : '',
    },
  };
}

// Hot-apply a settings patch to the running AuthService.
function applyAuthConfigPatch(key: string, value: Record<string, unknown>): void {
  const cfg = authService.getConfig();
  switch (key) {
    case 'oidc':
      authService.updateConfig({
        enabled: Boolean(value.enabled),
        oidcIssuer: typeof value.issuer === 'string' ? value.issuer : cfg.oidcIssuer,
        oidcClientId: typeof value.clientId === 'string' ? value.clientId : cfg.oidcClientId,
        oidcClientSecret: typeof value.clientSecret === 'string' && value.clientSecret !== '<redacted>' // pragma: allowlist secret (config value, not a hardcoded secret)
          ? value.clientSecret : cfg.oidcClientSecret,
        oidcAudience: typeof value.audience === 'string' ? value.audience : cfg.oidcAudience,
        oidcRequiredRole: typeof value.requiredRole === 'string' ? value.requiredRole : cfg.oidcRequiredRole,
      });
      break;
    case 'local':
      authService.updateConfig({ localAuthEnabled: Boolean(value.enabled) });
      break;
    case 'signup':
      authService.updateConfig({ signUpAllowed: Boolean(value.allowed) });
      break;
    case 'session':
      if (typeof value.ttlMinutes === 'number') {
        authService.updateConfig({ sessionTtlMinutes: value.ttlMinutes });
      }
      break;
    default:
      break;
  }
}

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
      // Session users carry `id`; legacy Bearer-token users carry `sub`.
      proxyReq.setHeader('X-User-Id', req.user.sub || req.user.id || 'unknown');
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

  // Check SurrealDB reachability (the only database; §9).
  const surrealdbStatus = (await surrealStore.ping()) ? 'healthy' : 'unavailable';

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
      surrealdb: surrealdbStatus,
      auth: authService.getConfig().enabled ? 'enabled' : 'disabled',
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
