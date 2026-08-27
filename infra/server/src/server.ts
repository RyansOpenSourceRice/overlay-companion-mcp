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

// OpenTelemetry must be the first import so it instruments everything below.
import { recordHealthCheck } from './tracing.js';

import { bareHostname } from './origin.js';

import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
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
import { APIError, createLocalAccountIssuer } from 'better-auth';
import {
  AuthState,
  hashPassword,
} from './auth.js';
import { auth as betterAuth, ensureBetterAuthReady as ensureBetterAuthDb } from './better-auth.js';
import { LibSqlStore, ConnectionInput } from './libsql-store.js';
import { OpenFgaStore, ConnectionRelation, OpenFgaOptions } from './openfga-store.js';
import { createChat, DEFAULT_PROVIDER_BASE_URL, DEFAULT_PROVIDER_MODEL, DEFAULT_APPROVED_MODELS,
  findApprovedModel, userSelectionKey, type ApprovedModel } from './chat.js';
import { AudioBridge } from './audio.js';
import { seedDemo } from './seed.js';
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
// express-rate-limit refuses to work with it. Default to loopback (no proxy, e.g.
// local dev / direct access). Behind a reverse proxy, set TRUST_PROXY to the
// proxy hop count or address(es). See .env.example.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

const server = http.createServer(app);
const connectionManager = new ConnectionManager();

// libSQL (Turso) is the only database (Ryan's preferences §9). The store backs
// users, sessions, connections, audit log, and GUI-first app configuration.
// Failure to reach the DB is non-fatal at boot; routes that need it surface a
// clear error. The schema is applied on boot (idempotent).
const libSqlStore = new LibSqlStore();
const adaptiveLimits = new AdaptiveLimits(libSqlStore);
// Fine-grained authorization (D-017). OpenFGA is a separate service — never
// embedded in the app — and the store here is the authorization boundary. It
// is OPT-IN via GUI-first config (§9): disabled by default keeps the existing
// owner-scoped behavior (fail-open, no OpenFGA calls); when enabled, the
// connection routes enforce Check()/ListObjects() fail-closed.
const openfgaStore = new OpenFgaStore();
// In-app chat assistant (B1): a second client to the same C# MCP tools.
const chat = createChat(libSqlStore);
// Voice/transcription bridge (Phase C): cloud fish or local whisper, off by default.
const audioBridge = new AudioBridge(libSqlStore);
let schemaSql = '';
// The schema file ships with the repo and in the container image. Its location
// relative to __dirname differs by deployment (repo: infra/server/dist; solo
// app image: /app/dist; web image: /app/server/dist), so probe the candidates.
for (const rel of ['../../libsql/schema/001_init.sql', '../libsql/schema/001_init.sql']) {
  try {
    schemaSql = readFileSync(path.join(__dirname, rel), 'utf-8');
    break;
  } catch {
    // try the next candidate path
  }
}
const tlsManager = new TlsManager();

// Boot sequence: apply the schema first so the settings reads below always find
// their tables, then load TLS/OpenFGA settings and (optionally) seed the demo.
// All best-effort; the app serves HTTP even when the DB is unavailable.
const schemaReady = libSqlStore
  .ensureSchema(schemaSql)
  .catch((e) => log.warn('libSQL schema apply deferred:', (e as Error).message));

void (async () => {
  await schemaReady;
  // TLS / HTTPS certificate management (§7). Settings live in libSQL app_config
  // (category "tls") and are loaded on boot.
  try {
    const stored = await libSqlStore.getConfig('tls.settings');
    if (stored && typeof stored === 'object') {
      tlsManager.update(stored as Partial<TlsSettings>);
    }
  } catch (err) {
    log.warn('[TLS] failed to load TLS settings:', (err as Error).message);
  }
  // OpenFGA settings are GUI-first (§9): bootstrap env defaults, editable in the
  // Settings UI, persisted in app_config (category "openfga").
  try {
    const stored = await libSqlStore.getConfig('openfga.settings');
    if (stored && typeof stored === 'object') {
      openfgaStore.update(stored as Partial<OpenFgaOptions>);
    }
    if (openfgaStore.getOptions().enabled) {
      const provisioned = await openfgaStore.provision();
      log.info(`[OpenFGA] provisioned store ${provisioned.storeId} model ${provisioned.modelId}`);
    }
  } catch (err) {
    log.warn('[OpenFGA] failed to load/provision OpenFGA settings:', (err as Error).message);
  }
  // Demo seed (opt-in via SEED_DEMO=true): provision a demo account with a
  // working VM so a fresh deployment is immediately usable. Best-effort.
  try {
    await ensureBetterAuthDb();
    await seedDemo(libSqlStore);
  } catch (e) {
    log.warn('Demo seed failed:', (e as Error).message);
  }
})();

// Authentication is owned by Better Auth (see better-auth.ts), mounted at
// /api/auth. §7: never roll our own identity; sign-ups locked by default;
// rate-limit auth endpoints; delete-account is a feature.

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
app.use(((req, res, next) => {
  if (!STATE_CHANGING.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    const host = req.get('host');
    let originHost = null;
    try {
      originHost = bareHostname(new URL(origin).hostname);
    } catch (e) { /* leave null */ }
    const hostNorm = host ? bareHostname(host) : null;
    if (hostNorm && originHost && originHost !== hostNorm) {
      return res.status(403).json({ error: { code: 'invalid_origin', message: 'Cross-origin state change rejected.' } });
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
        twoFactorEnabled: Boolean((u as unknown as { twoFactorEnabled?: boolean }).twoFactorEnabled),
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
  // noServer mode: the WSS must NOT attach its own `server.on('upgrade')`
  // handler. In server mode with a `path`, ws aborts ANY upgrade whose path
  // doesn't match with `400 Bad Request` (websocket-server.js:277-280) — and
  // since it registers before the KasmVNC upgrade handler below, that 400
  // killed every `/websockify` desktop connection. Instead, the shared
  // `server.on('upgrade')` handler below routes `/ws` here via `handleUpgrade`.
  wss = new WebSocketServer({
    noServer: true,
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

    // Late joiners must see overlays already on screen.
    sendOverlayState(ws);

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

// --- MCP -> browser overlay relay -------------------------------------
// The C# MCP server broadcasts overlay lifecycle events on its
// /ws/overlays WebSocket. Until now nothing subscribed, so overlays that
// reported success never reached any renderer. This client bridges those
// events onto the browser-facing /ws channel and keeps a current-state list
// so late-joining pages get an instant sync_state.
let activeOverlays: Array<Record<string, unknown>> = [];
let mcpOverlayWs: WebSocket | null = null;
const MCP_OVERLAY_RECONNECT_MS = 3000;

function pushToBrowsers(type: string, payload: Record<string, unknown>): void {
  const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  for (const client of overlayClients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

// Normalize the C# internal OverlayElement (nested bounds, camelCase) into
// the flat snake_case shape the browser renderer expects.
function normalizeOverlay(el: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!el) return el ?? {};
  const b = (el.bounds ?? {}) as Record<string, unknown>;
  return {
    id: String(el.id ?? ''),
    x: Number(b.x ?? el.x ?? 0),
    y: Number(b.y ?? el.y ?? 0),
    width: Number(b.width ?? el.width ?? 0),
    height: Number(b.height ?? el.height ?? 0),
    color: el.color ?? '#ffff00',
    opacity: typeof el.opacity === 'number' ? el.opacity : 0.5,
    template: el.template ?? null,
  };
}

function startMcpOverlayBridge(mcpUrl: string): void {
  if (!mcpUrl || mcpOverlayWs) return;
  try {
    mcpOverlayWs = new WebSocket(`${mcpUrl.replace(/\/$/, '')}/ws/overlays`);
  } catch { mcpOverlayWs = null; return; }

  const ws = mcpOverlayWs;
  ws.on('open', () => log.info('Overlay bridge connected to MCP server'));
  ws.on('message', (data: WebSocket.RawData) => {
    let evt: Record<string, unknown>;
    try { evt = JSON.parse(data.toString()) as Record<string, unknown>; } catch { return; }
    switch (evt.type) {
      case 'sync_state':
        activeOverlays = ((evt.overlays as Array<Record<string, unknown>>) ?? []).map(normalizeOverlay);
        break;
      case 'overlay_created': {
        const ov = normalizeOverlay(evt.overlay as Record<string, unknown>);
        activeOverlays.push(ov);
        pushToBrowsers('overlay_broadcast', { action: 'create', overlay: ov, total: activeOverlays.length });
        break;
      }
      case 'overlay_removed': {
        activeOverlays = activeOverlays.filter((o) => String(o.id) !== String(evt.overlay_id));
        pushToBrowsers('overlay_broadcast', { action: 'remove', id: evt.overlay_id });
        break;
      }
      case 'clear_overlays':
        activeOverlays = [];
        pushToBrowsers('overlay_broadcast', { action: 'clear' });
        break;
    }
  });
  ws.on('close', () => {
    mcpOverlayWs = null;
    setTimeout(() => startMcpOverlayBridge(mcpUrl), MCP_OVERLAY_RECONNECT_MS);
  });
  ws.on('error', () => { /* close handler reconnects */ });
}

// A page connecting mid-session should immediately learn what is on screen.
// Called after the connection is registered in overlayClients so no event
// broadcast during the handshake is missed (state push arrives after 'add').
function sendOverlayState(ws: WebSocket): void {
  ws.send(JSON.stringify({
    type: 'overlay_broadcast',
    payload: { action: 'state', overlays: activeOverlays },
    timestamp: new Date().toISOString(),
  }));
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

// Let the interior assistant retune page-side mirror cadence live (R14).
mirrorControl.send = (payload: Record<string, unknown>): void =>
  pushToBrowsers('mirror_control', payload);

// Handle viewport updates
function handleViewportUpdate(payload: unknown, clientId: string): void {
  log.debug(`Viewport update from ${clientId}:`, payload);
  // Store viewport configuration for session management
  // This could be persisted to a database in production
}

// R10: adaptive per-identity limiting for app surfaces (chat, connections,
// MCP proxy). Admin knobs in libSQL (`limits.<surface>`), short block
// windows, admin bypass on chat. Login/TOTP keep strict IP rate limits below.
import { AdaptiveLimits } from './adaptive-limits.js';
import { pushFrame, pushPreview, latestFrame, currentPreview, mirrorControl } from './screen-mirror.js';

// SECURITY: Rate limiting for authentication and MCP proxy to prevent abuse
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 auth attempts per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});

// SECURITY: Shared knobs for the auth brute-force budgets. Keep the per-IP
// limiters below and the twoFactor plugin's accountLockout (10 attempts / 15
// min) aligned so they can't drift apart.
const AUTH_WINDOW_MS = 60 * 1000;
const MAX_AUTH_ATTEMPTS = 10;

// SECURITY: Strict rate limit for login/register endpoints (§7). 10 attempts
// per minute per IP is the floor; tuned to slow brute force without locking out
// a legitimate user behind a shared NAT.
const loginLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: MAX_AUTH_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many auth attempts. Slow down.' } },
});

// SECURITY: Separate per-IP limiter for the TOTP second step so a few wrong
// codes (plus the password step) do not exhaust the shared login budget. It is
// a complement to — not a replacement for — the twoFactor plugin's per-account
// accountLockout (same MAX_AUTH_ATTEMPTS, fixed 15-min window), which is what
// actually stops brute-force across rotating IPs. Do not remove accountLockout
// believing this limiter alone is sufficient.
const totpLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: MAX_AUTH_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many verification attempts. Slow down.' } },
});

// SECURITY: Rate limiting for MCP proxy to prevent abuse
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});

type AuthedReq = Request & { authState?: { user: { id: string; role?: string | null } } };

function makeLimitGuard(surface: 'chat' | 'connections' | 'mcpProxy', costArg?: (req: Request) => number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const state = (req as AuthedReq).authState;
    const decision = await adaptiveLimits.consume(surface, {
      userId: state?.user?.id ?? null,
      role: (state?.user as unknown as { roles?: string[] })?.roles?.includes('admin') ? 'admin' : (state?.user ? 'user' : null),
      ip: req.ip ?? null,
    }, costArg ? costArg(req) : 1);
    if (!decision.allowed) {
      res.setHeader('Retry-After', Math.ceil(decision.retryAfterMs / 1000));
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: `Rate limited. Retry after ${Math.ceil(decision.retryAfterMs / 1000)}s.`,
        },
        retryAfterMs: decision.retryAfterMs,
      });
      return;
    }
    res.setHeader('X-RateLimit-Limit', String(decision.limit));
    res.setHeader('X-RateLimit-Remaining', Number.isFinite(decision.remaining) ? String(decision.remaining) : 'Infinity');
    next();
  };
}

// ---- Authentication routes (§7) -----------------------------------------
// Real login experience on top of the OIDC middleware: session cookies backed
// by libSQL, OIDC auth-code+PKCE via Keycloak, local auth fallback,
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
    // §7 optional passkeys (WebAuthn) + TOTP. Passkeys only function when the
    // deployment origin matches the configured RP ID, so reflect that here
    // instead of advertising them when the RP ID is unset (falls back to
    // 'localhost' in better-auth.ts).
    passkey: { enabled: Boolean(process.env.BETTER_AUTH_PASSKEY_RP_ID) },
    totp: { enabled: true }, // TOTP has no origin requirement
  });
}) as RequestHandler);

// GET /auth/me — the current user (or 401).
app.get('/auth/me', requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  res.json({ user: state.user, csrfToken: '' });
}) as RequestHandler);

// Map a Better Auth user to the app's response shape (shared by the local
// login and TOTP-verify success paths so the user contract stays consistent).
function buildUserResponse(u: { id: string; name?: string | null; email?: string | null }): Record<string, unknown> {
  return {
    user: {
      id: u.id,
      username: (u.name && u.name.trim()) || u.email || 'user',
      email: u.email ?? undefined,
      roles: [],
      provider: 'better-auth',
    },
    csrfToken: '',
  };
}

// Safe error-message extraction for catch blocks (a thrown value may not be an
// Error instance).
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Full shape of a Better Auth sign-in/verify response with the two-factor
// plugin's added fields and an Express-headers wrapper, as produced by
// api.* calls with returnHeaders: true.
interface AuthApiResponse {
  headers?: Headers;
  response?: {
    user?: { id: string; name?: string | null; email?: string | null };
    twoFactorRedirect?: boolean;
    twoFactorMethods?: string[];
  };
}

// Unwrap the plugin-added twoFactor fields from a returnHeaders response.
function authResponseFields(v: AuthApiResponse | undefined): { twoFactorRedirect: boolean; twoFactorMethods: string[] } {
  return {
    twoFactorRedirect: Boolean(v?.response?.twoFactorRedirect),
    twoFactorMethods: v?.response?.twoFactorMethods ?? [],
  };
}

// Unwrap the signed-in user from a returnHeaders response (undefined if absent).
function authResponseUser(v: AuthApiResponse | undefined): { id: string; name?: string | null; email?: string | null } | undefined {
  return v?.response?.user;
}

// Extract the HTTP status code from a Better Auth response when it resolves to
// an APIError (e.g. wrong password → 401, two-factor lockout → 429) rather than
// a successful user payload. Returns undefined when the response carries a user
// (no error) so callers can distinguish success from failure.
function authResponseErrorStatus(v: AuthApiResponse | undefined): number | undefined {
  const body = v?.response;
  if (!body) return undefined;
  if ('user' in body) return undefined;
  const maybe = body as unknown as { statusCode?: number };
  return typeof maybe.statusCode === 'number' ? maybe.statusCode : undefined;
}

// Respond for the "no signed-in user" branch of the auth adapters, distinguishing
// a lockout/rate limit (429) from a bad credential or code (401).
function respondAuthNoUser(res: Response, v: AuthApiResponse | undefined, badMessage: string): void {
  const errStatus = authResponseErrorStatus(v);
  if (errStatus != null && errStatus < 500) {
    const locked = errStatus === 429;
    res.status(errStatus).json({
      error: {
        code: locked ? 'too_many_attempts' : 'auth_failed',
        message: locked ? 'Too many attempts. Try again shortly.' : badMessage,
      },
    });
    return;
  }
  res.status(401).json({ error: { code: 'auth_failed', message: badMessage } });
}

// Sentinel for a runtime that lacks Headers.getSetCookie (engines require
// Node >= 18.14). handleAuthError matches on this type, not on an error-message
// string, so a reworded message can't silently change the response code.
class MissingGetSetCookieError extends Error {
  constructor() {
    super('Headers.getSetCookie is unavailable; Node >= 18.14 is required.');
    this.name = 'MissingGetSetCookieError';
  }
}

// Shared catch for the auth adapters. A thrown BetterAuth APIError carries a
// statusCode; map a 4xx (bad/expired code, rate limit) to a client error and a
// 5xx (or anything else like a DB outage or a bug) to a server error. Expected
// auth failures (wrong password) are typically handled by the 401 early-return
// branch, so this catch is the safety net for thrown errors.
function handleAuthError(res: Response, err: unknown, userMessage = 'Sign-in failed.'): void {
  if (err instanceof MissingGetSetCookieError) {
    log.error('Headers.getSetCookie unavailable:', errMsg(err));
    res.status(500).json({ error: { code: 'server_error', message: 'Internal server error.' } });
    return;
  }
  if (err instanceof APIError) {
    const sc = (err as APIError & { statusCode?: number }).statusCode ?? 400;
    log.warn('Auth flow error:', errMsg(err));
    if (sc >= 400 && sc < 500) {
      // Preserve the real status code (e.g. 429 on rate-limit/lockout) so the
      // client can distinguish a lockout from a bad code, without leaking
      // internal error details in the message.
      const locked = sc === 429;
      res.status(sc).json({
        error: {
          code: locked ? 'too_many_attempts' : 'auth_failed',
          message: locked ? 'Too many attempts. Try again shortly.' : userMessage,
        },
      });
      return;
    }
  }
  log.error('Unexpected auth failure:', errMsg(err));
  res.status(500).json({ error: { code: 'server_error', message: 'Internal server error.' } });
}

// Forward Better Auth's response headers (notably Set-Cookie for the session
// and two_factor cookies) from an api.* call to the Express response. Better
// Auth only returns headers when the call opts into returnHeaders: true.
function applyBetterAuthHeaders(res: Response, headers: Headers | undefined): void {
  if (!headers) return;
  // getSetCookie (Node >= 18.14, matching the engines requirement) returns
  // every Set-Cookie value. Fail loudly (typed error) rather than silently
  // forwarding only the first cookie, which would break the session +
  // two_factor cookie flow on a misconfigured runtime.
  if (typeof headers.getSetCookie !== 'function') {
    throw new MissingGetSetCookieError();
  }
  for (const c of headers.getSetCookie()) res.append('Set-Cookie', c);
}

// POST /auth/local/login — legacy adapter: proxy to Better Auth sign-in with
// the submitted username/email + password. Returns the session user.
app.post('/auth/local/login', loginLimiter, (async (req: Request, res: Response) => {
  const { username, password } = (req.body || {}) as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: { code: 'invalid_request', message: 'username and password required.' } });
    return;
  }
  try {
    await ensureBetterAuthDb();
    const raw = await betterAuth.api.signInEmail({ body: { email: username, password }, headers: req.headers, returnHeaders: true });
    // TOTP-enabled account: Better Auth (via the two-factor plugin) returns a
    // challenge instead of a user. The static return type doesn't include the
    // plugin-added twoFactorRedirect, so widen it here.
    const result = raw as (typeof raw & AuthApiResponse) | undefined;
    const { twoFactorRedirect, twoFactorMethods } = authResponseFields(result);
    if (twoFactorRedirect) {
      applyBetterAuthHeaders(res, result?.headers);
      res.json({
        twoFactor: { required: true, methods: twoFactorMethods.length ? twoFactorMethods : ['totp'] },
        csrfToken: '',
      });
      return;
    }
    const u = authResponseUser(result);
    if (!u) {
      respondAuthNoUser(res, result, 'Invalid credentials.');
      return;
    }
    applyBetterAuthHeaders(res, result?.headers);
    res.json(buildUserResponse(u));
  } catch (err) {
    handleAuthError(res, err);
  }
}) as RequestHandler);

// POST /auth/local/verify-totp — second step for a TOTP-enabled account after
// /auth/local/login returned twoFactor.required. Proxies Better Auth's
// verify-totp endpoint. The sign-in step already set Better Auth's signed
// `two_factor` cookie on this browser session, so only the 6-digit code is
// needed here; the cookie (forwarded in headers) authorizes the verify.
app.post('/auth/local/verify-totp', totpLimiter, (async (req: Request, res: Response) => {
  const { code } = (req.body || {}) as { code?: string };
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: { code: 'invalid_request', message: 'A 6-digit code is required.' } });
    return;
  }
  try {
    await ensureBetterAuthDb();
    const result = (await betterAuth.api.verifyTOTP({ body: { code, trustDevice: false }, headers: req.headers, returnHeaders: true })) as AuthApiResponse | undefined;
    const u = authResponseUser(result);
    if (!u) {
      respondAuthNoUser(res, result, 'Invalid or expired code.');
      return;
    }
    applyBetterAuthHeaders(res, result?.headers);
    res.json(buildUserResponse(u));
  } catch (err) {
    handleAuthError(res, err, 'Verification failed.');
  }
}) as RequestHandler);

// POST /auth/logout — revoke the session (Better Auth).
app.post('/auth/logout', (async (req: Request, res: Response) => {
  await ensureBetterAuthDb();
  const signOutResult = await betterAuth.api.signOut({ headers: req.headers, returnHeaders: true });
  applyBetterAuthHeaders(res, signOutResult?.headers);
  res.json({ ok: true });
}) as RequestHandler);

// POST /auth/delete-account — delete the signed-in user (§7 Privacy).
// Re-authentication is mandatory: the password must match, and when the
// account has TOTP two-factor enabled the current 6-digit code must also be
// verified before the account is deleted.
app.post('/auth/delete-account', requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const body = (req.body ?? {}) as { password?: string; totpCode?: string }; // pragma: allowlist secret (reads a request field, not a hardcoded credential)
  if (typeof body.password !== 'string' || !body.password) {
    res.status(400).json({ error: { code: 'password_required', message: 'Enter your password to delete your account.' } });
    return;
  }
  // Verify the password directly via the same credential lookup sign-in uses
  // (findUserByEmail + verify), so account deletion re-auth is consistent.
  const passwordOk = await verifyPasswordReauth(state.user.email, body.password);
  if (!passwordOk) {
    res.status(400).json({ error: { code: 'invalid_password', message: 'Incorrect password.' } });
    return;
  }
  if (state.user.twoFactorEnabled) {
    if (typeof body.totpCode !== 'string' || !body.totpCode.trim()) {
      res.status(400).json({ error: { code: 'totp_required', message: 'Enter your authenticator code to delete your account.' } });
      return;
    }
    try {
      // Better Auth's verify-totp endpoint validates the code against the
      // stored secret when a valid session is present (it does not mint a new
      // session in that case).
      await ensureBetterAuthDb();
      await betterAuth.api.verifyTOTP({ headers: req.headers, body: { code: body.totpCode.trim() } });
    } catch {
      res.status(400).json({ error: { code: 'invalid_totp', message: 'Incorrect authenticator code.' } });
      return;
    }
  }
  try {
    await ensureBetterAuthDb();
    const ctx = await betterAuth.$context;
    await ctx.internalAdapter.deleteUser(state.user.id);
    await ctx.internalAdapter.deleteUserSessions(state.user.id);
    // Clear the session cookies (including the session-data cache cookie) so
    // the now-deleted session is not served from the client-side cache.
    const signOutResult = await betterAuth.api.signOut({ headers: req.headers, returnHeaders: true });
    applyBetterAuthHeaders(res, signOutResult?.headers);
    res.json({ ok: true });
  } catch (err) {
    log.warn('delete-account deletion failed:', (err as Error)?.message || err);
    res.status(500).json({ error: { code: 'delete_failed', message: 'Could not delete the account.' } });
  }
}) as RequestHandler);

// Re-authentication password check. Mirrors Better Auth's sign-in credential
// lookup (findUserByEmail + includeAccounts, then match the local credential
// account and verify its hash), which works with the libSQL (Kysely) adapter.
async function verifyPasswordReauth(email: string | undefined, password: string): Promise<boolean> {
  if (!email) return false;
  try {
    const ctx = await betterAuth.$context;
    const record = await ctx.internalAdapter.findUserByEmail(email.toLowerCase(), { includeAccounts: true });
    if (!record) return false;
    const issuer = createLocalAccountIssuer('credential');
    const account = record.accounts.find(
      (a) => a.providerId === 'credential' && a.issuer === issuer && a.accountId === record.user.id,
    );
    if (!account?.password) return false;
    return await ctx.password.verify({ hash: account.password, password });
  } catch {
    return false;
  }
}

// ---- GUI-first configuration (§9) ---------------------------------------
// Auth/connection/provider/Wazuh settings live in libSQL app_config and are
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

// OpenFGA authorization gate (D-017). When OpenFGA is enabled, the signed-in
// user must hold the given relation on the connection or the request is denied
// (fail-closed). When disabled, this is a no-op: the owner-scoped store query
// is the only gate (unchanged behavior). Returns true when the request may
// proceed, false after a response has been sent.
async function requireConnectionRelation(
  req: Request,
  res: Response,
  relation: ConnectionRelation,
  connectionId: string,
): Promise<boolean> {
  const state = (req as Request & { authState?: AuthState }).authState;
  if (!state) {
    res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in required.' } });
    return false;
  }
  const allowed = await openfgaStore.check(state.user.id, relation, connectionId);
  if (!allowed) {
    res.status(403).json({ error: { code: 'forbidden', message: 'You do not have permission to access this connection.' } });
    return false;
  }
  return true;
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
  const categories = ['auth', 'connection', 'wazuh', 'general', 'tls', 'provider', 'audio', 'openfga'];
  const out: Record<string, Record<string, unknown>> = {};
  for (const cat of categories) {
    const rows = await libSqlStore.getConfigByCategory(cat);
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
  out.openfga = { ...bootstrapOpenFgaSettings(), ...out.openfga };
  res.json(out);
}) as RequestHandler);

// GET /api/settings/:category/:key — a single config value.
app.get('/api/settings/:category/:key', settingsLimiter, requireBetterAuthSession, (async (req: Request, res: Response) => {
  const value = await libSqlStore.getConfig(`${req.params.category}.${req.params.key}`);
  if (value === null) {
    res.status(404).json({ error: { code: 'not_found', message: 'Setting not set.' } });
    return;
  }
  res.json({ value: redactSecrets(`${req.params.category}.${req.params.key}`, value) });
}) as RequestHandler);

// GET /api/admin/limits — current adaptive-limit knobs (defaults when unset).
app.get('/api/admin/limits', settingsLimiter, requireBetterAuthSession, requireAdmin(), (async (_req: Request, res: Response) => {
  const surfaces = ['chat', 'connections', 'mcpProxy'] as const;
  const defaults: Record<string, { pointsPerWindow: number; windowMs: number; blockDurationMs: number }> = {
    chat: { pointsPerWindow: 60, windowMs: 60000, blockDurationMs: 15000 },
    connections: { pointsPerWindow: 240, windowMs: 60000, blockDurationMs: 15000 },
    mcpProxy: { pointsPerWindow: 600, windowMs: 60000, blockDurationMs: 15000 },
  };
  const out: Record<string, unknown> = {};
  for (const surf of surfaces) {
    const stored = await libSqlStore.getConfig(`limits.${surf}`);
    const value = (stored && typeof stored === 'object'
      ? ((stored as Record<string, unknown>).value ?? stored)
      : null) as Record<string, unknown> | null;
    out[surf] = { ...defaults[surf], ...(value ?? {}), configured: Boolean(value) };
  }
  const baRaw = await libSqlStore.getConfig('limits.bypassAdmin');
  const baVal = baRaw && typeof baRaw === 'object' ? (baRaw as Record<string, unknown>).value : baRaw;
  res.json({ surfaces: out, bypassAdmin: baVal !== false });
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
  // Preserve any secret value that arrives as the '<redacted>' placeholder
  // (the GET redacts secrets before returning them; a PUT must not write the
  // placeholder string back over the real secret).
  const existing = await libSqlStore.getConfig(fullKey);
  await libSqlStore.setConfig(fullKey, mergePreservingSecrets(existing, value), category, state.user.id);
  if (fullKey.startsWith('limits.')) void adaptiveLimits.refreshAll();
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
  // Fine-grained authorization (D-017): hot-apply + provision the OpenFGA
  // store/model so a Settings save takes effect without a restart.
  if (category === 'openfga') {
    openfgaStore.update(value as Partial<OpenFgaOptions>);
    if (openfgaStore.getOptions().enabled) {
      const provisioned = await openfgaStore.provision();
      log.info(`[OpenFGA] provisioned store ${provisioned.storeId} model ${provisioned.modelId}`);
    }
  }
  await libSqlStore.appendAudit({
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

// ---- Model selection (delegated, admin-approved) ---------------------------
// Admins curate provider/model combos via /api/chat/models; users pick only
// from that list (or leave unset for the admin default). Resolution never
// trusts client-supplied baseUrl/model — only ids that exist in the registry.

async function approvedModels(): Promise<ApprovedModel[]> {
  const cfg = (await libSqlStore.getConfig('provider.approved')) as { models?: ApprovedModel[] } | null;
  const list = Array.isArray(cfg?.models) ? cfg!.models! : ((bootstrapProviderSettings()['provider.approved'] as { models: ApprovedModel[] }).models);
  return list.filter((m) => m && typeof m.id === 'string' && typeof m.model === 'string' && typeof m.baseUrl === 'string');
}

// GET /api/chat/models — any authenticated user may LIST the approved
// combinations and see their current effective selection. Secrets are not part
// of the response.
app.get('/api/chat/models', makeLimitGuard('chat'), requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const [models, pref] = await Promise.all([
    approvedModels(),
    libSqlStore.getConfig(userSelectionKey(state.user.id)) as Promise<{ modelId?: string } | null>,
  ]);
  const providerCfg = (await libSqlStore.getConfig('provider.chat')) as Record<string, unknown> | null;
  const activeId = models.find((m) => m.id === pref?.modelId)?.id ?? 'default';
  // Users only need id/label/model to choose; baseUrl is an admin concern and
  // stays server-side (OpenCodeReview finding).
  res.json({
    active: activeId,
    default: {
      label: 'Admin default',
      model: String(providerCfg?.model ?? process.env.PROVIDER_MODEL ?? DEFAULT_PROVIDER_MODEL),
    },
    models: models.map((m) => ({ id: m.id, label: m.label, model: m.model })),
  });
}) as RequestHandler);

// POST /api/chat/models/select {modelId} — choose among approved entries; the
// id must exist or the choice is rejected rather than silently ignored.
app.post('/api/chat/models/select', makeLimitGuard('chat'), requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const { modelId } = (req.body ?? {}) as { modelId?: string };
  if (!modelId) {
    // No id means "back to admin default" — clear the per-user override.
    await libSqlStore.setConfig(userSelectionKey(state.user.id), {}, 'provider');
    res.json({ success: true, active: 'default' });
    return;
  }
  const models = await approvedModels();
  if (!models.some((m) => m.id === modelId)) {
    res.status(403).json({ error: { code: 'not_approved', message: `Model ${modelId} is not in the approved list.` } });
    return;
  }
  await libSqlStore.setConfig(userSelectionKey(state.user.id), { modelId }, 'provider');
  res.json({ success: true, active: modelId });
}) as RequestHandler);

// POST /api/chat/models — ADMIN curation: add/update/remove registry entries.
app.post('/api/chat/models', makeLimitGuard('chat'), requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  if (!state.user.roles.includes('admin')) {
    res.status(403).json({ error: { code: 'forbidden', message: 'Admin role required to curate models.' } });
    return;
  }
  const { action, entry } = (req.body ?? {}) as { action?: string; entry?: Partial<ApprovedModel> };
  const current = await approvedModels();
  let next: ApprovedModel[];
  if (action === 'remove') {
    if (!entry?.id || !current.some((m) => m.id === entry.id)) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such model id.' } });
      return;
    }
    next = current.filter((m) => m.id !== entry!.id);
  } else {
    // add-or-update: keep fields strict so nothing leaks into requests later.
    if (!entry?.id || !entry?.model || !entry?.baseUrl ||
        !/^https?:\/\//.test(entry.baseUrl)) {
      res.status(400).json({ error: { code: 'bad_request', message: 'entry{id,label?,baseUrl,model} with http(s) baseUrl required.' } });
      return;
    }
    const clean: ApprovedModel = {
      id: entry.id.slice(0, 100),
      label: (entry.label ?? '').slice(0, 120),
      baseUrl: entry.baseUrl,
      model: entry.model.slice(0, 200),
    };
    next = [...current.filter((m) => m.id !== clean.id), clean];
  }
  await libSqlStore.setConfig('provider.approved', { models: next }, 'provider');
  res.json({ success: true, count: next.length });
}) as RequestHandler);

// POST /api/chat — body { messages: OpenAI chat messages[], modelId? }. Streams assistant
// text (SSE) and runs the tool loop server-side. Admin users may use config
// tools (B3); role is enforced here, not by the model.
app.post('/api/chat', makeLimitGuard('chat'), requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const { messages } = (req.body ?? {}) as { messages?: Array<Record<string, unknown>> };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: { code: 'bad_request', message: 'messages[] is required.' } });
    return;
  }
  const role = state.user.roles.includes('admin') ? 'admin' : 'user';
  const provider = (await libSqlStore.getConfig('provider.chat')) as Record<string, unknown> | null;

  // Resolve the chat model: explicit body.modelId OR the user's saved
  // selection — but ONLY if that id exists in the approved registry. Anything
  // else falls back to the admin default. Raw baseUrl/model from the client is
  // never used for non-admin bodies (prevents endpoint/key misuse).
  const models = await approvedModels();
  let selection: ApprovedModel | null = null;
  const requestedId = typeof req.body?.modelId === 'string' ? req.body.modelId : undefined;
  const wantId = requestedId ?? ((await libSqlStore.getConfig(userSelectionKey(state.user.id)) as { modelId?: string } | null)?.modelId);
  if (wantId) selection = models.find((m) => m.id === wantId) ?? null;
  if (!selection && provider?.model && !wantId) {
    // Admin default remains addressable as an approved pseudo-entry when the
    // registry does not override it.
    selection = {
      id: 'default',
      baseUrl: String(provider.baseUrl ?? process.env.PROVIDER_BASE_URL ?? DEFAULT_PROVIDER_BASE_URL),
      model: String(provider.model),
    };
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const opts = {
    mcpServerUrl: config.mcpServerUrl,
    providerBaseUrl: selection?.baseUrl ?? DEFAULT_PROVIDER_BASE_URL,
    providerApiKey: (provider?.apiKey as string) || process.env.PROVIDER_API_KEY || '',
    providerModel: selection?.model ?? DEFAULT_PROVIDER_MODEL,
    userRole: role,
    userId: state.user.id,
  };

  try {
    if (!opts.providerApiKey) {
      res.write(`data: ${JSON.stringify({ error: 'Chat provider is not configured. Set the provider API key in Settings.' })}\n\n`);
      res.end();
      return;
    }

    // Ground-truth snapshot up front: weak models routinely claim they cannot
    // annotate/switch models or hallucinate client limits. This fixed system
    // message states what IS possible so they attempt the right tool first.
    const actorCfg = (await libSqlStore.getConfig('general.activeActor')) as Record<string, unknown> | null;
    const activeActor = String(actorCfg?.activeActor ?? actorCfg ?? 'exterior');
    const sysContext =
      [
        `You are the interior assistant of Overlay Companion MCP.`,
        `Effective model this turn: ${opts.providerModel}.`,
        `If the user asks for any overlay/drawing and either the owner below is not 'interior' or a tool errors mentioning Passive mode, do this first in order: set_mode {mode:"assist"}, set_display_actor {actor:"interior"}, then the draw call. Current display owner: ${activeActor}; you may switch ownership yourself via set_display_actor. Only retry an overlay once after fixing mode/ownership.`,
        `see_screen shows REAL current pixels; when available, treat its image and reported resolution as the source of truth, overriding get_display_info (which may reflect stale/default host monitors). ` + `If take_screenshot errors, do NOT ask the user for coordinates: use get_display_info plus sensible context estimates instead. ` + `Tools you call DO run for real: draw_overlay/template_overlay place actual overlays; take_screenshot captures the display; switch_ai_model changes your own AI model for the next message and supports OpenRouter variant slugs like ':nitro'.`,
        `If a tool errors, read its error detail; do NOT tell the user a capability is missing unless it appears absent from your tool list.`,
        role === 'admin'
          ? `You are an admin: set_config lets you change app settings via chat.`
          : `Config changes are admin-only; direct the user to Settings instead of attempting them.`,
      ].join(' ');
    // Injection happens when the conversation carries no system role of its
    // own (the web panel never sends one). Callers that DO manage system
    // prompts opted out of this snapshot by design.
    const hasSystem = messages.some((m) => m.role === 'system');
    let currentMessages: Array<Record<string, unknown>> = hasSystem ? messages : [{ role: 'system', content: sysContext }, ...messages];
    const MAX_TOOL_TURNS = 8;
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
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
        } else if (chunk.startsWith('{') && chunk.includes('__thinking')) {
          try {
            const thinking = JSON.parse(chunk).__thinking as string;
            if (thinking) res.write(`data: ${JSON.stringify({ thinking })}\n\n`);
          } catch { /* ignore malformed thinking marker */ }
        } else {
          collected.push(chunk);
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
      }

      if (toolCalls.length === 0) break;

      if (turn === MAX_TOOL_TURNS - 1) {
        res.write(`data: ${JSON.stringify({ error: 'Reached the per-message tool round limit before finishing the task.' })}\n\n`);
        break;
      }
      // Execute each tool, append the tool results as assistant + tool messages.
      const toolResults: Array<Record<string, unknown>> = [];
      for (const tc of toolCalls) {
        let result: string;
        try {
          result = await chat.runTool(opts, tc);
        } catch (err) {
          // A failed tool must reach the model as structured feedback so it can
          // self-correct, never as a dropped connection.
          result = JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
            isError: true,
            hint: 'Treat this error as real feedback: follow any instructions inside it (e.g. call set_mode first), fix arguments, then retry once.',
          });
        }
        toolResults.push({ role: 'tool', tool_call_id: tc.id, content: result });
        res.write(`data: ${JSON.stringify({ tool: tc.name, result })}\n\n`);
        // Vision passthrough (R13): see_screen / preview_overlay attach an
        // image the model must SEE; inject as a user-side multimodal part
        // right after the tool result so providers render it in context.
        const vision = chat.pendingVision;
        if (vision?.length) {
          for (const part of vision) {
            if (part.type !== 'image_url') continue;
            const meta = (part as { note?: string; previewSpec?: unknown }).note;
            toolResults.push({
              role: 'user',
              content: [
                part as unknown as Record<string, unknown>,
                {
                  type: 'text',
                  text:
                    (meta && !String(meta).startsWith('screen@')
                      ? `Ghost preview of candidate overlay at logical coords ${JSON.stringify((part as { previewSpec?: unknown }).previewSpec)} over this capture.`
                      : 'Screen capture referenced by the previous see_screen result.'),
                },
              ],
            });
          }
          chat.pendingVision = undefined;
        }
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
// R12: authoritative display geometry (proxied from the MCP server).
app.get('/api/display-state', requireBetterAuthSession, (async (_req: Request, res: Response) => {
  try {
    const upstream = await fetch(`${config.mcpServerUrl}/api/display-state`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!upstream.ok) { res.status(502).json({ error: 'upstream_display_state' }); return; }
    res.status(200).json(await upstream.json());
  } catch {
    res.status(502).json({ error: 'display_state_unavailable' });
  }
}) as RequestHandler);

// ---- Screen mirror (R13/R14) ---------------------------------------------

// The desktop page captures the KasmVNC framebuffer canvas (same-origin via
// the /vnc proxy) and uploads downscaled JPEG frames. The interior assistant
// reads them back through see_screen so it can see what the user sees — even
// in a headless deployment where native screenshot capture is impossible.

interface MirrorBody {
  dataUrl?: string;
  width?: number;
  height?: number;
  displayWidth?: number;
  displayHeight?: number;
  trigger?: 'interval' | 'input' | 'manual' | 'preview' | 'connect';
  cadenceMs?: number;
}

function storeMirror(body: MirrorBody, kind: 'preview' | 'frame'): void {
  const f: import('./screen-mirror.js').MirrorFrame = {
    dataUrl: String(body.dataUrl ?? '').slice(0, 900_000),
    width: Number(body.width ?? 640),
    height: Number(body.height ?? 360),
    displayWidth: Number(body.displayWidth ?? 1920),
    displayHeight: Number(body.displayHeight ?? 1080),
    trigger: body.trigger ?? 'manual',
    cadenceMs: body.cadenceMs,
    capturedAt: Date.now(),
  };
  if (kind === 'preview') pushPreview(f); else pushFrame(f);
}

app.post('/api/screen-mirror/frame', makeLimitGuard('connections'), requireBetterAuthSession, ((req: Request, res: Response) => {
  const body = req.body as MirrorBody;
  if (!body?.dataUrl?.startsWith('data:image/')) {
    res.status(400).json({ error: { code: 'invalid_request', message: 'dataUrl must be an image data URL.' } });
    return;
  }
  storeMirror(body, 'frame');
  res.json({ ok: true });
}) as RequestHandler);

app.post('/api/screen-mirror/preview', makeLimitGuard('connections'), requireBetterAuthSession, ((req: Request, res: Response) => {
  const body = req.body as MirrorBody;
  if (!body?.dataUrl?.startsWith('data:image/')) {
    res.status(400).json({ error: { code: 'invalid_request', message: 'dataUrl must be an image data URL.' } });
    return;
  }
  storeMirror({ ...body, trigger: 'preview' }, 'preview');
  res.json({ ok: true });
}) as RequestHandler);

app.get('/api/chat/tools', makeLimitGuard('connections'), requireBetterAuthSession, (async (_req: Request, res: Response) => {
  const actorRaw = await libSqlStore.getConfig('general.activeActor');
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
  await libSqlStore.appendAudit({
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
  await libSqlStore.appendAudit({
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
// CRUD over the libSQL `connection` table, scoped to the authenticated
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

// GET /api/connections — the connections the current user may view. When
// OpenFGA is enabled (D-017) the authorization decision comes from OpenFGA
// listObjects(viewer); otherwise the owner-scoped store query is used.
app.get('/api/connections', makeLimitGuard('connections'), requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const viewable = await openfgaStore.listViewableConnectionIds(state.user.id);
  const rows = viewable !== null
    ? await libSqlStore.getConnectionsByIds(viewable)
    : await libSqlStore.listConnections(state.user.id);
  res.json({ connections: rows.map(toConnectionDto) });
}) as RequestHandler);

// POST /api/connections — create a new saved connection.
app.post('/api/connections', makeLimitGuard('connections'), requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  const input = parseConnectionBody(req.body);
  if ('error' in input) {
    res.status(400).json({ error: { code: 'invalid_request', message: input.error } });
    return;
  }
  const { password, ...clean } = input;
  const passwordHash = password ? await hashPassword(password) : undefined;
  const saved = await libSqlStore.upsertConnection(state.user.id, clean, passwordHash);
  // OpenFGA (D-017): the creator becomes the owner of the new connection.
  await openfgaStore.writeOwner(state.user.id, saved.id);
  await libSqlStore.appendAudit({
    action: 'connection.created',
    userId: state.user.id,
    actor: 'user',
    ipAddress: clientIp(req),
    detail: { id: saved.id, name: saved.name },
  });
  res.status(201).json({ connection: toConnectionDto(saved) });
}) as RequestHandler);

// GET /api/connections/:id — one saved connection (viewer relation).
app.get('/api/connections/:id', makeLimitGuard('connections'), requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  if (!(await requireConnectionRelation(req, res, 'viewer', req.params.id))) return;
  const row = await libSqlStore.getConnection(state.user.id, req.params.id);
  if (!row) {
    res.status(404).json({ error: { code: 'not_found', message: 'Connection not found.' } });
    return;
  }
  res.json({ connection: toConnectionDto(row) });
}) as RequestHandler);

// PUT /api/connections/:id — update an existing saved connection (operator).
app.put('/api/connections/:id', makeLimitGuard('connections'), requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  if (!(await requireConnectionRelation(req, res, 'operator', req.params.id))) return;
  const existing = await libSqlStore.getConnection(state.user.id, req.params.id);
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
  const saved = await libSqlStore.upsertConnection(state.user.id, { ...clean, id: req.params.id }, passwordHash);
  await libSqlStore.appendAudit({
    action: 'connection.updated',
    userId: state.user.id,
    actor: 'user',
    ipAddress: clientIp(req),
    detail: { id: saved.id, name: saved.name },
  });
  res.json({ connection: toConnectionDto(saved) });
}) as RequestHandler);

// DELETE /api/connections/:id — remove a saved connection (owner only).
app.delete('/api/connections/:id', makeLimitGuard('connections'), requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  if (!(await requireConnectionRelation(req, res, 'owner', req.params.id))) return;
  const deleted = await libSqlStore.deleteConnection(state.user.id, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: { code: 'not_found', message: 'Connection not found.' } });
    return;
  }
  // OpenFGA (D-017): drop the connection's tuples so deleted objects can't be
  // re-checked against stale grants.
  await openfgaStore.deleteTuplesForConnection(req.params.id);
  await libSqlStore.appendAudit({
    action: 'connection.deleted',
    userId: state.user.id,
    actor: 'user',
    ipAddress: clientIp(req),
    detail: { id: req.params.id },
  });
  res.json({ ok: true });
}) as RequestHandler);

// POST /api/connections/:id/touch — record a successful connect (server-authoritative
// timestamp; clients cannot forge last_connected). Operator relation (D-017).
app.post('/api/connections/:id/touch', makeLimitGuard('connections'), requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  if (!(await requireConnectionRelation(req, res, 'operator', req.params.id))) return;
  const row = await libSqlStore.getConnection(state.user.id, req.params.id);
  if (!row) {
    res.status(404).json({ error: { code: 'not_found', message: 'Connection not found.' } });
    return;
  }
  await libSqlStore.touchLastConnected(state.user.id, req.params.id);
  res.json({ ok: true });
}) as RequestHandler);

// POST /api/connections/:id/test — test a saved connection against its target.
// Operator relation (D-017).
app.post('/api/connections/:id/test', makeLimitGuard('connections'), requireBetterAuthSession, (async (req: Request, res: Response) => {
  const state = (req as Request & { authState?: AuthState }).authState!;
  if (!(await requireConnectionRelation(req, res, 'operator', req.params.id))) return;
  const row = await libSqlStore.getConnection(state.user.id, req.params.id);
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
    await libSqlStore.appendAudit({
      action: 'connection.tested',
      userId: state.user.id,
      actor: 'user',
      ipAddress: clientIp(req),
      detail: { id: row.id, ok: result.success ?? false },
    });
    res.json({ success: result.success ?? false, message: result.message });
  } catch (err) {
    await libSqlStore.appendAudit({
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
  // Scalars that are themselves a secret-named value are redacted outright;
  // a non-secret scalar passes through unchanged.
  if (typeof value !== 'object' || value === null) {
    return SECRET_KEY_FRAGMENTS.some((f) => key.toLowerCase().includes(f)) && typeof value === 'string' && value.length > 0
      ? '<redacted>'
      : value;
  }
  // Redact any *nested* field whose name is secret-like, regardless of the
  // enclosing key. The caller passes the config name (e.g. 'provider.chat'),
  // which never contains a secret fragment, so gating on `key` (as the old
  // code did) meant secret fields were never redacted and leaked to the UI.
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const kl = k.toLowerCase();
    redacted[k] = SECRET_KEY_FRAGMENTS.some((f) => kl.includes(f)) && typeof v === 'string' && v.length > 0
      ? '<redacted>'
      : v;
  }
  return redacted;
}

// When a config object is PUT back from the Settings UI, secret fields arrive
// as the '<redacted>' placeholder the GET returned. Preserve the stored secret
// in that case instead of overwriting it with the placeholder string.
function mergePreservingSecrets(existing: unknown, incoming: Record<string, unknown>): Record<string, unknown> {
  const prev = (existing && typeof existing === 'object' && !Array.isArray(existing))
    ? (existing as Record<string, unknown>)
    : {};
  const out: Record<string, unknown> = { ...incoming };
  for (const [k, v] of Object.entries(out)) {
    if (v === '<redacted>' && SECRET_KEY_FRAGMENTS.some((f) => k.toLowerCase().includes(f))) {
      out[k] = typeof prev[k] === 'string' && (prev[k] as string).length > 0 ? prev[k] : '';
    }
  }
  return out;
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
// stored via libSQL app_config (redacted) and is never returned to the UI.
function bootstrapProviderSettings(): Record<string, unknown> {
  return {
    'provider.chat': {
      baseUrl: process.env.PROVIDER_BASE_URL ?? DEFAULT_PROVIDER_BASE_URL,
      model: process.env.PROVIDER_MODEL ?? DEFAULT_PROVIDER_MODEL,
      apiKey: process.env.PROVIDER_API_KEY ? '<redacted>' : '',
      enabled: process.env.PROVIDER_CHAT_ENABLED === 'true',
    },
    // Delegated model choice (§ model switching): admins curate a registry of
    // provider/model/endpoint combinations; regular users may ONLY pick among
    // these. baseUrl/model are never accepted from user bodies for direct use,
    // which prevents pointing the shared API key at arbitrary endpoints (SSRF /
    // key-exfiltration). Seed from env or with one sensible OpenRouter default.
    'provider.approved': {
      models: parseApprovedModelsEnv() ?? DEFAULT_APPROVED_MODELS,
    },
  };
}

function parseApprovedModelsEnv(): Array<Record<string, unknown>> | null {
  const raw = process.env.PROVIDER_APPROVED_MODELS_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall back to default list */ }
  return null;
}


// OpenFGA bootstrap defaults (D-017). OpenFGA is a separate service; the app
// only talks to it over HTTP. Disabled by default (owner-scoped behavior);
// enable in Settings when a fine-grained authorization service is deployed.
function bootstrapOpenFgaSettings(): Record<string, unknown> {
  return {
    'openfga.settings': {
      enabled: process.env.OPENFGA_ENABLED === 'true',
      endpoint: process.env.OPENFGA_URL ?? 'http://openfga:8080',
      storeId: process.env.OPENFGA_STORE_ID ?? '',
      modelId: process.env.OPENFGA_MODEL_ID ?? '',
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

// ---- KasmVNC proxy (allowlisted noVNC web UI + VNC WebSocket) ----
// SECURITY: target resolved ONLY from the operator allowlist (never raw host).
// `secure: false` tolerates KasmVNC's self-signed cert.
function vncTargetIdFromUrl(rawUrl: string): string {
  const u = (rawUrl || '').replace(/^\/vnc/, '');
  const m = /^\/([^/?#]+)/.exec(u);
  return m ? m[1] : '';
}

// KasmVNC's noVNC builds its WebSocket URL from window.location.host + port +
// '/websockify', so the upgrade never carries the /vnc/<id> prefix. We stamp the
// active target id into a cookie while proxying the web UI and read it back here
// to route /websockify to the right allowlisted target.
const KASMVNC_TARGET_COOKIE = 'oc-vnc-target';

function kasmvncTargetIdFromCookie(headers?: { cookie?: string }): string {
  const cookie = headers?.cookie ?? '';
  const m = /(?:^|;\s*)oc-vnc-target=([^;]+)/.exec(cookie);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

type KasmVncResolvedTarget = ReturnType<ConnectionManager['getKasmVncTarget']>;

// Resolve the allowlisted target from the ORIGINAL url and stash it on the
// request. http-proxy-middleware runs `pathRewrite` before its `router`, so the
// `router` sees a stripped url (e.g. `/websockify`) where the `/vnc/<id>`
// prefix is gone; reading the stash (or the pre-rewrite url) keeps the target id
// intact for both the HTTP and the WebSocket-upgrade paths.
function resolveKasmVncTarget(req: { url?: string; originalUrl?: string }): KasmVncResolvedTarget {
  const raw = req.originalUrl || req.url || '';
  const target = connectionManager.getKasmVncTarget(vncTargetIdFromUrl(raw));
  (req as unknown as { __kasmvncTarget?: KasmVncResolvedTarget }).__kasmvncTarget = target;
  return target;
}

// Basic-auth header for a target that carries KasmVNC credentials, so the
// proxied web UI + WebSocket reach the desktop without a browser auth prompt.
function kasmvncBasicAuth(target: KasmVncResolvedTarget | undefined): string | undefined {
  if (!target) return undefined;
  if (!target.username && !target.password) return undefined;
  const user = target.username ?? '';
  const pass = target.password ?? '';
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

const kasmVncProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:1',
  router: (req) => {
    const target = (req as unknown as { __kasmvncTarget?: KasmVncResolvedTarget }).__kasmvncTarget;
    return target ? `${target.ssl ? 'https' : 'http'}://${target.host}:${target.port}` : 'http://127.0.0.1:1';
  },
  pathRewrite: (path) => {
    // The root-level websockify path (noVNC's host+port+path) is already the
    // upstream path; leave it intact. For /vnc/<id>/... strip the prefix.
    if (path.startsWith('/websockify')) return path;
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded path prefix, no user-controlled backtracking risk
    const m = /^(\/vnc)?\/[^/]+(\/.*)?$/.exec(path);
    return m && m[2] ? m[2] : '/';
  },
  changeOrigin: true,
  secure: false,
  // ws is intentionally false: WebSocket upgrades are handled via raw TLS
  // forwarding in the server.on('upgrade') handler below. http-proxy's ws mode
  // lowercases all header names via Node's setHeader(), but KasmVNC's websockify
  // requires uppercase `Host` — so we build the upstream request manually.
  xfwd: true,
  onProxyReq: (proxyReq, req) => {
    const target = (req as unknown as { __kasmvncTarget?: KasmVncResolvedTarget }).__kasmvncTarget;
    const auth = kasmvncBasicAuth(target);
    if (auth) proxyReq.setHeader('Authorization', auth);
  },
  onProxyReqWs: (proxyReq, req) => {
    const target = (req as unknown as { __kasmvncTarget?: KasmVncResolvedTarget }).__kasmvncTarget;
    const auth = kasmvncBasicAuth(target);
    if (auth) proxyReq.setHeader('Authorization', auth);
    if (target) {
      proxyReq.setHeader('Host', `${target.host}:${target.port}`);
      proxyReq.setHeader('Upgrade', 'websocket');
      proxyReq.setHeader('Connection', 'Upgrade');
      const subproto = (req.headers ? req.headers['sec-websocket-protocol'] : undefined) ?? 'binary';
      proxyReq.setHeader('Sec-WebSocket-Protocol', subproto);
      const origin = req.headers ? req.headers['origin'] : undefined;
      if (origin) proxyReq.setHeader('Origin', origin);
      if (!proxyReq.getHeader('sec-websocket-version')) proxyReq.setHeader('Sec-WebSocket-Version', '13');
    }
  },
  onProxyRes: (proxyRes, req) => {
    // Stamp the active target id so the later /websockify upgrade can be routed
    // back to the same allowlisted target.
    const id = vncTargetIdFromUrl((req as { originalUrl?: string }).originalUrl || req.url || '');
    if (!id) return;
    const cookie = `${KASMVNC_TARGET_COOKIE}=${encodeURIComponent(id)}; Path=/; SameSite=Lax; Max-Age=300`;
    const existing = proxyRes.headers['set-cookie'];
    proxyRes.headers['set-cookie'] = existing ? (Array.isArray(existing) ? existing : [existing]).concat(cookie) : [cookie];
  },
  onError: (err, _req, res) => {
    log.error('KasmVNC proxy error:', (err as Error).message);
    // For HTTP errors `res` is an Express Response; for WebSocket-upgrade
    // errors it is the raw socket. Only an Express Response has `.status`.
    const r = res as unknown as Response & { destroy?: () => void };
    if (r && typeof (r as Response).status === 'function') {
      if (!(r as Response).headersSent) {
        (r as Response).status(502).json({ error: 'kasmvnc_unavailable', message: 'KasmVNC target is not reachable.' });
      }
    } else if (r && typeof r.destroy === 'function') {
      r.destroy();
    }
  },
});

app.use('/vnc', authMiddleware, (req, res, next) => {
  // Canonical trailing slash: KasmVNC's index.html references everything
  // relatively (dist/*.js, vendor/*.js, style.bundle.css, app/images/...), so
  // the iframe document URL must end with a slash or the browser resolves those
  // URLs one directory up and they 404. Redirect the bare `/vnc/<id>` form.
  const raw = (req.originalUrl || req.url || '').split('?')[0];
  const noSlashMatch = /^\/vnc\/[^/]+$/.exec(raw);
  if (noSlashMatch) {
    return res.redirect(301, `${raw}/`);
  }
  if (!resolveKasmVncTarget(req)) {
    return res.status(404).json({ error: { code: 'kasmvnc_target_not_allowed', message: 'KasmVNC target is not in the allowlist.' } });
  }
  next();
}, kasmVncProxy);

// WebSocket upgrade bypasses Express middleware; gate by allowlist only
// (KasmVNC itself still enforces its own password). noVNC targets either
// `/vnc/<id>...` (prefix present) or the root-level `/websockify` (target id
// from the cookie we stamp during the web-UI load).
//
// NOTE: this is the single upgrade router for the whole server. Two rules:
// 1. The overlay WSS runs in noServer mode and is routed here via
//    `handleUpgrade` — otherwise ws aborts non-matching upgrades with
//    `400 Bad Request` and kills `/websockify` connections.
// 2. KasmVNC upgrades are forwarded with a hand-built upstream request:
//    http-proxy's ws mode lowercases header names (Node's setHeader), but
//    KasmVNC's websockify requires uppercase `Host`, and its 101
//    response-handling can be swallowed — the manual forward avoids both.
server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  // The overlay broadcast socket (ws, noServer mode) — hand it to the WSS.
  if (url === '/ws' || url === '/ws/' || url.startsWith('/ws?')) {
    if (!wss) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    return;
  }
  let target: KasmVncResolvedTarget | undefined;
  if (url.startsWith('/vnc/')) {
    target = resolveKasmVncTarget(req as unknown as { url?: string });
  } else if (url.startsWith('/websockify')) {
    const id = kasmvncTargetIdFromCookie(req.headers as { cookie?: string });
    target = id ? connectionManager.getKasmVncTarget(id) : null;
    (req as unknown as { __kasmvncTarget?: KasmVncResolvedTarget }).__kasmvncTarget = target;
  } else {
    log.debug(`Ignoring non-KasmVNC WS upgrade: ${url}`);
    socket.destroy();
    return;
  }
  if (!target) {
    log.warn(`KasmVNC WS upgrade rejected (no allowed target) for: ${url}`);
    socket.destroy();
    return;
  }
  log.info(`KasmVNC WS upgrade routed: ${url} -> ${target.host}:${target.port}`);

  // Forward the WebSocket upgrade via raw TLS to the upstream KasmVNC target.
  // We build the request manually because http-proxy's ws mode lowercases all
  // header names (Node's setHeader), but KasmVNC's websockify requires uppercase
  // `Host`. The raw TLS path also avoids the response-handling race in
  // http-proxy's ws-incoming.js that can swallow 101 responses.
  // Mirror the HTTP proxy's pathRewrite: root-level /websockify passes
  // through; /vnc/<id>/... loses its prefix so KasmVNC sees /websockify etc.
  const upstreamPath = url.startsWith('/websockify')
    ? url
    : ((/^(\/vnc)?\/[^/]+(\/.*)?$/.exec(url)?.[2]) || '/');

  const auth = kasmvncBasicAuth(target);
  const wsKey = (req.headers['sec-websocket-key'] as string) || crypto.randomBytes(16).toString('base64');
  const wsExt = req.headers['sec-websocket-extensions'] as string | undefined;
  // Forward client headers verbatim; fall back only where the upstream
  // genuinely requires a value (KasmVNC's websockify rejects requests without
  // Sec-WebSocket-Origin), deriving it from the caller's Host rather than a
  // fabricated constant.
  const wsOrigin = (req.headers['origin'] as string) || `https://${req.headers.host || 'localhost'}`;
  const upstreamReqHeaders: Record<string, string> = {
    'Host': `${target.host}:${target.port}`,
    'Upgrade': 'websocket',
    'Connection': 'Upgrade',
    'Sec-WebSocket-Key': wsKey,
    'Sec-WebSocket-Version': '13',
    'Origin': wsOrigin,
  };
  const wsProtocol = req.headers['sec-websocket-protocol'] as string | undefined;
  if (wsProtocol) upstreamReqHeaders['Sec-WebSocket-Protocol'] = wsProtocol;
  if (auth) upstreamReqHeaders['Authorization'] = auth;
  if (wsExt) upstreamReqHeaders['Sec-WebSocket-Extensions'] = wsExt;
  // Respect the target's scheme — plain-HTTP KasmVNC deployments must not get
  // a TLS handshake. (TLS verification matches the HTTP proxy's secure:false.)
  const upstream = (target.ssl ? https : http).request({
    hostname: target.host,
    port: target.port,
    path: upstreamPath,
    method: 'GET',
    rejectUnauthorized: false,
    headers: upstreamReqHeaders,
  });
  upstream.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    // Write 101 response to client
    const respHeaders = Object.entries(proxyRes.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\r\n');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${respHeaders}\r\n\r\n`);
    // Pipe data bidirectionally; forward any early-data buffers from BOTH
    // sides so pipelined first frames aren't dropped mid-handshake.
    if (proxyHead && proxyHead.length) proxySocket.write(proxyHead);
    if (head && head.length) proxySocket.write(head);
    proxySocket.pipe(socket).pipe(proxySocket);
    proxySocket.on('error', () => socket.destroy());
    socket.on('error', () => proxySocket.destroy());
    proxySocket.on('close', () => socket.destroy());
    socket.on('close', () => proxySocket.destroy());
  });
  upstream.on('response', (res) => {
    // Non-101 response: forward to client and close the raw socket once done.
    const respHeaders = Object.entries(res.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\r\n');
    socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n${respHeaders}\r\n\r\n`);
    res.pipe(socket);
    res.on('end', () => socket.end());
  });
  upstream.on('error', (err) => {
    socket.destroy();
  });
  upstream.end();
});

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

  // Check KasmVNC health.
  //
  // The KasmVNC target is a plain KasmVNC desktop (web UI on the kasmvncUrl
  // port, typically TLS self-signed). There is no separate "/api/health"
  // endpoint on the target, so a reachability probe of the web UI is the
  // health signal: any HTTP response (including a 401 auth challenge) means
  // the desktop is up; only a connect/read failure means it is down.
  let kasmvncStatus = 'unknown';
  try {
    kasmvncStatus = await new Promise<string>((resolve) => {
      const url = new URL(config.kasmvncUrl);
      const mod = url.protocol === 'https:' ? https : http;
      // Authenticate when the target carries credentials so the probe gets a
      // 200 instead of a repeat 401 — KasmVNC blacklists repeat failed-auth IPs,
      // which would otherwise break real connections from this server.
      const allowTarget = Object.values(connectionManager.getKasmVncAllowlist()).find(
        (t) => t.host === url.hostname,
      );
      const auth = kasmvncBasicAuth(allowTarget);
      const headers: Record<string, string> = {};
      if (auth) headers.Authorization = auth;
      const req = mod.get(
        url,
        { rejectUnauthorized: false, timeout: 5000, headers },
        (res) => {
          res.resume();
          resolve('healthy');
        },
      );
      req.on('error', () => resolve('unavailable'));
      req.on('timeout', () => {
        req.destroy();
        resolve('unavailable');
      });
    });
  } catch {
    kasmvncStatus = 'unavailable';
  }

  // Check libSQL reachability (the only database; §9).
  const databaseStatus = (await libSqlStore.ping()) ? 'healthy' : 'unavailable';

  // Check OpenFGA reachability (fine-grained authorization, D-017). Disabled
  // when OpenFGA is not enabled; otherwise healthy/unavailable.
  let openfgaStatus = 'disabled';
  if (openfgaStore.getOptions().enabled) {
    openfgaStatus = (await openfgaStore.ping()) ? 'healthy' : 'unavailable';
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
      database: databaseStatus,
      openfga: openfgaStatus,
      auth: 'enabled',
      connectedClients: overlayClients.size,
    },
  };

  // Surface the sampled service statuses in OpenTelemetry so a degraded
  // dependency (MCP server unreachable, WebSocket disabled, DB down, …) becomes
  // queryable/alertable in the trace backend rather than only in this JSON.
  recordHealthCheck(health.services);

  res.json(health);
}) as RequestHandler);

// MCP configuration endpoint for any MCP-capable AI client
app.get('/mcp-config', requireBetterAuthSession, (req: Request, res: Response) => {
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
    notes: 'Single-user dev package. Copy this JSON into your MCP client.',
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
  startMcpOverlayBridge(config.mcpServerUrl);
  log.info(`📊 Health check: http://${config.bindAddress}:${config.httpPort}/health`);
});
