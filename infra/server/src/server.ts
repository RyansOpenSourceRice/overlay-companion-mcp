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
import { TlsManager, TlsSettings } from './tls-manager.js';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { toNodeHandler } from 'better-auth/node';
import {
  AuthState,
  hashPassword,
} from './auth.js';
import { auth as betterAuth, ensureConnected as ensureBetterAuthDb } from './better-auth.js';
import { SurrealDbStore, ConnectionInput } from './surreal-store.js';
import { createChat } from './chat.js';
import { AudioBridge } from './audio.js';
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
  username?: string;
  email?: string;
  preferred_username?: string;
  roles: string[];
  provider?: string;
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
// Trust reverse proxy (e.g., Caddy/Traefik) so req.secure and X-Forwarded-* are
// respected. We do NOT trust all proxies: `true` would let any client spoof
// X-Forwarded-For and bypass the IP-based rate limiters (§7), and
// express-rate-limit refuses to run on it. Default to loopback (no proxy, e.g.
// local dev / direct access). Behind a reverse proxy, set TRUST_PROXY to the
// proxy hop count or address(es); see .env.example.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
const server = http.createServer(app);
const connectionManager = new ConnectionManager();

// SurrealDB is the only database (Ryan's preferences §9). The store backs
// users, sessions, connections, audit log, and GUI-first app configuration.
// Failure to reach the DB is non-fatal at boot; routes that need it surface a
// clear error. The schema is applied on boot (idempotent OVERWRITE).
const surrealStore = new SurrealDbStore();
// In-app chat assistant (B1): a second client to the same C# MCP tools.
const chat = createChat(surrealStore);
// Voice/transcription bridge (Phase C): cloud fish or local whisper, off by default.
const audioBridge = new AudioBridge(surrealStore);
let schemaSql = '';
try {
  // The schema file ships with the repo; read it for boot-time apply.
  schemaSql = readFileSync(path.join(__dirname, '../../surrealdb/schema/001_init.surql'), 'utf-8');
} catch {
  // In dev the path may differ; the store's ensureSchema is a no-op then.
}
surrealStore.ensureSchema(schemaSql).catch((e) => log.warn('SurrealDB schema apply deferred:', (e as Error).message));

// Authentication is owned by Better Auth (see better-auth.ts), mounted at
// /api/auth. §7: never roll our own identity; sign-ups locked by default;
// rate-limit auth endpoints; delete-account is a feature.

// TLS / HTTPS certificate management (§7). The management server stays HTTP
// behind the terminator (Caddy/Traefik); this manager owns the serving-cert
// lifecycle and renders the terminator config. Settings live in SurrealDB
// app_config (category "tls") and are loaded asynchronously on boot.
const tlsManager = new TlsManager();
void (async () => {
  try {
    const stored = await surrealStore.getConfig('tls.settings');
    if (stored && typeof stored === 'object') {
      tlsManager.update(stored as Partial<TlsSettings>);
    }
  } catch (err) {
    log.warn('[TLS] failed to load TLS settings:', (err as Error).message);
  }
})();

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
// Cookie parsing enables session cookies. CSRF is enforced by the global
// state-changing-method middleware below (and per-route checks on
// delete-account/settings). GET routes are idempotent and sameSite=lax blocks
// cross-site cookie submission. The CodeQL js/missing-token-validation query
// models CSRF as per-route and cannot see the global middleware, so it flags
// the cookie-parser use below — this is a false positive; protection is global.
// codeql[js/missing-token-validation]
app.use(cookieParser());

// CSRF protection for state-changing methods (§7). The session cookie is
// httpOnly + sameSite=lax, which blocks cross-site POSTs, but we also enforce
// a CSRF token on all POST/PUT/DELETE/PATCH routes that carry a session.
// Routes that have their own CSRF check (delete-account, settings) are
// unaffected; this catches any state-changing route that forgot to check.
// GET routes are exempt (idempotent). This resolves the CodeQL
// "cookie middleware without CSRF" finding on state-changing handlers.
// CSRF protection: Better Auth already validates the Origin on its own
// cookie-authenticated state-changing routes (/api/auth). For the app's
// remaining /api/* routes we enforce same-origin on state-changing methods as
// defense-in-depth (session cookie is httpOnly + sameSite=lax; a cross-site
// POST is blocked by the cookie, and this rejects a same-site-host subpage).
const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
app.use(((req: Request, res: Response, next: NextFunction) => {
  if (!STATE_CHANGING.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    const host = req.get('host');
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch { /* ignore malformed origin */ }
    if (host && originHost && originHost !== host.split(':')[0]) {
      res.status(403).json({ error: { code: 'invalid_origin', message: 'Cross-origin state change rejected.' } });
      return;
    }
  }
  next();
}) as RequestHandler);

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

// Better Auth routes — the real auth engine (sign-in, sign-up, sign-out,
// session, passkeys/TOTP/2FA, RBAC, social OAuth). Mounted before app routes.
app.all('/api/auth/*', (async (req: Request, res: Response) => {
  try {
    await ensureBetterAuthDb();
  } catch (err) {
    log.warn('Better Auth DB not connected; request will fail cleanly:', (err as Error)?.message || err);
  }
  await toNodeHandler(betterAuth)(req, res);
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
// ---- Better Auth session middleware -------------------------------------
// All protected routes validate the Better Auth session cookie (or a Bearer
// token for programmatic clients). Better Auth owns session issuance; this
// adapter maps its session onto the req.user/authState shape downstream routes
// expect.

async function requireBetterAuthSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await ensureBetterAuthDb();
    const result = await betterAuth.api.getSession({ headers: req.headers });
    if (!result?.session) {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in required.' } });
      return;
    }
    const u = result.user;
    const isAdmin =
      process.env.ADMIN_EMAIL && u.email ? u.email === process.env.ADMIN_EMAIL : false;
    const au: AuthState = {
      user: {
        id: u.id,
        username: u.name ?? u.email,
        email: u.email,
        displayName: u.name,
        roles: isAdmin ? ['admin', 'overlay:user'] : ['overlay:user'],
        provider: 'better-auth',
      },
      sessionId: result.session.id ?? '',
      csrfToken: '',
    };
    req.user = au.user;
    (req as Request & { authState?: AuthState }).authState = au;
    next();
  } catch (err) {
    log.warn('Better Auth session resolution failed:', (err as Error)?.message || err);
    res.status(500).json({ error: { code: 'internal', message: 'Session resolution failed.' } });
  }
}

async function requireBetterAuthSessionOrBearer(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return requireAuth(req, res, next);
  }
  return requireBetterAuthSession(req, res, next);
}

const authMiddleware = requireBetterAuthSessionOrBearer;

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

function clientIp(req: Request): string | undefined {
  return req.ip;
}

// ---- Authentication routes ----------------------------------------------
// Better Auth owns sign-in/sign-up/sign-out/session (mounted at /api/auth).
// These /auth/* compat routes are thin adapters the SPA auth gate and the
// Playwright suite use, reporting status and the current session.

// GET /auth/status — what auth methods are available (for the login UI).
app.get('/auth/status', (async (_req: Request, res: Response) => {
  res.json({
    enabled: true,
    oidc: { configured: false, issuer: null },
    local: { enabled: true },
    signup: { allowed: true },
  });
}) as RequestHandler);

// GET /auth/me — the current user (or 401).
app.get('/auth/me', requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  res.json({ user: state.user, csrfToken: '' });
}) as RequestHandler);

// POST /auth/local/login — legacy adapter: proxy to Better Auth sign-in with
// the submitted username/email + password. Returns the session user.
app.post('/auth/local/login', loginLimiter, (async (req: Request, res: Response) => {
  const { username, password } = (req.body || {}) as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: { code: 'invalid_request', message: 'username and password required.' } });
    return;
  }
  try {
    const result = await betterAuth.api.signInEmail({ body: { email: username, password }, headers: req.headers });
    const u = result?.user;
    if (!u) {
      res.status(401).json({ error: { code: 'auth_failed', message: 'Invalid credentials.' } });
      return;
    }
    res.json({
      user: {
        id: u.id,
        username: u.name ?? u.email,
        email: u.email,
        roles: [],
        provider: 'better-auth',
      },
      csrfToken: '',
    });
  } catch (err) {
    res.status(400).json({ error: { code: 'auth_failed', message: (err as Error).message } });
  }
}) as RequestHandler);

// POST /auth/logout — revoke the session (Better Auth).
app.post('/auth/logout', (async (req: Request, res: Response) => {
  await ensureBetterAuthDb();
  await betterAuth.api.signOut({ headers: req.headers });
  res.json({ ok: true });
}) as RequestHandler);

// POST /auth/delete-account — delete the signed-in user (§7 Privacy).
app.post('/auth/delete-account', requireBetterAuthSession, (async (req: Request, res: Response) => {
  await ensureBetterAuthDb();
  await betterAuth.api.deleteUser({ headers: req.headers, body: {} });
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
app.get('/api/settings', settingsLimiter, requireBetterAuthSession, (async (_req: Request, res: Response) => {
  const categories = ['auth', 'connection', 'wazuh', 'general', 'tls', 'provider', 'audio'];
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
  out.tls = { ...bootstrapTlsSettings(), ...out.tls };
  out.provider = { ...bootstrapProviderSettings(), ...out.provider };
  out.audio = { ...bootstrapAudioSettings(), ...out.audio };
  res.json(out);
}) as RequestHandler);

// GET /api/settings/:category/:key — a single config value.
app.get('/api/settings/:category/:key', settingsLimiter, requireBetterAuthSession, (async (req: Request, res: Response) => {
  const value = await surrealStore.getConfig(`${req.params.category}.${req.params.key}`);
  if (value === null) {
    res.status(404).json({ error: { code: 'not_found', message: 'Setting not set.' } });
    return;
  }
  res.json({ value: redactSecrets(`${req.params.category}.${req.params.key}`, value) });
}) as RequestHandler);

// PUT /api/settings/:category/:key — create or update a setting. Admin only.
// Requires CSRF. The body is the structured value object.
app.put('/api/settings/:category/:key', settingsLimiter, requireBetterAuthSession, requireAdmin(), (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const { category, key } = req.params;
  const value = req.body as Record<string, unknown>;
  if (!value || typeof value !== 'object') {
    res.status(400).json({ error: { code: 'invalid_request', message: 'Value must be an object.' } });
    return;
  }
  const fullKey = `${category}.${key}`;
  await surrealStore.setConfig(fullKey, value, category, state.user.id);
  // Better Auth auth config is env-driven (§9 GUI-first: env bootstrap); auth
  // settings saved here are stored but not hot-applied to the running auth.
  // TLS settings are hot-applied so the TlsManager and any generated
  // terminator config stay current.
  if (category === 'tls') {
    tlsManager.update(value as Partial<TlsSettings>);
  }
  // Voice/transcription settings (Phase C): drop the cached audio config.
  if (category === 'audio') {
    audioBridge.invalidate();
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

// ---- In-app chat assistant (Phase B1/B3) ---------------------------------
// The chat panel is a SECOND client to the SAME C# MCP tools. It streams an
// OpenRouter completion and, when the model requests a tool, executes the
// allowlisted tool against the MCP `/mcp` endpoint (or serves config tools
// locally). SSE streamed back to the panel.

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/chat — body { messages: OpenAI chat messages[] }. Streams assistant
// text (SSE) and runs the tool loop server-side. Admin users may use config
// tools (B3); role is enforced here, not by the model.
app.post('/api/chat', chatLimiter, requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const { messages } = (req.body ?? {}) as { messages?: Array<Record<string, unknown>> };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: { code: 'bad_request', message: 'messages[] is required.' } });
    return;
  }
  const role = state.user.roles.includes('admin') ? 'admin' : 'user';
  const provider = (await surrealStore.getConfig('provider.chat')) as Record<string, unknown> | null;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const opts = {
    mcpServerUrl: config.mcpServerUrl,
    providerBaseUrl: (provider?.baseUrl as string) || 'https://openrouter.ai/api/v1',
    providerApiKey: (provider?.apiKey as string) || process.env.PROVIDER_API_KEY || '',
    providerModel: (provider?.model as string) || 'deepseek/deepseek-chat-v3-0324',
    userRole: role,
  };

  try {
    if (!opts.providerApiKey) {
      res.write(`data: ${JSON.stringify({ error: 'Chat provider is not configured. Set the provider API key in Settings.' })}\n\n`);
      res.end();
      return;
    }

    // Tool loop: stream text; on tool_calls, execute and re-issue.
    let currentMessages = messages;
    for (let turn = 0; turn < 5; turn++) {
      const collected: Array<string> = [];
      let toolCalls: Array<import('./chat.js').ChatToolCall> = [];

      const gen = chat.stream(opts, currentMessages);
      for await (const chunk of gen) {
        if (chunk.startsWith('{') && chunk.includes('__tool_calls')) {
          try {
            toolCalls = (JSON.parse(chunk).__tool_calls as Array<import('./chat.js').ChatToolCall>) ?? [];
          } catch {
            /* ignore malformed tool marker */
          }
        } else {
          collected.push(chunk);
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
      }

      if (toolCalls.length === 0) break;

      // Execute each tool, append the tool results as assistant + tool messages.
      const toolResults: Array<Record<string, unknown>> = [];
      for (const tc of toolCalls) {
        const result = await chat.runTool(opts, tc);
        toolResults.push({ role: 'tool', tool_call_id: tc.id, content: result });
        res.write(`data: ${JSON.stringify({ tool: tc.name, result })}\n\n`);
      }
      currentMessages = [
        ...currentMessages,
        {
          role: 'assistant',
          content: null,
          tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })),
        },
        ...toolResults,
      ];
    }
  } catch (err) {
    log.error('Chat error:', (err as Error).message);
    res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
  } finally {
    res.end();
  }
}) as RequestHandler);

// GET /api/chat/tools — the bounded allowlist + active display actor, so the
// panel can render what the assistant may do and who currently owns the canvas.
app.get('/api/chat/tools', chatLimiter, requireBetterAuthSession, (async (_req: Request, res: Response) => {
  const actorRaw = await surrealStore.getConfig('general.activeActor');
  res.json({
    allowlist: [
      'draw_overlay', 'template_overlay', 'take_screenshot', 'get_display_info',
      'set_display_actor', 'get_overlay_capabilities',
    ],
    configTools: ['get_config', 'set_config'],
    activeActor: actorRaw ?? 'exterior',
  });
}) as RequestHandler);

// ---- Voice & transcription (Phase C) -------------------------------------
// Optional STT/TTS for the chat panel. Default OFF; provider is "openrouter"
// (fish-audio) or "local" (whisper.cpp / faster-whisper). Enforced here.

const audioLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/audio/transcribe — body { audio: base64, mime } → { text }.
app.post('/api/audio/transcribe', audioLimiter, requireBetterAuthSession, (async (req: Request, res: Response) => {
  const { audio, mime } = (req.body ?? {}) as { audio?: string; mime?: string };
  if (!audio) {
    res.status(400).json({ error: { code: 'bad_request', message: 'audio (base64) is required.' } });
    return;
  }
  try {
    const provider = await audioBridge.provider();
    if (!provider) {
      res.status(400).json({ error: { code: 'audio_disabled', message: 'Voice is disabled. Enable it in Settings → Voice & transcription.' } });
      return;
    }
    const buf = Buffer.from(audio, 'base64');
    const result = await provider.transcribe(buf, mime ?? 'audio/wav');
    res.json({ text: result.text, durationSec: result.durationSec });
  } catch (err) {
    log.error('Audio transcribe failed:', (err as Error).message);
    res.status(502).json({ error: { code: 'audio_error', message: (err as Error).message } });
  }
}) as RequestHandler);

// POST /api/audio/speak — body { text } → synthesized audio bytes (if supported).
app.post('/api/audio/speak', audioLimiter, requireBetterAuthSession, (async (req: Request, res: Response) => {
  const { text } = (req.body ?? {}) as { text?: string };
  if (!text) {
    res.status(400).json({ error: { code: 'bad_request', message: 'text is required.' } });
    return;
  }
  try {
    const provider = await audioBridge.provider();
    if (!provider) {
      res.status(400).json({ error: { code: 'audio_disabled', message: 'Voice is disabled.' } });
      return;
    }
    const out = await provider.synthesize(text);
    if (!out) {
      res.status(501).json({ error: { code: 'tts_unsupported', message: 'The configured provider does not expose a speech endpoint.' } });
      return;
    }
    res.setHeader('Content-Type', out.mime);
    res.setHeader('Content-Length', out.audio.length);
    res.end(out.audio);
  } catch (err) {
    log.error('Audio speak failed:', (err as Error).message);
    res.status(502).json({ error: { code: 'audio_error', message: (err as Error).message } });
  }
}) as RequestHandler);

// ---- TLS / HTTPS management (§7) -----------------------------------------
// Admin-only. The management server stays HTTP behind the terminator; these
// endpoints manage the serving certificate and render terminator config.

const tlsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/tls/status — current serving-cert + mode/terminator info for the GUI.
app.get('/api/tls/status', tlsLimiter, requireBetterAuthSession, (async (_req: Request, res: Response) => {
  res.json(tlsManager.status());
}) as RequestHandler);

// GET /api/tls/config — the rendered terminator TLS config fragment (reference).
app.get('/api/tls/config', tlsLimiter, requireBetterAuthSession, requireAdmin(), (async (_req: Request, res: Response) => {
  res.type('text/plain').send(tlsManager.renderTerminatorConfig());
}) as RequestHandler);

// POST /api/tls/cert — upload the server's serving certificate + private key.
// Admin only. Validates the pair before persisting. Client keys are never
// accepted here (this is the server's own identity).
app.post('/api/tls/cert', tlsLimiter, requireBetterAuthSession, requireAdmin(), (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const body = (req.body ?? {}) as { certificate?: string; privateKey?: string }; // pragma: allowlist secret (request field name, not a literal secret)
  if (typeof body.certificate !== 'string' || typeof body.privateKey !== 'string') { // pragma: allowlist secret (field name only)
    res.status(400).json({ error: { code: 'invalid_request', message: 'certificate and privateKey (PEM) are required.' } }); // pragma: allowlist secret (field name / message, not a real credential)
    return;
  }
  const result = tlsManager.uploadServerCert(body.certificate, body.privateKey);
  if (!result.ok) {
    res.status(400).json({ error: { code: 'invalid_cert', message: result.error } });
    return;
  }
  await surrealStore.appendAudit({
    action: 'tls.cert_uploaded',
    userId: state.user.id,
    actor: 'admin',
    ipAddress: clientIp(req),
    detail: { mode: tlsManager.getSettings().mode },
  });
  res.json({ ok: true, status: tlsManager.status() });
}) as RequestHandler);

// POST /api/tls/self-signed — generate a self-signed server cert (no-domain
// fallback). Explicit admin permission required (opt-in via body.permission,
// per §7 "self-signed generated with permission").
app.post('/api/tls/self-signed', tlsLimiter, requireBetterAuthSession, requireAdmin(), (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const body = (req.body ?? {}) as { permission?: boolean; commonName?: string };
  if (body.permission !== true) {
    res.status(403).json({ error: { code: 'permission_required', message: 'Explicit permission:true is required to generate a self-signed certificate.' } });
    return;
  }
  const result = tlsManager.generateSelfSigned(typeof body.commonName === 'string' ? body.commonName : 'overlay-companion-mcp.local');
  if (!result.ok) {
    res.status(500).json({ error: { code: 'generate_failed', message: result.error } });
    return;
  }
  await surrealStore.appendAudit({
    action: 'tls.self_signed_generated',
    userId: state.user.id,
    actor: 'admin',
    ipAddress: clientIp(req),
    detail: { cn: body.commonName ?? 'overlay-companion-mcp.local' },
  });
  res.json({ ok: true, status: tlsManager.status() });
}) as RequestHandler);

// ---- Saved connections (VM connection management) ------------------------
//
// CRUD over the SurrealDB `connection` table, scoped to the authenticated
// user. Plaintext passwords are never stored or returned: the server keeps an
// Argon2id hash (password_hash) for verification; the web UI holds the
// plaintext transiently in browser storage for the live VM handshake.

const connectionsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

interface ConnectionDto {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  username?: string | null;
  ssl?: boolean;
  description?: string | null;
  createdAt?: string;
  lastConnected?: string | null;
}

function toConnectionDto(row: {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  username?: string | null;
  ssl?: boolean;
  description?: string | null;
  created_at?: string;
  last_connected?: string | null;
}): ConnectionDto {
  return {
    id: String(row.id).replace(/^connection:/, ''),
    name: row.name,
    host: row.host,
    port: row.port,
    protocol: row.protocol,
    username: row.username ?? null,
    ssl: row.ssl ?? false,
    description: row.description ?? null,
    createdAt: row.created_at,
    lastConnected: row.last_connected ?? null,
  };
}

// GET /api/connections — the current user's saved connections.
app.get('/api/connections', connectionsLimiter, requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const rows = await surrealStore.listConnections(state.user.id);
  res.json({ connections: rows.map(toConnectionDto) });
}) as RequestHandler);

// POST /api/connections — create a new saved connection.
app.post('/api/connections', connectionsLimiter, requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const input = parseConnectionBody(req.body);
  if ('error' in input) {
    res.status(400).json({ error: { code: 'invalid_request', message: input.error } });
    return;
  }
  const { password, ...clean } = input;
  const passwordHash = password ? await hashPassword(password) : undefined;
  const saved = await surrealStore.upsertConnection(state.user.id, clean, passwordHash);
  await surrealStore.appendAudit({
    action: 'connection.created',
    userId: state.user.id,
    actor: 'user',
    ipAddress: clientIp(req),
    detail: { id: saved.id, name: saved.name },
  });
  res.status(201).json({ connection: toConnectionDto(saved) });
}) as RequestHandler);

// GET /api/connections/:id — one saved connection.
app.get('/api/connections/:id', connectionsLimiter, requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const row = await surrealStore.getConnection(state.user.id, req.params.id);
  if (!row) {
    res.status(404).json({ error: { code: 'not_found', message: 'Connection not found.' } });
    return;
  }
  res.json({ connection: toConnectionDto(row) });
}) as RequestHandler);

// PUT /api/connections/:id — update an existing saved connection.
app.put('/api/connections/:id', connectionsLimiter, requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const existing = await surrealStore.getConnection(state.user.id, req.params.id);
  if (!existing) {
    res.status(404).json({ error: { code: 'not_found', message: 'Connection not found.' } });
    return;
  }
  const input = parseConnectionBody(req.body);
  if ('error' in input) {
    res.status(400).json({ error: { code: 'invalid_request', message: input.error } });
    return;
  }
  const { password, ...clean } = input;
  // Preserve the existing hash unless a new password was supplied.
  const passwordHash = password
    ? await hashPassword(password)
    : (existing.password_hash ?? undefined);
  const saved = await surrealStore.upsertConnection(state.user.id, { ...clean, id: req.params.id }, passwordHash);
  await surrealStore.appendAudit({
    action: 'connection.updated',
    userId: state.user.id,
    actor: 'user',
    ipAddress: clientIp(req),
    detail: { id: saved.id, name: saved.name },
  });
  res.json({ connection: toConnectionDto(saved) });
}) as RequestHandler);

// DELETE /api/connections/:id — remove a saved connection.
app.delete('/api/connections/:id', connectionsLimiter, requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const deleted = await surrealStore.deleteConnection(state.user.id, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: { code: 'not_found', message: 'Connection not found.' } });
    return;
  }
  await surrealStore.appendAudit({
    action: 'connection.deleted',
    userId: state.user.id,
    actor: 'user',
    ipAddress: clientIp(req),
    detail: { id: req.params.id },
  });
  res.json({ ok: true });
}) as RequestHandler);

// POST /api/connections/:id/touch — record a successful connect (server-authoritative
// timestamp; clients cannot forge last_connected).
app.post('/api/connections/:id/touch', connectionsLimiter, requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const row = await surrealStore.getConnection(state.user.id, req.params.id);
  if (!row) {
    res.status(404).json({ error: { code: 'not_found', message: 'Connection not found.' } });
    return;
  }
  await surrealStore.touchLastConnected(state.user.id, req.params.id);
  res.json({ ok: true });
}) as RequestHandler);

// POST /api/connections/:id/test — test a saved connection against its target.
app.post('/api/connections/:id/test', connectionsLimiter, requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const row = await surrealStore.getConnection(state.user.id, req.params.id);
  if (!row) {
    res.status(404).json({ error: { code: 'not_found', message: 'Connection not found.' } });
    return;
  }
  try {
    const result = await connectionManager.testConnection({
      host: row.host,
      port: row.port,
      protocol: row.protocol as 'kasmvnc' | 'vnc' | 'rdp',
      ssl: row.ssl ?? false,
    });
    await surrealStore.appendAudit({
      action: 'connection.tested',
      userId: state.user.id,
      actor: 'user',
      ipAddress: clientIp(req),
      detail: { id: row.id, ok: result.success ?? false },
    });
    res.json({ success: result.success ?? false, message: result.message });
  } catch (err) {
    await surrealStore.appendAudit({
      action: 'connection.tested',
      userId: state.user.id,
      actor: 'user',
      ipAddress: clientIp(req),
      detail: { id: row.id, ok: false, error: (err as Error).message },
    });
    res.json({ success: false, message: (err as Error).message });
  }
}) as RequestHandler);

// Shared body parsing + validation for create/update. Reuses the SSRF posture
// of /api/test-connection: host pattern allowlist, port range, protocol
// allowlist, and kasmvnc targetId-only.
function parseConnectionBody(body: unknown): ({ password?: string } & ConnectionInput) | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b !== 'object' || b === null) return { error: 'Invalid connection configuration.' };

  const protocol = typeof b.protocol === 'string' ? b.protocol.toLowerCase() : '';
  if (protocol !== 'kasmvnc' && protocol !== 'vnc' && protocol !== 'rdp') {
    return { error: 'Protocol must be kasmvnc, vnc, or rdp.' };
  }
  const host = typeof b.host === 'string' ? b.host.trim() : '';
  if (!host || !/^[a-zA-Z0-9.\-:[\]]+$/.test(host)) {
    return { error: 'Host must be a hostname, IP, or bracketed IPv6 address.' };
  }
  const port = parseInt(String(b.port ?? '0'), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: 'Port must be between 1 and 65535.' };
  }
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 120) {
    return { error: 'Name is required and must be at most 120 characters.' };
  }
  const password = typeof b.password === 'string' && b.password.length > 0 ? b.password : undefined; // pragma: allowlist secret (variable name, not a literal secret)
  if (password !== undefined && password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }
  return {
    name,
    host,
    port,
    protocol,
    password,
    username: typeof b.username === 'string' && b.username.length > 0 ? b.username : null,
    ssl: Boolean(b.ssl),
    description: typeof b.description === 'string' && b.description.length > 0 ? b.description : null,
  };
}

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
  return {
    'auth.betterAuth': {
      enabled: true,
      secretSet: Boolean(process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET),
      baseUrl: process.env.BETTER_AUTH_URL || 'http://localhost:8080',
      trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS || '').split(',').filter(Boolean),
    },
    'auth.local': { enabled: true },
    'auth.signup': { allowed: true },
    'auth.session': { ttlDays: 7 },
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

// TLS bootstrap defaults (§7). The terminator defaults to Caddy and HTTPS is
// off until the admin chooses a mode; the server stays HTTP behind the proxy.
function bootstrapTlsSettings(): Record<string, unknown> {
  return {
    'tls.settings': {
      mode: process.env.TLS_MODE ?? 'none',
      terminator: process.env.TLS_TERMINATOR ?? 'caddy',
      managed: process.env.TLS_MANAGED === 'true',
      redirectHttp: process.env.TLS_REDIRECT_HTTP === 'true',
      acmeDirectory: process.env.TLS_ACME_DIRECTORY ?? '',
      acmeRootCa: process.env.TLS_ACME_ROOT_CA ?? '',
    },
  };
}

// Provider bootstrap defaults (§B1). The in-app chat panel is a second client
// to the same MCP tools; it streams an OpenRouter completion and executes a
// bounded tool allowlist against the C# MCP `/mcp` endpoint. The API key is
// stored via SurrealDB app_config (redacted) and is never returned to the UI.
function bootstrapProviderSettings(): Record<string, unknown> {
  return {
    'provider.chat': {
      baseUrl: process.env.PROVIDER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      model: process.env.PROVIDER_MODEL ?? 'deepseek/deepseek-chat-v3-0324',
      apiKey: process.env.PROVIDER_API_KEY ? '<redacted>' : '',
      enabled: process.env.PROVIDER_CHAT_ENABLED === 'true',
    },
  };
}

// Audio bootstrap defaults (§C). Default OFF; provider may be "openrouter"
// (Fish Audio STT/TTS) or "local" (whisper.cpp / faster-whisper).
function bootstrapAudioSettings(): Record<string, unknown> {
  return {
    'audio.provider': {
      enabled: process.env.AUDIO_ENABLED === 'true',
      provider: process.env.AUDIO_PROVIDER ?? 'off',
      sttModel: process.env.AUDIO_STT_MODEL ?? 'fish-audio/transcribe-1',
      ttsModel: process.env.AUDIO_TTS_MODEL ?? 'fish-audio/s1',
      sttUrl: process.env.AUDIO_STT_URL ?? '',
      ttsUrl: process.env.AUDIO_TTS_URL ?? '',
    },
  };
}

// Hot-apply a settings patch to the running AuthService.
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
      auth: 'enabled',
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
