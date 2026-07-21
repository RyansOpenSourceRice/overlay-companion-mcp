/**
 * Authentication module for the Overlay Companion MCP management server.
 *
 * Implements (per Ryan's preferences §7):
 * - OAuth/OIDC via Keycloak (auth code + PKCE). Outsourced identity; RBAC.
 * - Local auth fallback (hashed + salted passwords; never roll our own crypto —
 *   Node's crypto.scrypt is the established primitive).
 * - Passkeys / TOTP / backup codes: provided by Keycloak when configured; the
 *   admin enables them in the Keycloak realm. The login UI links to the IdP.
 * - Sign-ups locked by default (admin opt-in).
 * - Rate limiting on auth endpoints (§7).
 * - Delete-account is a feature (§7 Privacy).
 * - Sessions backed by SurrealDB (signed cookies; token hashes only).
 *
 * GUI-first config (§9): auth/provider/connection settings live in SurrealDB
 * app_config and are editable in the Settings UI. Env vars are bootstrap
 * defaults only.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';
import { SurrealDbStore, DbUser, AuditEvent } from './surreal-store.js';

// ---- Types --------------------------------------------------------------

export interface AuthConfig {
  enabled: boolean;
  // OIDC
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcAudience?: string;
  oidcRequiredRole: string;
  oidcScopes: string[];
  // Local auth fallback
  localAuthEnabled: boolean;
  // Sign-up policy
  signUpAllowed: boolean;
  // Session
  sessionTtlMinutes: number;
  sessionSecret: string;
  // Public base URL the browser sees (for callback URLs)
  publicBaseUrl?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  roles: string[];
  provider: string;
}

export interface AuthState {
  user: AuthUser;
  sessionId: string;
  csrfToken: string;
}

// ---- Config loading (env = bootstrap defaults; GUI overrides at runtime) -

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];

export function loadAuthConfig(store: SurrealDbStore): AuthConfig {
  // Bootstrap defaults from env. The Settings GUI can override these via
  // app_config; this keeps the app runnable before any GUI config exists.
  const secret = process.env.SESSION_SECRET || 'dev-only-change-me';
  return {
    enabled: process.env.OIDC_ENABLED === 'true' || process.env.LOCAL_AUTH_ENABLED === 'true',
    oidcIssuer: process.env.OIDC_ISSUER || undefined,
    oidcClientId: process.env.OIDC_CLIENT_ID || undefined,
    oidcClientSecret: process.env.OIDC_CLIENT_SECRET || undefined,
    oidcAudience: process.env.OIDC_AUDIENCE || undefined,
    oidcRequiredRole: process.env.OIDC_REQUIRED_ROLE || 'overlay:user',
    oidcScopes: DEFAULT_SCOPES,
    localAuthEnabled: process.env.LOCAL_AUTH_ENABLED === 'true',
    signUpAllowed: process.env.SIGNUP_ALLOWED === 'true',
    sessionTtlMinutes: parseInt(process.env.SESSION_TTL_MINUTES || '480', 10) || 480,
    sessionSecret: secret,
    publicBaseUrl: process.env.PUBLIC_BASE_URL || undefined,
  };
}

// ---- Password hashing (local auth) --------------------------------------

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALTLEN = 16;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SCRYPT_SALTLEN);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'base64');
    const expected = Buffer.from(parts[2], 'base64');
    const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    return crypto.timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}

// ---- Session cookie helpers --------------------------------------------

const COOKIE_NAME = 'oc_session';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days; the DB row's expires_at is the real gate
};

function signToken(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return payload + '.' + hmac.digest('base64url');
}

function verifySignedToken(token: string, secret: string): string | null {
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = signToken(payload, secret).slice(payload.length + 1);
  try {
    if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return payload;
    }
  } catch {
    // length mismatch; fall through
  }
  return null;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCsrfToken(): string {
  return crypto.randomBytes(16).toString('base64url');
}

// ---- OIDC PKCE helpers --------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

function codeChallengeFromVerifier(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

// ---- Auth service -------------------------------------------------------

export class AuthService {
  private readonly store: SurrealDbStore;
  private config: AuthConfig;
  // In-memory PKCE/state map keyed by random state. Short-lived.
  private readonly pkceMap = new Map<string, { verifier: string; redirectTarget: string; createdAt: number }>();
  private readonly PKCE_TTL_MS = 10 * 60 * 1000;

  constructor(store: SurrealDbStore, config: AuthConfig) {
    this.store = store;
    this.config = config;
    // Periodically prune expired PKCE states.
    setInterval(() => this.prunePkce(), 5 * 60 * 1000).unref();
  }

  getConfig(): AuthConfig {
    return this.config;
  }

  updateConfig(patch: Partial<AuthConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  // ---- Local auth -------------------------------------------------------

  async localLogin(username: string, password: string, ip?: string): Promise<AuthState> {
    const user = await this.store.findUserByUsername(username);
    if (!user || user.provider !== 'local' || !user.password_hash || !user.active) {
      await this.audit('auth.login.failed', undefined, ip, { reason: 'no_user', username });
      throw new AuthError('invalid_credentials', 'Invalid username or password', 401);
    }
    if (!verifyPassword(password, user.password_hash)) {
      await this.audit('auth.login.failed', user.id, ip, { reason: 'bad_password' });
      throw new AuthError('invalid_credentials', 'Invalid username or password', 401);
    }
    return this.issueSession(user, ip);
  }

  async localRegister(username: string, password: string, email?: string, ip?: string): Promise<AuthState> {
    if (!this.config.signUpAllowed) {
      throw new AuthError('signups_locked', 'Sign-ups are locked by default. An admin must enable them.', 403);
    }
    const existing = await this.store.findUserByUsername(username);
    if (existing) {
      throw new AuthError('username_taken', 'That username is already in use', 409);
    }
    // First user becomes admin (bootstrap). Subsequent users are regular.
    const userCount = await this.store.countUsers();
    const roles = userCount === 0 ? ['admin', 'overlay:user'] : ['overlay:user'];
    const { id } = await this.store.upsertUser({
      provider: 'local',
      username,
      email,
      roles,
      passwordHash: hashPassword(password),
      displayName: username,
    });
    const user = await this.store.getUser(id);
    if (!user) throw new AuthError('internal', 'Registration failed', 500);
    await this.audit('auth.register.success', id, ip, { username });
    return this.issueSession(user, ip);
  }

  // ---- OIDC -------------------------------------------------------------

  beginOidcLogin(redirectTarget: string, publicHost: string): { authorizeUrl: string; state: string } {
    if (!this.config.oidcIssuer || !this.config.oidcClientId) {
      throw new AuthError('oidc_not_configured', 'OIDC is not configured. Set it in Settings.', 400);
    }
    const verifier = generateCodeVerifier();
    const state = base64url(crypto.randomBytes(24));
    this.pkceMap.set(state, { verifier, redirectTarget, createdAt: Date.now() });

    const challenge = codeChallengeFromVerifier(verifier);
    const redirectUri = this.callbackUrl(publicHost);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.oidcClientId,
      redirect_uri: redirectUri,
      scope: this.config.oidcScopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const authorizeUrl = `${this.config.oidcIssuer}/protocol/openid-connect/auth?${params.toString()}`;
    return { authorizeUrl, state };
  }

  async completeOidcLogin(code: string, state: string, publicHost: string, ip?: string): Promise<{ session: AuthState; redirectTarget: string }> {
    const entry = this.pkceMap.get(state);
    if (!entry) {
      throw new AuthError('invalid_state', 'Login state not found or expired', 400);
    }
    this.pkceMap.delete(state);
    if (Date.now() - entry.createdAt > this.PKCE_TTL_MS) {
      throw new AuthError('state_expired', 'Login state expired', 400);
    }

    const tokenSet = await this.exchangeOidcCode(code, entry.verifier, publicHost);
    const claims = this.decodeIdToken(tokenSet.id_token);
    if (!claims.sub) {
      throw new AuthError('invalid_id_token', 'IdP returned no subject', 400);
    }

    const roles = this.extractRoles(claims);
    if (this.config.oidcRequiredRole && !roles.includes(this.config.oidcRequiredRole)) {
      await this.audit('auth.login.failed', undefined, ip, { reason: 'missing_role', sub: claims.sub });
      throw new AuthError('forbidden', 'Required role missing', 403);
    }

    let user = await this.store.findUserBySubject('oidc', claims.sub);
    if (!user) {
      const { id } = await this.store.upsertUser({
        provider: 'oidc',
        subject: claims.sub,
        username: claims.preferred_username ?? claims.email ?? claims.sub,
        email: claims.email,
        displayName: claims.name,
        roles,
      });
      user = await this.store.getUser(id);
      if (!user) throw new AuthError('internal', 'User creation failed', 500);
    } else {
      // Refresh roles/display on each login.
      await this.store.upsertUser({
        id: user.id,
        provider: 'oidc',
        subject: claims.sub,
        username: claims.preferred_username ?? claims.email ?? claims.sub,
        email: claims.email,
        displayName: claims.name,
        roles,
      });
      user = await this.store.getUser(user.id);
      if (!user) throw new AuthError('internal', 'User refresh failed', 500);
    }

    const session = await this.issueSession(user, ip);
    await this.audit('auth.login.success', user.id, ip, { provider: 'oidc' });
    return { session, redirectTarget: entry.redirectTarget || '/' };
  }

  private async exchangeOidcCode(code: string, verifier: string, publicHost: string): Promise<{ access_token: string; id_token: string; refresh_token?: string }> {
    if (!this.config.oidcIssuer || !this.config.oidcClientId) {
      throw new AuthError('oidc_not_configured', 'OIDC is not configured', 400);
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.callbackUrl(publicHost),
      client_id: this.config.oidcClientId,
      code_verifier: verifier,
    });
    if (this.config.oidcClientSecret) {
      body.set('client_secret', this.config.oidcClientSecret);
    }
    const res = await fetch(`${this.config.oidcIssuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AuthError('token_exchange_failed', `IdP token exchange failed: ${res.status}`, 502);
    }
    return (await res.json()) as { access_token: string; id_token: string; refresh_token?: string };
  }

  private decodeIdToken(idToken: string): IdTokenClaims {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new AuthError('invalid_id_token', 'Malformed id_token', 400);
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8')) as IdTokenClaims;
    return payload;
  }

  private extractRoles(claims: IdTokenClaims): string[] {
    const realm = claims.realm_access?.roles ?? [];
    const groups = (claims.groups ?? []).map((g) => g.replace(/^\//, ''));
    return [...realm, ...groups].filter(Boolean);
  }

  private callbackUrl(publicHost: string): string {
    const base = this.config.publicBaseUrl ?? publicHost;
    return `${base}/auth/callback`;
  }

  // ---- Session management ----------------------------------------------

  private async issueSession(user: DbUser, ip?: string, userAgent?: string): Promise<AuthState> {
    const rawToken = generateSessionToken();
    const tokenHash = hashToken(rawToken);
    const csrfToken = generateCsrfToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMinutes * 60 * 1000);
    const sessionId = await this.store.createSession({
      userId: user.id,
      tokenHash,
      csrfToken,
      ipAddress: ip,
      userAgent,
      expiresAt,
    });
    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        roles: user.roles ?? [],
        provider: user.provider,
      },
      sessionId,
      csrfToken,
      token: rawToken, // attached for the route to set the cookie
    } as AuthState & { token: string };
  }

  async resolveSession(req: Request): Promise<AuthState | null> {
    const cookie = this.readCookie(req);
    if (!cookie) return null;
    const token = verifySignedToken(cookie, this.config.sessionSecret);
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = await this.store.findSessionByTokenHash(tokenHash);
    if (!session) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await this.store.revokeSession(session.id);
      return null;
    }
    const user = await this.store.getUser(session.user_id);
    if (!user || !user.active) return null;
    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        roles: user.roles ?? [],
        provider: user.provider,
      },
      sessionId: session.id,
      csrfToken: session.csrf_token ?? '',
    };
  }

  async logout(state: AuthState, ip?: string): Promise<void> {
    await this.store.revokeSession(state.sessionId);
    await this.audit('auth.logout', state.user.id, ip);
  }

  async deleteAccount(state: AuthState, ip?: string): Promise<void> {
    await this.store.revokeAllUserSessions(state.user.id);
    await this.store.deleteUser(state.user.id);
    await this.audit('account.deleted', state.user.id, ip, { username: state.user.username });
  }

  setSessionCookie(res: Response, state: AuthState & { token: string }): void {
    const signed = signToken(state.token, this.config.sessionSecret);
    res.cookie(COOKIE_NAME, signed, COOKIE_OPTIONS);
  }

  clearSessionCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
  }

  isCsrfValid(state: AuthState | null, req: Request): boolean {
    if (!state) return false;
    const header = req.get('x-csrf-token') ?? req.get('X-CSRF-Token');
    if (!header) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(state.csrfToken));
    } catch {
      return false;
    }
  }

  private readCookie(req: Request): string | undefined {
    return req.cookies?.[COOKIE_NAME];
  }

  private async audit(action: string, userId: string | undefined, ip: string | undefined, detail?: Record<string, unknown>): Promise<void> {
    const event: AuditEvent = {
      action,
      userId,
      actor: userId ? 'user' : 'system',
      ipAddress: ip,
      detail,
    };
    try {
      await this.store.appendAudit(event);
    } catch (err) {
      console.warn('[WARN] audit log write failed:', (err as Error).message);
    }
  }

  private prunePkce(): void {
    const now = Date.now();
    for (const [state, entry] of this.pkceMap.entries()) {
      if (now - entry.createdAt > this.PKCE_TTL_MS) {
        this.pkceMap.delete(state);
      }
    }
  }
}

// ---- IdP claims shape ---------------------------------------------------

interface IdTokenClaims {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  realm_access?: { roles?: string[] };
  groups?: string[];
}

// ---- Error type ---------------------------------------------------------

export class AuthError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

// ---- Express middleware: requireAuth (session-based) --------------------

export function requireSession(auth: AuthService): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const state = await auth.resolveSession(req);
      if (!state) {
        res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in required.' } });
        return;
      }
      req.user = state.user;
      (req as Request & { authState?: AuthState }).authState = state;
      next();
    } catch (err) {
      res.status(500).json({ error: { code: 'internal', message: 'Session resolution failed.' } });
    }
  };
}

/**
 * Middleware that allows either a valid session OR a Bearer token (the legacy
 * OIDC/JWT path). Used on MCP proxy routes so programmatic clients keep
 * working while the browser uses sessions.
 */
export function requireSessionOrBearer(auth: AuthService, verifyBearer: RequestHandler): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth2 = req.get('authorization');
    if (auth2 && auth2.startsWith('Bearer ')) {
      return verifyBearer(req, res, next);
    }
    return requireSession(auth)(req, res, next);
  };
}

// The cookie-parser and express-serve-static-core types already declare
// `req.cookies` and `req.user`; we extend Request with the auth-state handle
// used by downstream routes. Declared here to keep auth.ts self-contained.
declare module 'express-serve-static-core' {
  interface Request {
    authState?: AuthState;
  }
}
