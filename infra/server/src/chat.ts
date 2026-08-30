import type { LibSqlStore } from './libsql-store.js';
import { latestFrame, currentPreview, mirrorControl, overlayControl, waitForPreview, getBridgeOverlays, latestContentBounds } from './screen-mirror.js';
import { randomUUID } from 'node:crypto';

/**
 * In-app "interior" chat assistant (Phase B1).
 *
 * The chat panel is a SECOND client to the SAME MCP tools an external agent
 * uses. It streams an OpenRouter chat completion; when the model emits a
 * tool_call, this module executes it against the C# MCP server's Streamable
 * HTTP endpoint (`/mcp`) and feeds the result back for the next turn. The tool
 * allowlist is bounded (overlay, screenshot, display-actor, config) so the
 * interior assistant can never click/type on the VM — it is an annotation
 * layer, not an autopilot.
 */

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatSessionOptions {
  mcpServerUrl: string;
  providerBaseUrl: string;
  providerApiKey: string;
  providerModel: string;
  userRole: string;
  /** Authenticated user id; required for per-user model persistence. */
  userId?: string;
  /** Phase 3 gate: require a fresh matching preview before any marking. */
  enforcePreview?: boolean;
  /**
   * Phase 4 extensions: third-party MCP servers the admin registered. Their
   * tools are offered to the model as ext_<extid>_<tool> and routed to the
   * extension's own session — the core overlay allowlist stays untouched.
   */
  extensions?: ExtensionBinding[];
  /** Per-request gate state — request-scoped, never shared across users. */
  gate?: {
    pendingPreview?: {
      token: string;
      template: string;
      color: string;
      bounds: { x: number; y: number; width: number; height: number };
      createdAt: number;
    };
    awaitingCommitSig?: string;
    /** P0: set when the last draw was rescaled from phantom to true display space. */
    rescaled?: boolean;
    /** Phase 5 item 2: stepwise mode — auto-remove the previous step marking. */
    stepMode?: boolean;
    stepMarkingId?: string;
    /** Phase 6: category of the tracked step marking — the limit exemption
     *  must only free a slot the removal will actually free. */
    stepMarkingIsText?: boolean;
    vision?: Array<Record<string, unknown>>;
  };
  /** Phase 6: the last user message was a Go/approval — a fresh set_task_plan
   *  in this turn lands straight in act mode (the model must not re-gate
   *  itself after the user explicitly approved). */
  userJustApproved?: boolean;
}

export interface ExtensionConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface ExtensionBinding {
  config: ExtensionConfig;
  /** Open MCP session id for this request. */
  sessionId: string;
  /** Raw tool names exposed by the extension. */
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}

/** Prefixed name used to expose an extension tool to the model. */
export function extensionToolName(extId: string, toolName: string): string {
  return `ext_${extId}_${toolName}`;
}

/** Safety rails for third-party tool surfaces. */
export const EXTENSION_LIMITS = { maxServers: 3, maxToolsPerServer: 12, timeoutMs: 15_000 };

/**
 * Connect to every enabled extension and enumerate its tools. Failures are
 * isolated: one broken extension never blocks the chat — it is skipped with
 * a note. Sessions are left open; closeExtensionSessions reaps them.
 */
export async function bindExtensions(store: LibSqlStore, userId?: string): Promise<{ bindings: ExtensionBinding[]; notes: string[] }> {
  const bindings: ExtensionBinding[] = [];
  const notes: string[] = [];
  if (!userId) return { bindings, notes };
  let configs: ExtensionConfig[] = [];
  try {
    const cfg = (await store.getConfig(`extensions.mcp.user.${userId}`)) as { value?: ExtensionConfig[] } | ExtensionConfig[] | null;
    const v = Array.isArray(cfg) ? cfg : (cfg?.value ?? []);
    if (Array.isArray(v)) configs = v.filter((e) => e && typeof e.url === 'string');
  } catch { return { bindings, notes }; }
  for (const cfg of configs.filter((c) => c.enabled).slice(0, EXTENSION_LIMITS.maxServers)) {
    try {
      const session = await openMcpSession(cfg.url);
      const raw = await mcpRaw(session, cfg.url, 'tools/list', {});
      const inner = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const tools = (inner?.tools ?? []) as Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }>;
      const defs = tools
        .filter((t) => typeof t.name === 'string')
        .slice(0, EXTENSION_LIMITS.maxToolsPerServer)
        .map((t) => ({
          name: t.name as string,
          description: String(t.description ?? ''),
          parameters: (t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} }) as Record<string, unknown>,
        }));
      if (defs.length === 0) {
        notes.push(`Extension "${cfg.name}" exposes no tools; skipped.`);
        continue;
      }
      bindings.push({ config: cfg, sessionId: session.sessionId, tools: defs });
    } catch (err) {
      notes.push(`Extension "${cfg.name}" unreachable (${err instanceof Error ? err.message : String(err)}); skipped.`);
    }
  }
  return { bindings, notes };
}

/** Close every extension session opened for a chat request. */
export async function closeExtensionSessions(bindings: ExtensionBinding[] | undefined): Promise<void> {
  if (!bindings?.length) return;
  await Promise.allSettled(bindings.map((b) =>
    fetch(`${b.config.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': b.sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }),
    }).catch(() => undefined)));
}

/** Model-facing tool defs for all bound extensions. */
export function extensionToolDefs(bindings: ExtensionBinding[] | undefined): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  if (!bindings?.length) return [];
  return bindings.flatMap((b) => b.tools.map((t) => ({
    name: extensionToolName(b.config.id, t.name),
    description: `[extension:${b.config.name}] ${t.description}`,
    parameters: t.parameters,
  })));
}

// Centralized fallbacks so admin-curated defaults can never silently drift
// from the hard-coded last-resort values (OpenCodeReview finding).
export const DEFAULT_PROVIDER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_PROVIDER_MODEL = 'deepseek/deepseek-chat-v3-0324';

// ── Per-user marking limits (Phase 3.5, Goal 3) ─────────────────────────────
// The user caps how many markings may sit on screen at once (total, all
// actors). Defaults 2/2, range 0..8. The model may only TIGHTEN them; loosening
// is refused so a cluttered model cannot raise its own ceiling (mirrors the
// enforcePreview asymmetry).
export const MARKING_LIMIT_DEFAULTS: MarkingLimits = { maxTextMarkings: 2, maxNonTextMarkings: 2 };
export const MARKING_LIMIT_MIN = 0;
export const MARKING_LIMIT_MAX = 8;
export interface MarkingLimits { maxTextMarkings: number; maxNonTextMarkings: number }

export async function readMarkingLimits(store: LibSqlStore, userId?: string): Promise<MarkingLimits> {
  if (!userId) return { ...MARKING_LIMIT_DEFAULTS };
  try {
    const cur = (await store.getConfig(`assistant.chat.user.${userId}`)) as Record<string, unknown> | null;
    const v = ((cur && typeof cur === 'object' ? (cur.value ?? cur) : {}) ?? {}) as Record<string, unknown>;
    const pick = (n: unknown, dflt: number): number => {
      if (typeof n !== 'number' || !Number.isFinite(n)) return dflt;
      return Math.min(MARKING_LIMIT_MAX, Math.max(MARKING_LIMIT_MIN, Math.round(n)));
    };
    return {
      maxTextMarkings: pick(v.maxTextMarkings, MARKING_LIMIT_DEFAULTS.maxTextMarkings),
      maxNonTextMarkings: pick(v.maxNonTextMarkings, MARKING_LIMIT_DEFAULTS.maxNonTextMarkings),
    };
  } catch { return { ...MARKING_LIMIT_DEFAULTS }; }
}

// ── Opacity policy (Phase 5, feedback item 1) ────────────────────────────────
// Marks must never read as solid squares: a single marking caps at
// maxSingularOpacity (default 40%), and OVERLAPPING markings compose with the
// pairwise alpha rule 1-(1-a)(1-b) capped at maxOverallOpacity (default 75%).
// Both caps are user-adjustable AND AI-adjustable — but AI changes require
// user approval (pendingPrefs + panel Approve/Deny chip).
export const OPACITY_DEFAULTS = { maxSingularOpacity: 0.4, maxOverallOpacity: 0.75 };
export const OPACITY_MIN = 0.05;
export const OPACITY_MAX = 1.0;
export const MIN_EFFECTIVE_OPACITY = 0.05; // below this a highlight is invisible — refuse instead
export interface OpacityLimits { maxSingularOpacity: number; maxOverallOpacity: number }

export async function readOpacityLimits(store: LibSqlStore, userId?: string): Promise<OpacityLimits> {
  const dflt = { ...OPACITY_DEFAULTS };
  if (!userId) return dflt;
  try {
    const cur = (await store.getConfig(`assistant.chat.user.${userId}`)) as Record<string, unknown> | null;
    const v = ((cur && typeof cur === 'object' ? (cur.value ?? cur) : {}) ?? {}) as Record<string, unknown>;
    const pick = (n: unknown, d: number): number => {
      if (typeof n !== 'number' || !Number.isFinite(n)) return d;
      return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, n));
    };
    const singular = pick(v.maxSingularOpacity, OPACITY_DEFAULTS.maxSingularOpacity);
    const overall = pick(v.maxOverallOpacity, OPACITY_DEFAULTS.maxOverallOpacity);
    return {
      maxSingularOpacity: Math.min(singular, overall), // invariant: singular <= overall
      maxOverallOpacity: overall,
    };
  } catch { return dflt; }
}

/** Pending AI-requested preference changes awaiting user approval. */
export interface PendingPrefs { [key: string]: number | boolean }

// ── Context compaction budget (Phase 6) ─────────────────────────────────────
// Adjustable per user (GUI + AI-with-approval). The EFFECTIVE budget is
// clamped to what the active model can actually hold: an Ollama user with an
// 80k-token GPU limit must never carry a 90k software budget. Model context
// comes from the OpenAI-spec /v1/models listing (context_length /
// top_provider.context_length) with an Ollama-native /api/show fallback,
// cached per model for an hour.
export const CONTEXT_BUDGET_DEFAULT = 48_000;
export const CONTEXT_BUDGET_MIN = 4_000;
export const CONTEXT_BUDGET_MAX = 100_000_000; // 100M-context era headroom (chars)
const CHARS_PER_TOKEN = 3.5; // conservative English+JSON average
const CONTEXT_SAFETY = 0.6; // system + digest tail + output must fit the real window

export async function readContextBudget(store: LibSqlStore, userId?: string): Promise<number> {
  if (!userId) return CONTEXT_BUDGET_DEFAULT;
  try {
    const cur = (await store.getConfig(`assistant.chat.user.${userId}`)) as Record<string, unknown> | null;
    const v = ((cur && typeof cur === 'object' ? (cur.value ?? cur) : {}) ?? {}) as Record<string, unknown>;
    const n = Math.round(Number(v.contextBudgetChars));
    if (!Number.isFinite(n)) return CONTEXT_BUDGET_DEFAULT;
    return Math.min(CONTEXT_BUDGET_MAX, Math.max(CONTEXT_BUDGET_MIN, n));
  } catch { return CONTEXT_BUDGET_DEFAULT; }
}

const modelContextCache = new Map<string, { tokens: number | null; at: number }>();
const MODEL_CONTEXT_TTL_MS = 3_600_000;
const MODEL_CONTEXT_MISS_TTL_MS = 60_000; // OCR: a transient probe failure must not disable clamping for an hour

/** Cache-aware read: hits live for 1h, misses only 60s (retry soon). */
function cachedModelContext(key: string): { tokens: number | null; fresh: boolean } {
  const hit = modelContextCache.get(key);
  if (!hit) return { tokens: null, fresh: false };
  const ttl = hit.tokens === null ? MODEL_CONTEXT_MISS_TTL_MS : MODEL_CONTEXT_TTL_MS;
  return { tokens: hit.tokens, fresh: Date.now() - hit.at < ttl };
}

/**
 * Model context window in TOKENS via the OpenAI-spec GET /models listing.
 * Returns null when the provider does not expose it — the user's budget then
 * stands unclamped (a warning is the caller's job). Never throws.
 */
export async function fetchModelContextTokens(baseUrl: string, apiKey: string, model: string): Promise<number | null> {
  const cacheKey = `${baseUrl}::${model}`;
  const hit = cachedModelContext(cacheKey);
  if (hit.fresh) return hit.tokens;
  let tokens: number | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
      const entry = (body.data ?? []).find((m) => m.id === model || m.name === model);
      const raw = entry?.context_length ?? (entry?.top_provider as Record<string, unknown> | undefined)?.context_length ?? entry?.max_context_length;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) tokens = n;
    }
  } catch { /* fall through to Ollama-native probe */ }
  if (tokens === null) {
    // OCR LOW: the OpenAI-spec listing omits context_length on several
    // providers (Ollama compat, reverse proxies, non-default ports) — probe
    // the native API regardless of port; a non-Ollama host 404s harmlessly.
    try {
      const root = baseUrl.replace(/\/v1\/?$/, '');
      if (root && root !== baseUrl) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(`${root}/api/show`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model }), signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const info = (await res.json()) as { model_info?: Record<string, unknown> };
          for (const [k, v] of Object.entries(info.model_info ?? {})) {
            if (k.endsWith('.context_length') && Number.isFinite(Number(v)) && Number(v) > 0) { tokens = Number(v); break; }
          }
        }
      }
    } catch { /* unknown context — user budget stands */ }
  }
  modelContextCache.set(cacheKey, { tokens, at: Date.now() });
  return tokens;
}

export interface ContextBudget { budgetChars: number; modelContextTokens: number | null; clamped: boolean }

/** Effective compaction budget: the user's preference clamped by the model window. */
export function effectiveContextBudget(userBudgetChars: number, modelContextTokens: number | null): ContextBudget {
  if (modelContextTokens === null || !Number.isFinite(modelContextTokens) || modelContextTokens <= 0) {
    return { budgetChars: userBudgetChars, modelContextTokens: null, clamped: false };
  }
  const modelCap = Math.floor(modelContextTokens * CHARS_PER_TOKEN * CONTEXT_SAFETY);
  // Floor 1500: below it a chat cannot function at all — prefer a usable
  // micro-window over refusing entirely (deliberately below the documented
  // 4k pref minimum, which governs the USER's setting, not the clamp).
  const budgetChars = Math.max(1500, Math.min(userBudgetChars, modelCap));
  return { budgetChars, modelContextTokens, clamped: budgetChars < userBudgetChars };
}

// ── Task plan (Phase 5 item 5: Plan/Act checklist) ──────────────────────────
// OpenCode-style: the model writes a plan, the user approves with Go, then
// the model works the checklist. Statuses are FLUID by design (humans skip
// and reorder) — done/skipped/blocked/pending/in_progress. The checklist is
// the anti-context-rot device: each turn injects a compact one-line state
// instead of the model re-deriving position from long history.
export const PLAN_MAX_STEPS = 12;
export interface TaskStep { text: string; status: 'pending' | 'in_progress' | 'done' | 'skipped' | 'blocked' }
export interface TaskPlan { steps: TaskStep[]; mode: 'plan' | 'act' | 'done'; createdAt: number }
export const TASK_PLAN_KEY = (userId: string): string => `assistant.chat.plan.user.${userId}`;

export async function readTaskPlan(store: LibSqlStore, userId?: string): Promise<TaskPlan | null> {
  if (!userId) return null;
  try {
    const cur = (await store.getConfig(TASK_PLAN_KEY(userId))) as Record<string, unknown> | null;
    const v = ((cur && typeof cur === 'object' ? (cur.value ?? cur) : {}) ?? {}) as unknown as TaskPlan;
    if (!v || !Array.isArray(v.steps) || v.steps.length === 0) return null;
    return v;
  } catch { return null; }
}

/** Compact one-line checklist for system context (the context-rot killer). */
export function taskPlanLine(plan: TaskPlan | null): string {
  if (!plan) return '';
  const marks: Record<TaskStep['status'], string> = {
    done: '[x]', in_progress: '[~]', pending: '[ ]', skipped: '[-]', blocked: '[!]',
  };
  const body = plan.steps.map((s, i) => `${i + 1}.${marks[s.status]}${s.text}`).join('; ');
  const mode = plan.mode === 'plan'
    ? ' AWAITING USER GO — do not execute until the user approves.'
    : plan.mode === 'done' ? ' ALL STEPS COMPLETE.' : ' Continue the first pending/in_progress step without being re-asked.';
  return `TASK CHECKLIST (this is where you are — keep it updated with update_task_step): ${body}${mode}`;
}

export async function writeTaskPlan(store: LibSqlStore, userId: string, plan: TaskPlan): Promise<void> {
  await store.setConfig(TASK_PLAN_KEY(userId), plan as unknown as Record<string, unknown>, 'assistant', userId);
}

/**
 * Phase 5 item 3: wake the C# power gate. Fire-and-forget by callers — the
 * VM's own input never reaches the MCP container's input monitor (its cursor
 * probes look at a display that does not exist there), so the management
 * server feeds wake signals from page activity and chat sends.
 * One shared session per server URL, reopened on failure — OCR finding:
 * a fresh initialize handshake on every 5s-throttled wake churned sessions.
 */
const wakeSessions = new Map<string, Awaited<ReturnType<typeof openMcpSession>>>();
export async function wakeMcp(mcpServerUrl: string): Promise<boolean> {
  try {
    let session = wakeSessions.get(mcpServerUrl);
    if (!session) {
      session = await openMcpSession(mcpServerUrl);
      wakeSessions.set(mcpServerUrl, session);
    }
    await mcpCall(session, mcpServerUrl, 'set_sleep', { enabled: false });
    return true;
  } catch {
    // Stale session: drop it so the next wake re-handshakes.
    wakeSessions.delete(mcpServerUrl);
    return false;
  }
}

export async function readPendingPrefs(store: LibSqlStore, userId: string): Promise<PendingPrefs> {
  try {
    const cur = (await store.getConfig(`assistant.chat.user.${userId}`)) as Record<string, unknown> | null;
    const v = ((cur && typeof cur === 'object' ? (cur.value ?? cur) : {}) ?? {}) as Record<string, unknown>;
    return (v.pendingPrefs && typeof v.pendingPrefs === 'object' ? v.pendingPrefs : {}) as PendingPrefs;
  } catch { return {}; }
}

/**
 * Phase 5 item 1: enforce the opacity policy on a marking before it reaches
 * the C# server. Returns the FINAL opacity to place in the args, or null when
 * no legal value exists (caller refuses with an explanation).
 */
export function resolveAllowedOpacity(
  requested: number | undefined,
  dflt: number,
  limits: OpacityLimits,
  overlapping: Array<{ opacity: number }>,
): { opacity: number } | { refused: string } {
  let o = typeof requested === 'number' && Number.isFinite(requested)
    ? Math.min(OPACITY_MAX, Math.max(0, requested))
    : dflt;
  o = Math.min(o, limits.maxSingularOpacity);
  for (const e of overlapping) {
    const eff = 1 - (1 - o) * (1 - e.opacity);
    if (eff > limits.maxOverallOpacity + 1e-9) {
      // Largest o that keeps this pairwise composition legal.
      const oMax = 1 - (1 - limits.maxOverallOpacity) / (1 - Math.min(1, Math.max(0, e.opacity)));
      if (oMax < MIN_EFFECTIVE_OPACITY || oMax >= o) continue;
      o = oMax;
    }
  }
  if (o < MIN_EFFECTIVE_OPACITY) {
    return {
      refused:
        `The user's opacity policy (max ${Math.round(limits.maxSingularOpacity * 100)}% per marking, ` +
        `${Math.round(limits.maxOverallOpacity * 100)}% where highlights overlap) cannot fit this marking — ` +
        'existing highlights beneath it already saturate the budget. Remove or lighten an existing highlight (remove_overlay), or place this one where nothing overlaps.',
    };
  }
  return { opacity: Math.round(o * 1000) / 1000 };
}

// ── Model-registry helpers shared by HTTP routes and the switch_ai_model tool ──
// OpenRouter slugs carry routing VARIANT suffixes (:nitro = throughput-sorted
// providers, :floor = cheapest, :free = free tier, :thinking = deeper
// reasoning). Variants are part of the requested model string and are kept
// intact everywhere; matching treats "base" and "base:variant" as related.

export interface ApprovedModel { id: string; label?: string; baseUrl: string; model: string }

/** Strip an OpenRouter routing-variant suffix, e.g. "org/name:nitro" -> "org/name". */
export function baseSlug(model: string): string {
  const i = model.indexOf(':');
  return i > 0 ? model.slice(0, i) : model;
}

/**
 * Resolve a free-form model reference (an id like 'openrouter-z-ai-glm',
 * a full slug like 'qwen/qwen3.5-35b-a3b:nitro', or its base slug without a
 * variant) against the approved registry. Exact ids win, then exact slugs,
 * then base-slug matches preferring same-variant over cross-variant.
 */
export function findApprovedModel(
  models: ApprovedModel[],
  queryRaw: string,
): ApprovedModel | null {
  const query = (queryRaw ?? '').trim();
  if (!query) return null;
  const byId = models.find((m) => m.id === query);
  if (byId) return byId;
  const bySlug = models.find((m) => m.model === query);
  if (bySlug) return bySlug;
  const qBase = baseSlug(query);
  const byBase = models.filter((m) => baseSlug(m.model) === qBase);
  if (byBase.length === 0) return null;
  // Same explicit variant first; otherwise barest (variant-less) entry; else first.
  if (!query.includes(':')) return byBase.find((m) => !m.model.includes(':')) ?? byBase[0];
  return byBase.find((m) => m.model === query) ?? byBase[0];
}

export function userSelectionKey(userId: string): string {
  return `provider.chat.user.${userId}`;
}

// Fallback registry used before an admin has curated anything in the DB.
// Mirrors the bootstrap seeds in server.ts — keep the two lists in step.
export const DEFAULT_APPROVED_MODELS: ApprovedModel[] = [
  {
    id: 'openrouter-z-ai-glm-5.3-flash',
    label: 'GLM 5.3 Flash (OpenRouter)',
    baseUrl: DEFAULT_PROVIDER_BASE_URL,
    model: 'z-ai/glm-5.3-flash',
  },
  {
    id: 'openrouter-qwen35-35b-a3b-nitro',
    label: 'Qwen3.5 35B A3B Nitro (OpenRouter, fastest)',
    baseUrl: DEFAULT_PROVIDER_BASE_URL,
    // :nitro routes to throughput-sorted providers (OpenRouter variant).
    model: 'qwen/qwen3.5-35b-a3b:nitro',
  },
];

const TOOL_ALLOWLIST: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [
  {
    name: 'draw_overlay',
    description: 'Draw an overlay box (render only, never an input tool).',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'integer' }, y: { type: 'integer' },
        width: { type: 'integer' }, height: { type: 'integer' },
        color: { type: 'string', description: 'hex color, e.g. #FF0000' },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        label: { type: 'string' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'template_overlay',
    description: 'Draw an overlay from a named template with a small param set, e.g. template="text", params {text, color, x, y, size}. Templates: text, button, region, rectangle, circle, highlight, arrow, svg, object.',
    parameters: {
      type: 'object',
      properties: {
        template: { type: 'string' },
        templateParams: { type: 'string', description: 'JSON object of template parameters' },
        svg: { type: 'string', description: 'raw SVG for template=svg' },
        monitorIndex: { type: 'integer' },
      },
      required: ['template'],
    },
  },
  {
    name: 'take_screenshot',
    description: 'Capture a screenshot of the current display to inspect it.',
    parameters: { type: 'object', properties: { monitorIndex: { type: 'integer' } } },
  },
  {
    name: 'get_display_info',
    description: 'Get display/monitor layout to position overlays correctly.',
    parameters: { type: 'object', properties: {} },
  },
  {
    // Phase 3.5 A3: set_mode/set_display_actor are NO LONGER model tools —
    // they burned entire turns (112s of pure inference in the wild) on setup.
    // The server now runs them deterministically before any draw forward
    // (see ensureDrawReady), so the model's first tool call can be the draw.
    // R14: the model controls its OWN view cadence — arbitrary milliseconds,
    // not presets. Tighten while placing/moving overlays; relax afterwards.
    name: 'set_screen_updates',
    description:
      'Change how often your screen view refreshes. cadenceMs in milliseconds (500..1800000), or 0 for input-triggered-only updates, or -1 to disable mirroring entirely. Strategy: use 1000-2000 while locating targets or verifying placements, then relax to 30000+ when idle so you always see current state without wasting context.',
    parameters: {
      type: 'object',
      properties: { cadenceMs: { type: 'integer', description: 'Refresh interval in ms (500..1800000); 0 = only on user input; -1 = off' } },
      required: ['cadenceMs'],
    },
  },
  {
    // A2: inventory + cleanup — kills the config-probing death spiral.
    name: 'list_overlays',
    description:
      'List overlays currently on screen (id, type, color, bounds, owner, age). ALWAYS use this to discover existing annotations and their removable ids — never probe get_config for overlay state.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_overlay_stats',
    description:
      'Count active overlays by owner and by type (text vs non-text). Call before placing more annotations or whenever the user mentions clutter.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'clear_overlays',
    description:
      "Bulk-remove overlays. scope='self' removes only your own (safe default). scope='all' wipes the entire canvas and needs assist mode. Use when the user asks to clear/reset the screen.",
    parameters: {
      type: 'object',
      properties: { scope: { type: 'string', enum: ['self', 'all'] } },
      required: ['scope'],
    },
  },
  {
    // Phase 5 item 5: Plan/Act. The model writes the checklist, the panel
    // pauses for the user's Go, then the model works it fluidly.
    name: 'set_task_plan',
    description:
      'Write the task checklist (Plan mode). Use for any task with more than 2 steps: split it into concrete, independently checkable steps (max 12). The user must approve the plan (they click Go) before you start acting. Replace the plan by calling again.',
    parameters: {
      type: 'object',
      properties: {
        steps: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
      },
      required: ['steps'],
    },
  },
  {
    name: 'update_task_step',
    description:
      'Update one checklist step as you work. status: in_progress (starting), done (verified on screen), skipped (user handled it or it is moot), blocked (needs the user). Out-of-order and skipped steps are normal — follow reality, not the order. When every step is done or skipped the checklist completes.',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: '1-based step number' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'skipped', 'blocked'] },
        note: { type: 'string', description: 'short note replacing the step text if provided' },
      },
      required: ['index', 'status'],
    },
  },
  {
    // Phase 5 item 2: stepwise guidance mode. When enabled, the server auto-
    // removes the previous step's marking as each new one commits — the
    // "1 at a time" tutorial UX without relying on model diligence.
    name: 'set_step_mode',
    description:
      "Enable stepwise-guidance cleanup. When the user asks to be shown actions ONE at a time, enable this; from then on each new marking you commit automatically removes the previous step's marking. Disable when returning to free-form annotation.",
    parameters: {
      type: 'object',
      properties: { enabled: { type: 'boolean' } },
      required: ['enabled'],
    },
  },
  {
    // Served locally: user-owned preferences (mirrors the Settings GUI).
    name: 'set_my_preferences',
    description:
      "Read or change the user's assistant preferences. Call with NO arguments to read all settings. " +
      "enforcePreview (boolean): every screen marking is ghost-previewed to you for approval before the user sees it; you may enable it, never disable it. " +
      "maxTextMarkings / maxNonTextMarkings (integers 0..8): cap how many text / non-text markings may be on screen at once; you can tighten but never loosen them. " +
      "maxSingularOpacity / maxOverallOpacity (numbers 0.05..1.0, singular <= overall): how transparent markings must stay; you may change these in EITHER direction but each change needs explicit user approval via the panel prompt. " +
      `contextBudgetChars (integer ${CONTEXT_BUDGET_MIN}..${CONTEXT_BUDGET_MAX}): how much conversation history is kept before older turns are auto-compacted; also needs user approval. ` +
      "Only change any setting when the user explicitly asks.",
    parameters: {
      type: 'object',
      properties: { enforcePreview: { type: 'boolean' } },
    },
  },
  {
    // Served locally: reads the browser-captured framebuffer (see
    // screen-mirror.ts) and returns it as an image message so vision-capable
    // models can actually SEE the user's screen.
    name: 'see_screen',
    description:
      'Look at what is currently on the screen (real pixels, captured by the browser). Use this BEFORE placing overlays, to verify placement afterwards, or whenever asked what you can see. Returns an image plus metadata.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    // Served locally: composes a ghost preview over the mirrored frame so you
    // can check a candidate annotation WITHOUT showing it to the user yet.
    name: 'preview_overlay',
    description:
      "Ghost-preview where an overlay WOULD appear: renders your candidate coordinates semi-transparently on the last screen capture. Nothing reaches the user until you call template_overlay/draw_overlay. Use when unsure about placement.",
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'integer' }, y: { type: 'integer' },
        width: { type: 'integer' }, height: { type: 'integer' },
        color: { type: 'string' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'get_overlay_capabilities',
    description: 'List overlay engine capabilities and template catalog.',
    parameters: { type: 'object', properties: {} },
  },
  {
    // R15 adjustability: annotations are editable — delete and redraw anywhere.
    name: 'remove_overlay',
    description:
      'Remove any overlay by id. Find ids with list_overlays. Combine with a new draw call to MOVE or RESIZE an annotation; use clear_overlays for bulk cleanup.',
    parameters: { type: 'object', properties: { overlayId: { type: 'string' } }, required: ['overlayId'] },
  },
  // Admin-only config tools (B3): the interior assistant can configure the app
  // via chat when the user is an admin. Server enforces the role, not the model.
  {
    name: 'get_config',
    description: 'Read application configuration (category, key). Secrets are redacted.',
    parameters: { type: 'object', properties: { category: { type: 'string' }, key: { type: 'string' } }, required: ['category', 'key'] },
  },
  {
    name: 'set_config',
    description: 'Set an application configuration value (admin only).',
    parameters: {
      type: 'object',
      properties: { category: { type: 'string' }, key: { type: 'string' }, value: { type: 'object' } },
      required: ['category', 'key', 'value'],
    },
  },
  {
    // Served locally by runTool(); no MCP_TOOL_ARG_MAP entry needed because
    // this never forwards to the C# MCP server.
    name: 'switch_ai_model',
    description:
      "Switch the AI model powering this chat. Use whenever the user asks to change your AI model/brain/speed. " +
      "Pass the model slug exactly as the user said it — OpenRouter routing variants are supported and preserved, e.g. 'qwen/qwen3.5-35b-a3b:nitro' (nitro = fastest providers). " +
      "Only admin-approved models are permitted; if the slug is not approved the result explains how approval works.",
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: "Model id or OpenRouter slug, optionally with variant suffix, e.g. 'qwen/qwen3.5-35b-a3b:nitro'." },
      },
      required: ['slug'],
    },
  },
];

/** Snapshot of the core tool defs (for merging with extension tools). */
export function coreToolDefs(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return TOOL_ALLOWLIST.map((t) => ({ ...t }));
}

const MCP_TOOL_ARG_MAP: Record<string, (args: Record<string, unknown>) => Record<string, unknown>> = {
  draw_overlay: (a) => ({
    x: a.x, y: a.y, width: a.width, height: a.height,
    color: a.color, opacity: a.opacity, id: a.label, actor: 'interior',
  }),
  template_overlay: (a) => ({
    template: a.template,
    templateParams: a.templateParams,
    svg: a.svg,
    monitorIndex: a.monitorIndex,
    actor: 'interior',
  }),
  take_screenshot: (a) => ({ monitorIndex: a.monitorIndex }),
  get_display_info: () => ({}),
  set_display_actor: (a) => ({ actor: a.actor }),
  set_mode: (a) => ({ mode: a.mode }),
  remove_overlay: (a) => ({ overlayId: a.overlayId ?? a.overlay_id }),
  list_overlays: () => ({}),
  get_overlay_stats: () => ({}),
  clear_overlays: (a) => ({ scope: a.scope ?? 'self' }),
  re_anchor_element: (a) => ({
    overlay_id: a.overlayId ?? a.overlay_id,
    x: a.x, y: a.y,
    anchor_mode: a.anchorMode ?? a.anchor_mode,
    monitor_index: a.monitorIndex ?? a.monitor_index,
  }),
  get_overlay_capabilities: () => ({}),
};

interface McpSession {
  sessionId: string;
  nextId: number;
}

/**
 * Minimal Streamable HTTP MCP client. Establishes an initialize handshake,
 * reuses the Mcp-Session-Id, and tolerates both JSON and SSE (text/event-stream)
 * responses — the .NET MCP SDK streams results for long-running calls.
 */
async function openMcpSession(mcpServerUrl: string): Promise<McpSession> {
  const res = await fetch(`${mcpServerUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'overlay-companion-chat', version: '1.0.0' },
      },
    }),
  });
  if (!res.ok) throw new Error(`MCP initialize failed: ${res.status}`);
  const sessionId = res.headers.get('mcp-session-id') ?? '';
  await consumeBody(res);
  if (sessionId) {
    await fetch(`${mcpServerUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }).catch(() => undefined);
  }
  return { sessionId, nextId: 2 };
}

/**
 * P0 display truth: rescale coordinates authored against a phantom display
 * layout (the C# default 1920x1080 when real capture is unavailable) into the
 * REAL guest resolution reported by the screen mirror. Applied only when the
 * incoming geometry overflows the real display AND the rescale brings it in
 * bounds — coordinates already in true space pass through untouched.
 * Scales positional fields only (x/y/width/height/radius/x2/y2); font sizes
 * and text are layout-independent and stay put.
 */
export function scaleIntoTrueDisplay(name: string, args: Record<string, unknown>): boolean {
  const f = latestFrame();
  if (!f) return false;
  const trueW = Number(f.displayWidth), trueH = Number(f.displayHeight);
  if (!trueW || !trueH) return false;

  const PHANTOM_W = 1920, PHANTOM_H = 1080; // C# GetScreenResolutionAsync default
  if (trueW >= PHANTOM_W && trueH >= PHANTOM_H) return false; // no phantom to fix

  const POS = ['x', 'y', 'width', 'height', 'radius', 'x2', 'y2'] as const;
  const readBounds = (raw: Record<string, unknown>): { maxX: number; maxY: number } | null => {
    const num = (k: string): number | null => {
      const v = Number(raw[k]);
      return Number.isFinite(v) ? v : null;
    };
    let maxX = -Infinity, maxY = -Infinity;
    const x = num('x'), y = num('y'), w = num('width'), h = num('height');
    const r = num('radius'), x2 = num('x2'), y2 = num('y2');
    // Capture x and y INDEPENDENTLY — folding y into the x branch left
    // shapes with y but no x returning maxY=-Infinity (readBounds null →
    // rescale skipped → off-screen draw).
    if (x !== null) maxX = Math.max(maxX, x);
    if (y !== null) maxY = Math.max(maxY, y);
    if (x !== null && w !== null) maxX = Math.max(maxX, x + Math.abs(w));
    if (y !== null && h !== null) maxY = Math.max(maxY, y + Math.abs(h));
    if (x !== null && r !== null) maxX = Math.max(maxX, x + r);
    if (y !== null && r !== null) maxY = Math.max(maxY, y + r);
    if (x2 !== null) maxX = Math.max(maxX, x2);
    if (y2 !== null) maxY = Math.max(maxY, y2);
    return Number.isFinite(maxX) || Number.isFinite(maxY) ? { maxX: Math.max(0, maxX), maxY: Math.max(0, maxY) } : null;
  };

  const scaleValues = (raw: Record<string, unknown>): void => {
    const sx = trueW / PHANTOM_W, sy = trueH / PHANTOM_H, sr = Math.min(sx, sy);
    for (const k of POS) {
      const v = Number(raw[k]);
      if (!Number.isFinite(v)) continue;
      const s = k === 'radius' ? sr : (k === 'y' || k === 'height' || k === 'y2') ? sy : sx;
      raw[k] = Math.round(v * s);
    }
  };

  if (name === 'draw_overlay') {
    const b = readBounds(args);
    if (!b || (b.maxX <= trueW && b.maxY <= trueH)) return false; // already in true space
    const sx = trueW / PHANTOM_W, sy = trueH / PHANTOM_H;
    const probe = { ...args };
    scaleValues(probe);
    const pb = readBounds(probe);
    if (!pb || pb.maxX > trueW + 64 || pb.maxY > trueH + 64) return false; // rescale would not fit — not phantom space
    scaleValues(args);
    return true;
  }

  if (name === 'template_overlay') {
    let raw = args.templateParams;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { return false; }
    }
    if (!raw || typeof raw !== 'object') return false;
    const params = raw as Record<string, unknown>;
    const b = readBounds(params);
    if (!b || (b.maxX <= trueW && b.maxY <= trueH)) return false;
    const probe = { ...params };
    scaleValues(probe);
    const pb = readBounds(probe);
    if (!pb || pb.maxX > trueW + 64 || pb.maxY > trueH + 64) return false;
    scaleValues(params);
    args.templateParams = JSON.stringify(params);
    return true;
  }
  return false;
}

async function mcpCall(session: McpSession, mcpServerUrl: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  return mcpRaw(session, mcpServerUrl, 'tools/call', { name, arguments: args });
}

/** Generic JSON-RPC MCP request (initialize follow-ups like tools/list). */
async function mcpRaw(session: McpSession, mcpServerUrl: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  const id = session.nextId++;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId;
  const res = await fetch(`${mcpServerUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  if (!res.ok) throw new Error(`MCP ${method} failed: ${res.status}`);
  const body = await readBody(res);
  if (res.headers.get('mcp-session-id')) session.sessionId = res.headers.get('mcp-session-id')!;
  return parseMcpResult(body);
}

async function consumeBody(res: Response): Promise<void> {
  await res.text();
}

async function readBody(res: Response): Promise<string> {
  const ct = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (!ct.includes('text/event-stream')) return text;
  // SSE: extract every `data:` payload and concatenate.
  const lines = text.split('\n');
  const payloads = lines
    .filter((l: string) => l.startsWith('data:'))
    .map((l: string) => l.slice(5).trim())
    .filter((l: string) => l.length > 0 && l !== '[DONE]');
  return payloads.join('\n');
}

function parseMcpResult(raw: string): unknown {
  // Prefer the last JSON object (SSE may carry several events; the final
  // is the result for our request id).
  const objects: Array<{ jsonrpc?: string; result?: unknown; error?: { message?: string } }> = [];
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  for (const line of lines) {
    try {
      objects.push(JSON.parse(line));
    } catch {
      /* skip non-JSON SSE event */
    }
  }
  if (objects.length === 0) return { raw };
  const last = objects[objects.length - 1];
  if (last.error) throw new Error(last.error.message ?? 'MCP error');
  return last.result ?? last;
}

export class InteriorChat {
  private store: LibSqlStore;

  /** Vision parts queued by see_screen / preview_overlay for this turn. */

  constructor(store: LibSqlStore) {
    this.store = store;
  }

  private async opts(): Promise<ChatSessionOptions> {
    const provider = (await this.store.getConfig('provider.chat')) as Record<string, unknown> | null;
    return {
      mcpServerUrl: process.env.MCP_SERVER_URL || 'http://localhost:3001',
      providerBaseUrl: (provider?.baseUrl as string) || DEFAULT_PROVIDER_BASE_URL,
      providerApiKey: (provider?.apiKey as string) || process.env.PROVIDER_API_KEY || '',
      providerModel: (provider?.model as string) || DEFAULT_PROVIDER_MODEL,
      userRole: 'user',
    };
  }

  /**
   * Stream a chat completion from OpenRouter. Executes bounded tool calls
   * against the C# MCP server and returns the final assistant text.
   * `messages` uses the OpenAI chat shape; the model may request tools.
   */
  async *stream(opts: ChatSessionOptions, messages: Array<Record<string, unknown>>, toolDefs?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>): AsyncGenerator<string> {
    if (!opts.providerApiKey) {
      yield 'The chat provider is not configured. Ask an admin to set the provider API key in Settings.';
      return;
    }
    const body: Record<string, unknown> = {
      model: opts.providerModel,
      messages,
      stream: true,
      tools: (toolDefs ?? TOOL_ALLOWLIST).map((t) => ({ type: 'function', function: t })),
    };
    const res = await fetch(`${opts.providerBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.providerApiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      yield `Chat provider error (${res.status}): ${detail.slice(0, 300)}`;
      return;
    }
    if (!res.body) { yield 'No stream from provider.'; return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let toolCalls: ChatToolCall[] = [];
    // Staging buffer for streamed tool-call argument fragments (keyed by the
    // provider's call id; '__call__' fallback when ids are omitted).
    const pendingTools = new Map<string, { id: string; name: string; rawArgs: string }>();

    // Some models (Qwen via certain OpenRouter routes) ignore the native
    // function-calling channel and emit Hermes-style <tool_call> XML inline in
    // their reasoning/text. We: (a) stream user-visible output EXCLUDING those
    // blocks using an incremental cursor, (b) convert them into real tool
    // calls at finish if no native ones arrived.
    let thinkingAcc = '';
    let thinkingCursor = 0;
    let textAcc = '';
    let textCursor = 0;
    let hermesUsed = false;

    type HermesCall = { id: string; name: string; arguments: Record<string, unknown> };

    function extractHermesCalls(): HermesCall[] {
      const calls: HermesCall[] = [];
      const re = /<tool_call>([\s\S]*?)<\/tool_call>/g;
      for (const acc of [thinkingAcc, textAcc]) {
        for (const m of acc.matchAll(re)) {
          const inner = m[1].trim();
          let name = '';
          let args: Record<string, unknown> = {};
          try {
            const asJson = JSON.parse(inner) as Record<string, any>;
            name = String(asJson.name ?? asJson?.function?.name ?? '');
            args = asJson.arguments ?? asJson.parameters ?? asJson?.function?.arguments ?? {};
          } catch { /* attribute syntax */ }
          if (!name) {
            const fn = /<function=([A-Za-z0-9_.-]+)>/.exec(inner);
            name = fn?.[1] ?? '';
            const b1 = inner.indexOf('{');
            const b2 = inner.lastIndexOf('}');
            if (b1 !== -1 && b2 > b1) {
              try { args = JSON.parse(inner.slice(b1, b2 + 1)); } catch { args = {}; }
            }
          }
          if (name) calls.push({ id: randomUUID(), name, arguments: (args && typeof args === 'object') ? args : {} });
        }
      }
      return calls;
    }

    /**
     * Incremental pass-through of `acc` from `cursor`, withholding anything
     * inside (or partially opened as) a <tool_call> block. Returns the new
     * cursor along with text that is safe to show right now.
     */
    function nextVisible(acc: string, cursor: number): { cursor: number; visible: string } {
      let out = '';
      let pos = cursor;
      while (pos < acc.length) {
        const open = acc.indexOf('<tool_call>', pos);
        if (open === -1) {
          // Hold back a trailing partial '<to', '<too' ... prefix of '<tool_call>'.
          for (let k = Math.min(10, acc.length - pos); k > 0; k--) {
            if ('<tool_call>'.startsWith(acc.slice(acc.length - k))) {
              out += acc.slice(pos, acc.length - k);
              return { cursor: acc.length - k, visible: out };
            }
          }
          out += acc.slice(pos);
          pos = acc.length;
        } else if (open === pos) {
          const close = acc.indexOf('</tool_call>', open + 11);
          if (close === -1) break; // still open; stop streaming this channel
          pos = close + 12;
        } else {
          out += acc.slice(pos, open);
          pos = open;
        }
      }
      return { cursor: pos, visible: out };
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const chunk = JSON.parse(data);
              const choice = chunk.choices?.[0];
              // Reasoning models stream their chain-of-thought in a separate
              // delta; forward it so the panel can render a collapsible
              // "thinking" block instead of losing it silently.
              if (choice?.delta?.reasoning) {
                thinkingAcc += choice.delta.reasoning;
                const r = nextVisible(thinkingAcc, thinkingCursor);
                thinkingCursor = r.cursor;
                if (r.visible) yield JSON.stringify({ __thinking: r.visible });
              }
              if (choice?.delta?.content) {
                textAcc += choice.delta.content;
                const r = nextVisible(textAcc, textCursor);
                textCursor = r.cursor;
                if (r.visible) yield r.visible;
              }
              if (choice?.delta?.tool_calls) {
                for (const tc of choice.delta.tool_calls) {
                  // Provider-streamed tool calls arrive as FRAGMENTS sharing
                  // one index: the first chunk carries id+name+empty args,
                  // later chunks carry ONLY index+argument text. Key strictly
                  // by that index; fill id/name as they appear; append arg
                  // text verbatim.
                  const slotKey = String((tc as { index?: number }).index ?? tc.id ?? `slot${pendingTools.size}`);
                  let entry = pendingTools.get(slotKey);
                  if (!entry) {
                    entry = { id: '', name: '', rawArgs: '' };
                    pendingTools.set(slotKey, entry);
                  }
                  if (tc.id) entry.id = tc.id;
                  if (tc.function?.name) entry.name = tc.function.name;
                  const fragment = tc.function?.arguments ?? '';
                  if (fragment) entry.rawArgs += fragment;
                }
              }
              if (choice?.finish_reason) {
                // Parse accumulated argument fragments once, now that the full
                // JSON string has arrived.
                for (const staged of pendingTools.values()) {
                  if (!staged.name) continue;
                  let args: Record<string, unknown> = {};
                  try { args = JSON.parse(staged.rawArgs || '{}'); } catch { /* leave {} */ }
                  toolCalls.push({ id: staged.id || randomUUID(), name: staged.name, arguments: args });
                }
                pendingTools.clear();
                if (toolCalls.length === 0 && !hermesUsed) {
                  // Model bypassed the native channel; salvage inline blocks
                  // exactly once per response stream.
                  hermesUsed = true;
                  for (const hc of extractHermesCalls()) {
                    toolCalls.push({ id: hc.id, name: hc.name, arguments: hc.arguments });
                  }
                }
                if (toolCalls.length > 0) {
                  yield JSON.stringify({ __tool_calls: toolCalls });
                  toolCalls = [];
                }
              }
            } catch {
              /* skip non-JSON event */
            }
          }
        }
      }
      const tailT = nextVisible(textAcc, textCursor);
      textCursor = tailT.cursor;
      if (tailT.visible) yield tailT.visible;
      const tailK = nextVisible(thinkingAcc, thinkingCursor);
      thinkingCursor = tailK.cursor;
      if (tailK.visible) yield JSON.stringify({ __thinking: tailK.visible });
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Execute a single allowlisted tool via the C# MCP server (the same tools an
   * external client uses). Config tools are admin-only and served here.
   */
  /** Phase 3: ask the page to ghost-render a candidate and wait for it. */
  private async composePreview(spec: { x: number; y: number; width: number; height: number; color?: string }): Promise<ReturnType<typeof currentPreview>> {
    if (!mirrorControl.send) return null;
    const t = Date.now();
    mirrorControl.send({ previewSpec: spec });
    return waitForPreview(t, 1500);
  }

  private static normalizeSpec(name: string, args: Record<string, unknown>): { template: string; color: string; bounds: { x: number; y: number; width: number; height: number } } | null {
    let template: string;
    let raw: Record<string, unknown> = args;
    if (name === 'draw_overlay') {
      template = 'rectangle';
    } else if (name === 'template_overlay') {
      template = String(args.template ?? '').toLowerCase();
      const tp = args.templateParams;
      if (typeof tp === 'string') {
        try { raw = { ...args, ...JSON.parse(tp) }; } catch { /* keep args */ }
      } else if (tp && typeof tp === 'object') {
        raw = { ...args, ...(tp as Record<string, unknown>) };
      }
    } else return null;
    const num = (k: string): number => Math.round(Number(raw[k] ?? 0)) || 0;
    // C# template semantics: circle takes a CENTER (x,y) + radius, not
    // top-left bounds. Normalize to a bounding box so the gate and the ghost
    // preview speak the same geometry the committed overlay will have.
    const radius = Number(raw.radius ?? 0);
    let bounds: { x: number; y: number; width: number; height: number };
    if (template === 'circle' && radius > 0) {
      const cx = num('x'), cy = num('y');
      bounds = { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 };
    } else if (template === 'text' && (raw.text || raw.label)) {
      const size = num('size') || 18;
      const text = String(raw.text ?? raw.label ?? '');
      bounds = { x: num('x'), y: num('y'), width: Math.round(text.length * size * 0.6) || 40, height: Math.round(size * 1.5) };
    } else {
      bounds = { x: num('x'), y: num('y'), width: num('width'), height: num('height') };
    }
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const color = String(raw.color ?? '#ff0000').toLowerCase();
    return { template, color, bounds };
  }

  private static specMatches(a: { template: string; color: string; bounds: { x: number; y: number; width: number; height: number } }, b: { template: string; color: string; bounds: { x: number; y: number; width: number; height: number } }): boolean {
    const near = (x: number, y: number): boolean => Math.abs(x - y) <= 4;
    return a.template === b.template
      && near(a.bounds.x, b.bounds.x) && near(a.bounds.y, b.bounds.y)
      && near(a.bounds.width, b.bounds.width) && near(a.bounds.height, b.bounds.height)
      && a.color === b.color;
  }

  /**
   * Phase 3.5 A3: run the draw preconditions (assist mode + interior display
   * owner) deterministically server-side. Models burned whole inference turns
   * (112s+ observed) on set_mode/set_display_actor before their first draw;
   * now their first tool call can be the draw itself. Cheap idempotent calls;
   * best-effort — a failure surfaces through the draw's own error.
   */
  private static drawReadyDone = new Set<string>();
  private async ensureDrawReady(mcpServerUrl: string): Promise<void> {
    if (InteriorChat.drawReadyDone.has(mcpServerUrl)) return;
    try {
      const s = await openMcpSession(mcpServerUrl);
      await mcpCall(s, mcpServerUrl, 'set_mode', { mode: 'assist' });
      await mcpCall(s, mcpServerUrl, 'set_display_actor', { actor: 'interior' });
      InteriorChat.drawReadyDone.add(mcpServerUrl);
    } catch { /* forward will report the real blocker */ }
  }

  /** Total-marking counts from the C# registry (ground truth for limits). */
  private async fetchMcpOverlayStats(mcpServerUrl: string): Promise<{ text: number; non_text: number; text_ids: string[]; non_text_ids: string[] } | null> {
    try {
      const s = await openMcpSession(mcpServerUrl);
      const raw = await mcpCall(s, mcpServerUrl, 'get_overlay_stats', {});
      const inner = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const payload = typeof inner?.content?.[0]?.text === 'string' ? JSON.parse(inner.content[0].text) : inner;
      if (!payload || typeof payload.total !== 'number') return null;
      return {
        text: Number(payload.text ?? 0),
        non_text: Number(payload.non_text ?? 0),
        text_ids: Array.isArray(payload.text_ids) ? payload.text_ids.map(String) : [],
        non_text_ids: Array.isArray(payload.non_text_ids) ? payload.non_text_ids.map(String) : [],
      };
    } catch { return null; }
  }

  async runTool(opts: ChatSessionOptions, call: ChatToolCall): Promise<string> {
    // Phase 4 extensions: prefixed calls route to their own MCP session.
    // The core overlay allowlist deliberately does NOT cover these.
    if (call.name.startsWith('ext_')) {
      const binding = opts.extensions?.find((b) => call.name.startsWith(`ext_${b.config.id}_`));
      if (!binding) {
        return JSON.stringify({ error: 'extension_unbound', message: 'No extension session is bound for this tool. It may have failed to connect.' });
      }
      const toolName = call.name.slice(`ext_${binding.config.id}_`.length);
      const owned = binding.tools.some((t) => t.name === toolName);
      if (!owned) {
        return JSON.stringify({ error: 'not_in_allowlist', message: `Tool ${toolName} is not exposed by extension ${binding.config.name}.` });
      }
      try {
        const raw = await Promise.race([
          mcpCall(
            { sessionId: binding.sessionId, nextId: 0 },
            binding.config.url, toolName, call.arguments ?? {},
          ),
          new Promise((_, reject) => setTimeout(
            () => reject(new Error(`extension tool timed out after ${EXTENSION_LIMITS.timeoutMs}ms`)),
            EXTENSION_LIMITS.timeoutMs,
          )),
        ]);
        return JSON.stringify(raw);
      } catch (err) {
        return JSON.stringify({
          error: 'extension_error',
          message: `Extension ${binding.config.name} tool ${toolName} failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    if (!TOOL_ALLOWLIST.some((t) => t.name === call.name)) {
      return JSON.stringify({ error: `Tool ${call.name} is not in the chat allowlist.` });
    }
    // Config tools (B3) are served locally by the management server so the chat
    // can configure the app without reaching into the MCP surface.
    if (call.name === 'get_config') {
      return await this.getConfigLocal(opts, call.arguments);
    }
    if (call.name === 'set_config') {
      if (opts.userRole !== 'admin') return JSON.stringify({ error: 'Admin role required to set config.' });
      return await this.setConfigLocal(opts, call.arguments);
    }
    if (call.name === 'switch_ai_model') {
      return await this.switchModelLocal(opts, call.arguments);
    }

    if (call.name === 'see_screen') {
      // Ask the page for fresh pixels; serve the newest frame within 1.5s,
      // honestly flagging staleness when the desktop page isn't connected.
      if (mirrorControl.send) {
        mirrorControl.send({ triggerNow: true });
        for (let waited = 0; waited < 1500; waited += 200) {
          const probe = latestFrame();
          if (probe && Date.now() - probe.capturedAt < 1200) break;
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      const f = latestFrame();
      if (!f) {
        return JSON.stringify({
          error: 'no_capture_yet',
          message:
            'The screen mirror has not captured anything yet (feature disabled or desktop page never connected). Ask the user to enable screen mirroring, or proceed with estimated coordinates from get_display_info.',
        });
      }
      const ageS = Math.round((Date.now() - f.capturedAt) / 1000);
      const stale = ageS >= 5;
      // Attach the image as an extra user-side content part so vision models
      // genuinely see it; text result explains what it is.
      (opts.gate ??= {}).vision =
        [{ type: 'image_url', image_url: { url: f.dataUrl }, note: `screen@${ageS}s ago` }];
      return JSON.stringify({
        seen: true,
        capturedSecondsAgo: ageS,
        stale, // true means the desktop page may be gone or mirroring disabled
        display: `${f.displayWidth}x${f.displayHeight}`,
        trigger: f.trigger,
        note:
          "The attached image is the user's actual screen, captured recently. Use its layout directly; coordinates you output map onto this same view.",
      });
    }

    if (call.name === 'set_task_plan') {
      if (!opts.userId) return JSON.stringify({ error: 'no_user_context' });
      const steps = call.arguments.steps;
      if (!Array.isArray(steps) || steps.length === 0) {
        return JSON.stringify({ error: 'invalid_args', message: 'steps must be a non-empty array of strings.' });
      }
      const texts = steps.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, PLAN_MAX_STEPS);
      if (texts.length === 0) return JSON.stringify({ error: 'invalid_args', message: 'steps must contain at least one non-empty string.' });
      const plan: TaskPlan = {
        steps: texts.map((t) => ({ text: t.slice(0, 160), status: 'pending' as const })),
        // Phase 6: the user JUST approved — a fresh plan in this same turn is
        // execution-ready; re-entering plan mode would dead-end the turn.
        mode: opts.userJustApproved ? 'act' : 'plan',
        createdAt: Date.now(),
      };
      await writeTaskPlan(this.store, opts.userId, plan);
      return JSON.stringify({
        ok: true,
        mode: plan.mode,
        steps: plan.steps.map((s, i) => ({ index: i + 1, text: s.text, status: s.status })),
        note: plan.mode === 'plan'
          ? 'PLAN READY — the user sees a checklist with a Go button. Do NOT start executing until the user approves (says go / clicks Go). When they do, work the checklist and keep it updated with update_task_step.'
          : 'PLAN READY AND APPROVED (the user just said go) — work the checklist now and keep it updated with update_task_step. Do not pause for approval again.',
      });
    }

    if (call.name === 'update_task_step') {
      if (!opts.userId) return JSON.stringify({ error: 'no_user_context' });
      const plan = await readTaskPlan(this.store, opts.userId);
      if (!plan) return JSON.stringify({ error: 'no_plan', message: 'No checklist exists. Call set_task_plan first.' });
      const idx = Math.round(Number(call.arguments.index));
      const status = String(call.arguments.status ?? '');
      if (!Number.isFinite(idx) || idx < 1 || idx > plan.steps.length) {
        return JSON.stringify({ error: 'invalid_args', message: `index must be 1..${plan.steps.length}.` });
      }
      if (!['pending', 'in_progress', 'done', 'skipped', 'blocked'].includes(status)) {
        return JSON.stringify({ error: 'invalid_args', message: 'status must be pending|in_progress|done|skipped|blocked.' });
      }
      // OCR HIGH: enforce the Go gate server-side — a model that jumps
      // straight to update_task_step after set_task_plan must NOT silently
      // flip the plan into Act mode; approval belongs to the user.
      if (plan.mode === 'plan') {
        return JSON.stringify({
          error: 'plan_not_approved',
          message: 'The plan is still awaiting user approval. Do not start acting until the user says go / clicks Go.',
        });
      }
      plan.steps[idx - 1].status = status as TaskStep['status'];
      if (typeof call.arguments.note === 'string' && call.arguments.note.trim()) {
        plan.steps[idx - 1].text = String(call.arguments.note).trim().slice(0, 160);
      }
      // 'blocked' means a step still needs the user — it is NOT completion.
      const remaining = plan.steps.filter((s) => ['pending', 'in_progress', 'blocked'].includes(s.status)).length;
      if (remaining === 0) plan.mode = 'done';
      await writeTaskPlan(this.store, opts.userId, plan);
      const done = plan.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
      return JSON.stringify({
        ok: true,
        progress: `${done}/${plan.steps.length}`,
        mode: plan.mode,
        ...(plan.mode === 'done' ? { note: 'CHECKLIST COMPLETE. Report completion in one short sentence. The user may start a new task or go idle.' } : {}),
        steps: plan.steps.map((s, i) => ({ index: i + 1, text: s.text, status: s.status })),
      });
    }

    if (call.name === 'set_step_mode') {
      (opts.gate ??= {}).stepMode = call.arguments.enabled === true;
      if (!opts.gate.stepMode) { opts.gate.stepMarkingId = undefined; opts.gate.stepMarkingIsText = undefined; }
      // Persist: stepwise guidance spans multiple user messages; a
      // request-scoped flag silently dies after the first reply.
      if (opts.userId) {
        const key = `assistant.chat.user.${opts.userId}`;
        // Normalize BOTH config shapes ({value:{...}} row or flat record) — a
        // flat-record store would otherwise resolve to {} and wipe sibling prefs.
        const curRow = (await this.store.getConfig(key)) as Record<string, unknown> | null;
        const existing = ((curRow && typeof curRow === 'object' ? (curRow.value ?? curRow) : {}) ?? {}) as Record<string, unknown>;
        await this.store.setConfig(key, { ...existing, stepMode: opts.gate.stepMode }, 'assistant', opts.userId);
      }
      return JSON.stringify({
        ok: true,
        stepMode: opts.gate.stepMode,
        note: opts.gate.stepMode
          ? 'Stepwise cleanup armed: each marking you commit removes the previous step\'s marking automatically. Keep narrating ONE action per marking.'
          : 'Stepwise cleanup disabled.',
      });
    }

    if (call.name === 'clear_overlays') {
      // 1) Wipe the render layer (bridge cache + browser canvases) — covers
      // overlays C# no longer tracks (post-restart ghosts).
      overlayControl.clear?.();
      // 2) Best-effort: sync the C# registry too.
      try {
        await mcpCall(await openMcpSession(opts.mcpServerUrl), opts.mcpServerUrl,
          'clear_overlays', { scope: String(call.arguments.scope ?? 'all') });
      } catch { /* registry may be empty already; render layer is the truth users see */ }
      return JSON.stringify({ ok: true, cleared: 'all', note: 'Canvas wiped on the user\'s screen.' });
    }

    if (call.name === 'set_screen_updates') {
      const raw = Number(call.arguments.cadenceMs);
      if (!Number.isFinite(raw)) {
        return JSON.stringify({ error: 'invalid_cadence', message: 'cadenceMs must be an integer.' });
      }
      if (!mirrorControl.send) {
        return JSON.stringify({ error: 'no_browser_channel', message: 'No desktop page is connected via WebSocket yet.' });
      }
      if (raw === -1) {
        mirrorControl.send({ cadenceMs: 'off' });
        return JSON.stringify({ ok: true, mode: 'off', note: 'Mirroring disabled. Re-enable with a positive cadenceMs before needing sight again.' });
      }
      if (raw === 0) {
        mirrorControl.send({ cadenceMs: 'input' });
        return JSON.stringify({ ok: true, mode: 'input', note: 'View refreshes on user input only (clicks, scrolls, keys).' });
      }
      const clamped = Math.min(1_800_000, Math.max(500, Math.round(raw)));
      mirrorControl.send({ cadenceMs: clamped });
      return JSON.stringify({
        ok: true,
        mode: 'interval',
        cadenceMs: clamped,
        appliedClamp: clamped !== raw,
        note:
          `Your view now refreshes every ${clamped} ms. Use see_screen for the latest frame. Relax it with a larger value (e.g. 30000) once finished.`,
      });
    }

    if (call.name === 'preview_overlay') {
      const x = Number(call.arguments.x ?? 0), y = Number(call.arguments.y ?? 0);
      const w = Number(call.arguments.width ?? 100), h = Number(call.arguments.height ?? 100);
      const color = String(call.arguments.color ?? '#ffff00').toLowerCase();
      (opts.gate ??= {});
      const prev = await this.composePreview({ x, y, width: w, height: h, color });
      if (!prev) {
        return JSON.stringify({
          error: 'no_preview_available',
          message: 'Ghost previews need an open desktop page with mirroring. Proceed with see_screen-based estimates, or ask the user to open the demo desktop.',
        });
      }
      const token = randomUUID();
      (opts.gate ??= {}).pendingPreview = { token, template: 'rectangle', color, bounds: { x, y, width: w, height: h }, createdAt: Date.now() };
      opts.gate.awaitingCommitSig = undefined;
      opts.gate.vision = [{
        type: 'image_url',
        image_url: { url: prev.dataUrl },
        note:
          `Ghost preview of the candidate at ${JSON.stringify({ x, y, width: w, height: h })}. ` +
          'Judge placement against your intended target; adjust and re-run preview_overlay, or draw/template to commit.',
      }];
      return JSON.stringify({
        previewed: true,
        token,
        spec: { x, y, width: w, height: h },
        note: 'Nothing is on the user screen yet. The attached image ghost-renders your candidate.',
      });
    }

    if (call.name === 'set_my_preferences') {
      // Phase 3: user-owned assistant settings (GUI mirrors these).
      // SECURITY: the model may ENABLE grounding but never disable it, and may
      // only TIGHTEN marking limits — a gated/strained model unsetting its own
      // guardrails defeats both features. Loosening is user-only (GUI / PUT).
      // Opacity caps (Phase 5): the AI may change them BOTH directions, but
      // every change lands as a pending approval the user confirms in the
      // panel — GUI and chat can configure the same settings, chat changes
      // just carry an explicit consent step.
      if (!opts.userId) return JSON.stringify({ error: 'no_user_context' });
      const key = `assistant.chat.user.${opts.userId}`;
      if (Object.keys(call.arguments).length === 0) {
        const limits = await readMarkingLimits(this.store, opts.userId);
        const caps = await readOpacityLimits(this.store, opts.userId);
        const cur = (await this.store.getConfig(key)) as Record<string, unknown> | null;
        const value = ((cur && typeof cur === 'object' ? (cur.value ?? cur) : {}) ?? {}) as Record<string, unknown>;
        const pending = await readPendingPrefs(this.store, opts.userId);
        return JSON.stringify({
          enforcePreview: value.enforcePreview === true,
          contextBudgetChars: await readContextBudget(this.store, opts.userId),
          ...limits,
          ...caps,
          ...(Object.keys(pending).length > 0 ? { pending_approval: pending } : {}),
          note: 'maxTextMarkings/maxNonTextMarkings: you can only LOWER these. maxSingularOpacity/maxOverallOpacity and contextBudgetChars: you may change in either direction but the user must approve each change.',
        });
      }
      // Opacity caps + context budget: AI-requestable in both directions,
      // pending approval.
      const opKeys = ['maxSingularOpacity', 'maxOverallOpacity'] as const;
      const opUpdates: Partial<OpacityLimits> = {};
      for (const field of opKeys) {
        if (call.arguments[field] === undefined) continue;
        const n = Number(call.arguments[field]);
        if (!Number.isFinite(n) || n < OPACITY_MIN || n > OPACITY_MAX) {
          return JSON.stringify({ error: 'invalid_args', message: `${field} must be a number between ${OPACITY_MIN} and ${OPACITY_MAX}.` });
        }
        opUpdates[field] = Math.round(n * 1000) / 1000;
      }
      // Phase 6: conversation context budget (chars before compaction).
      let budgetUpdate: number | null = null;
      if (call.arguments.contextBudgetChars !== undefined) {
        const n = Math.round(Number(call.arguments.contextBudgetChars));
        if (!Number.isFinite(n) || n < CONTEXT_BUDGET_MIN || n > CONTEXT_BUDGET_MAX) {
          return JSON.stringify({ error: 'invalid_args', message: `contextBudgetChars must be an integer between ${CONTEXT_BUDGET_MIN} and ${CONTEXT_BUDGET_MAX}.` });
        }
        budgetUpdate = n;
      }
      if (Object.keys(opUpdates).length > 0 || budgetUpdate !== null) {
        const current = await readOpacityLimits(this.store, opts.userId);
        const next = { ...current, ...opUpdates };
        // Invariant: singular <= overall, checked against the MERGED set.
        if (next.maxSingularOpacity > next.maxOverallOpacity) {
          return JSON.stringify({
            error: 'invalid_args',
            message: `maxSingularOpacity must be <= maxOverallOpacity. Current: singular ${current.maxSingularOpacity}, overall ${current.maxOverallOpacity}. Adjust both together if needed.`,
          });
        }
        // Normalize BOTH config shapes ({value:{...}} row or flat record) — a
        // flat-record store would otherwise resolve to {} and wipe sibling prefs.
        const curRow = (await this.store.getConfig(key)) as Record<string, unknown> | null;
        const existing = ((curRow && typeof curRow === 'object' ? (curRow.value ?? curRow) : {}) ?? {}) as Record<string, unknown>;
        const requested: Record<string, unknown> = { ...opUpdates };
        if (budgetUpdate !== null) requested.contextBudgetChars = budgetUpdate;
        await this.store.setConfig(key, { ...existing, pendingPrefs: { ...(existing.pendingPrefs as Record<string, unknown> ?? {}), ...requested } }, 'assistant', opts.userId);
        const human = Object.entries(requested).map(([k, v]) => k === 'contextBudgetChars' ? `context budget = ${Number(v).toLocaleString()} chars` : `${k} = ${Math.round((v as number) * 100)}%`).join(', ');
        return JSON.stringify({
          pending_approval: true,
          requested,
          message: `Requested user approval to set ${human}. The user will see an approval prompt; do NOT re-send the request and do not claim it is active until approved.`,
        });
      }
      // Marking-limit keys first (tighten-only).
      const limitUpdates: Partial<MarkingLimits> = {};
      for (const field of ['maxTextMarkings', 'maxNonTextMarkings'] as const) {
        if (call.arguments[field] === undefined) continue;
        const n = Math.round(Number(call.arguments[field]));
        if (!Number.isFinite(n) || n < MARKING_LIMIT_MIN || n > MARKING_LIMIT_MAX) {
          return JSON.stringify({
            error: 'invalid_args',
            message: `${field} must be an integer between ${MARKING_LIMIT_MIN} and ${MARKING_LIMIT_MAX}.`,
          });
        }
        limitUpdates[field] = n;
      }
      if (Object.keys(limitUpdates).length > 0) {
        const cur = ((await this.store.getConfig(key)) as Record<string, unknown> | null)?.value as Record<string, unknown> | undefined ?? {};
        const current = await readMarkingLimits(this.store, opts.userId);
        for (const [field, next] of Object.entries(limitUpdates) as Array<[keyof MarkingLimits, number]>) {
          if (next > current[field]) {
            return JSON.stringify({
              error: 'user_controlled_setting',
              message:
                `${field} can only be lowered by you (tighten-only). Raising it is a user Settings change. ` +
                `Current ${field}: ${current[field]}. If the task needs more markings, remove existing ones with remove_overlay first, or tell the user to raise the limit in Settings.`,
            });
          }
        }
        await this.store.setConfig(key, { ...cur, ...limitUpdates }, 'assistant', opts.userId);
        const saved = await readMarkingLimits(this.store, opts.userId);
        return JSON.stringify({
          ok: true, ...saved,
          note: 'Saved. These caps apply immediately to every draw you make.',
        });
      }
      const enforce = call.arguments.enforcePreview;
      if (typeof enforce !== 'boolean') {
        return JSON.stringify({ error: 'invalid_args', message: 'Supported keys: enforcePreview (boolean), maxTextMarkings, maxNonTextMarkings (integers 0..8).' });
      }
      if (enforce === false) {
        return JSON.stringify({
          error: 'user_controlled_setting',
          message:
            'The user controls this setting; it cannot be disabled by you. If grounding blocks the task, work WITH it: call the tool again to commit after inspecting the ghost preview, or tell the user they can turn off "Preview before placing markings" in Settings.',
        });
      }
      const cur = ((await this.store.getConfig(key)) as Record<string, unknown> | null)?.value as Record<string, unknown> | undefined ?? {};
      await this.store.setConfig(key, { ...cur, enforcePreview: true }, 'assistant', opts.userId);
      return JSON.stringify({
        ok: true,
        enforcePreview: true,
        note: 'Saved: every marking will be previewed to you first for approval.',
      });
    }

    if (call.name === 'set_screen_updates') {
      const raw = Number(call.arguments.cadenceMs);
      if (!Number.isFinite(raw)) {
        return JSON.stringify({ error: 'invalid_cadence', message: 'cadenceMs must be an integer.' });
      }
      if (!mirrorControl.send) {
        return JSON.stringify({ error: 'no_browser_channel', message: 'No desktop page is connected via WebSocket yet.' });
      }
      if (raw === -1) {
        mirrorControl.send({ cadenceMs: 'off' });
        return JSON.stringify({ ok: true, mode: 'off', note: 'Mirroring disabled. Re-enable with a positive cadenceMs before needing sight again.' });
      }
      if (raw === 0) {
        mirrorControl.send({ cadenceMs: 'input' });
        return JSON.stringify({ ok: true, mode: 'input', note: 'View refreshes on user input only (clicks, scrolls, keys).' });
      }
      const clamped = Math.min(1_800_000, Math.max(500, Math.round(raw)));
      mirrorControl.send({ cadenceMs: clamped });
      return JSON.stringify({
        ok: true,
        mode: 'interval',
        cadenceMs: clamped,
        appliedClamp: clamped !== raw,
        note:
          `Your view now refreshes every ${clamped} ms. Use see_screen for the latest frame. Relax it with a larger value (e.g. 30000) once finished.`,
      });
    }

    if (call.name === 'preview_overlay') {
      const prev = currentPreview();
      if (!prev) {
        return JSON.stringify({
          error: 'no_preview_available',
          message: 'Ghost previews require an active desktop page with mirror enabled. Reuse see_screen placement logic instead.',
        });
      }
      const x = Number(call.arguments.x ?? 0), y = Number(call.arguments.y ?? 0);
      const w = Number(call.arguments.width ?? 100), h = Number(call.arguments.height ?? 100);
      (opts.gate ??= {}).vision = [
        { type: 'image_url', image_url: { url: prev.dataUrl }, previewSpec: { x, y, width: w, height: h } },
      ];
      return JSON.stringify({
        previewed: true,
        spec: { x, y, width: w, height: h },
        note:
          'The attached image shows the candidate rectangle ghosted over the last capture at exactly these logical coordinates. If it covers the wrong spot, adjust and re-run preview_overlay; only draw_overlay/template_overlay make it visible to the user.',
      });
    }

    const session = await openMcpSession(opts.mcpServerUrl);
    try {
      // ---- P0 display truth: rescale phantom-space coordinates -----------
      // Runs on call.arguments BEFORE mapping and BEFORE the preview gate, so
      // ghost geometry, commit signature, and the actual draw all speak the
      // same (true-display) space. A repeat commit re-rescales identically.
      if (call.name === 'draw_overlay' || call.name === 'template_overlay') {
        const rescaled = scaleIntoTrueDisplay(call.name, call.arguments);
        if (rescaled && opts.gate) opts.gate.rescaled = true;
        // ---- Phase 6: letterbox clamp ------------------------------------
        // Markings in the black bars are invisible junk (the green-circle-in-
        // the-margin failure). When the mirror reports the visible app area,
        // a draw mostly OUTSIDE it is refused in plain language so the model
        // re-aims instead of arguing. OCR MEDIUM: intersection test, not just
        // the center — a marking whose center grazes the bar edge but lies
        // mostly inside the app is legitimate.
        const contentBounds = latestContentBounds();
        if (contentBounds) {
          const spec0 = InteriorChat.normalizeSpec(call.name, call.arguments);
          if (spec0?.bounds) {
            const b = spec0.bounds;
            const ix = Math.max(0, Math.min(b.x + b.width, contentBounds.x + contentBounds.width) - Math.max(b.x, contentBounds.x));
            const iy = Math.max(0, Math.min(b.y + b.height, contentBounds.y + contentBounds.height) - Math.max(b.y, contentBounds.y));
            const visible = b.width > 0 && b.height > 0 ? (ix * iy) / (b.width * b.height) : 0;
            if (visible < 0.5) {
              return JSON.stringify({
                error: 'outside_visible_area',
                message:
                  `That marking lands ${visible === 0 ? 'ENTIRELY' : 'mostly'} on the black margin OUTSIDE the actual application window. ` +
                  `The visible screen area is x=${contentBounds.x}, y=${contentBounds.y}, width=${contentBounds.width}, height=${contentBounds.height}. ` +
                  `Re-aim the marking inside that area (use see_screen to find the real target).`,
              });
            }
          }
        }
        // ---- Phase 5 item 1: opacity policy --------------------------------
        // Clamp to the user's per-marking cap and keep every pairwise overlap
        // within the overall cap (1-(1-a)(1-b) rule). Explicit opacity args
        // are honored but clamped; absent ones get the policy-compliant value.
        const opLimits = await readOpacityLimits(this.store, opts.userId);
        const spec = InteriorChat.normalizeSpec(call.name, call.arguments);
        const bounds = spec?.bounds ?? null;
        if (bounds) {
          const overlapping = getBridgeOverlays().map((o) => ({
            opacity: Math.min(1, Math.max(0, Number(o.opacity ?? 0.5))),
            overlaps: (() => {
              const ox = Number(o.x ?? 0), oy = Number(o.y ?? 0);
              const ow = Number(o.width ?? 0), oh = Number(o.height ?? 0);
              return !(ox + ow <= bounds!.x || bounds!.x + bounds!.width <= ox
                || oy + oh <= bounds!.y || bounds!.y + bounds!.height <= oy) && Number(o.opacity ?? 0.5) > 0;
            })(),
          })).filter((e) => e.overlaps);
          const requested = call.name === 'draw_overlay'
            ? (Number(call.arguments.opacity) || undefined)
            : (() => { try { const tp = typeof call.arguments.templateParams === 'string' ? JSON.parse(call.arguments.templateParams) : call.arguments.templateParams; return tp && typeof tp.opacity === 'number' ? tp.opacity : undefined; } catch { return undefined; } })();
          const template = call.name === 'template_overlay' ? String(call.arguments.template ?? '').toLowerCase() : 'rectangle';
          const dflt = (template === 'highlight' || template === 'arrow') ? 0.8 : 0.5;
          const decision = resolveAllowedOpacity(requested, dflt, opLimits, overlapping);
          if ('refused' in decision) {
            return JSON.stringify({ error: 'marking_opacity', message: decision.refused });
          }
          if (call.name === 'draw_overlay') {
            call.arguments.opacity = decision.opacity;
          } else {
            let tp: Record<string, unknown> = {};
            try {
              tp = typeof call.arguments.templateParams === 'string'
                ? JSON.parse(call.arguments.templateParams)
                : (call.arguments.templateParams && typeof call.arguments.templateParams === 'object' ? { ...(call.arguments.templateParams as Record<string, unknown>) } : {});
            } catch { /* keep {} */ }
            tp.opacity = decision.opacity;
            call.arguments.templateParams = JSON.stringify(tp);
          }
        }
      }
      const args = MCP_TOOL_ARG_MAP[call.name] ? MCP_TOOL_ARG_MAP[call.name](call.arguments) : call.arguments;

      // ---- Phase 3.5 A3: system-side draw setup (mode + display owner) ----
      if (call.name === 'draw_overlay' || call.name === 'template_overlay') {
        await this.ensureDrawReady(opts.mcpServerUrl);
      }

      // ---- Phase 3 gate: see-before-show --------------------------------
      if (opts.enforcePreview && (call.name === 'draw_overlay' || call.name === 'template_overlay')) {
        const spec = InteriorChat.normalizeSpec(call.name, call.arguments);
        if (!spec) {
          // Fail-closed: unparseable geometry must not bypass grounding.
          return JSON.stringify({
            error: 'preview_unparseable',
            message:
              'Grounding is enabled but the marking geometry could not be determined (missing x/y/width/height or radius). ' +
              'Re-state the marking with explicit coordinates; a preview will be shown before anything is placed.',
          });
        }
        {
          const gate = (opts.gate ??= {});
          const pending = gate.pendingPreview;
          const fresh = pending && Date.now() - pending.createdAt < 45_000;
          const matches = fresh
            && InteriorChat.specMatches(spec, { template: pending!.template, color: pending!.color, bounds: pending!.bounds });
          if (matches) {
            gate.pendingPreview = undefined; // consume token
            gate.awaitingCommitSig = undefined;
          } else {
            const preview = await this.composePreview({ ...spec.bounds, color: spec.color });
            if (!preview) {
              return JSON.stringify({
                error: 'preview_unavailable',
                message:
                  'Grounding is enabled for this user, but no desktop page is connected to compose the preview. Ask the user to open the demo desktop (or disable the grounding preference). Nothing was placed on screen.',
              });
            }
            const token = randomUUID();
            gate.pendingPreview = { token, ...spec, createdAt: Date.now() };
            gate.awaitingCommitSig = `${call.name}:${JSON.stringify(call.arguments)}`;
            opts.gate.vision = [{
              type: 'image_url',
              image_url: { url: preview.dataUrl },
              note:
                `Ghost preview of your candidate at ${JSON.stringify(spec.bounds)} (${spec.template}, ${spec.color}). ` +
                `Judge it against the target you intended to mark. ` +
                `If it is correctly placed, repeat your ${call.name} call EXACTLY to commit it for the user. ` +
                `If it is off-target, adjust the coordinates and preview again. Token: ${token}.`,
            }];
            return JSON.stringify({
              status: 'preview_pending',
              blocked: true,
              token,
              message:
                'NOTHING has been placed on the user screen. The image you received is a GHOST PREVIEW only. ' +
                'Do NOT tell the user the marking exists or is done. ' +
                'Inspect the ghost: if it covers the intended target, repeat your ' + call.name + ' call with identical arguments to commit it. ' +
                'If it is off-target, change the coordinates and call again for a new preview.',
            });
          }
        }
      }

      // ---- Phase 3.5 B2: per-user marking limits (independent guardrail,
      // enforced even with the preview gate off). Scope: TOTAL markings on
      // screen, all actors — clutter is what the user sees. Refuse, never
      // auto-remove: the model must name what goes. Previews never reach here
      // (they place nothing); commits land only after the gate above passes.
      if (call.name === 'draw_overlay' || call.name === 'template_overlay') {
        const isText = call.name === 'template_overlay'
          && String(call.arguments.template ?? '').toLowerCase() === 'text';
        const limits = await readMarkingLimits(this.store, opts.userId);
        const limit = isText ? limits.maxTextMarkings : limits.maxNonTextMarkings;
        const stats = await this.fetchMcpOverlayStats(opts.mcpServerUrl);
        if (stats) {
          let current = isText ? stats.text : stats.non_text;
          // Stepwise mode: the previous step marking is auto-removed right
          // after this commit — it must not occupy a limit slot (else the
          // last allowed step could never be placed). Phase 6: the exemption
          // only applies when the tracked step marking is the SAME category
          // as this commit — removing a text label frees no non-text slot,
          // and freeing a slot the removal won't free lets the cap be
          // silently exceeded (the "markings didn't stick" failure).
          const stepPointerMatches = opts.gate?.stepMode && opts.gate?.stepMarkingId
            && (opts.gate.stepMarkingIsText === isText);
          if (stepPointerMatches) {
            if (current > 0) current = Math.max(0, current - 1);
          }
          if (current >= limit) {
            const removable = (isText ? stats.text_ids : stats.non_text_ids).slice(0, 10);
            return JSON.stringify({
              error: 'marking_limit',
              type: isText ? 'text' : 'non_text',
              limit,
              current,
              removable_ids: removable,
              message:
                `The user allows at most ${limit} ${isText ? 'text' : 'non-text'} marking${limit === 1 ? '' : 's'} on screen and there ${current === 1 ? 'is 1' : `are ${current}`} already. ` +
                'Your task is NOT complete: first call remove_overlay with one of removable_ids (prefer one you created), then repeat this exact draw call. ' +
                'Only after the replacement is placed, report to the user. Do not ask permission; do not report a limit error to them.',
            });
          }
        }
        // Stats unavailable (MCP down): fail open with a note rather than
        // bricking all drawing — limits are clutter control, not a safety gate.
      }

      const result = await mcpCall(session, opts.mcpServerUrl, call.name, args);

      // Post-commit verification (gate on): attach a fresh capture so the
      // model sees the committed marker as the user now sees it.
      if (opts.enforcePreview && (call.name === 'draw_overlay' || call.name === 'template_overlay')) {
        const rawRes = typeof result === 'string' ? result : JSON.stringify(result);
        let overlayId = '';
        try {
          const inner = JSON.parse(rawRes);
          const payload = typeof inner.content?.[0]?.text === 'string' ? JSON.parse(inner.content[0].text) : inner;
          overlayId = String(payload.overlay_id ?? '');
        } catch { /* best effort */ }
        if (mirrorControl.send) {
          mirrorControl.send({ triggerNow: true });
          await new Promise((r) => setTimeout(r, 900));
          const f = latestFrame();
          if (f) {
            (opts.gate ??= {}).vision = [{
              type: 'image_url',
              image_url: { url: f.dataUrl },
              note:
                `Post-commit verification capture. Your ${call.name} marker${overlayId ? ` (id ${overlayId})` : ''} is now visible to the user. ` +
                'Check it covers the intended target; if misplaced, remove_overlay the id and adjust.',
            }];
          }
        }
      }

      // Phase 5 item 2: stepwise cleanup — after a SUCCESSFUL commit, remove
      // the previous step's marking so exactly one tutorial marker remains.
      // Best-effort: a failed removal must never fail the new marking.
      if ((call.name === 'draw_overlay' || call.name === 'template_overlay')
        && (opts.gate?.stepMode)) {
        const rawRes = typeof result === 'string' ? result : JSON.stringify(result);
        try {
          const inner = JSON.parse(rawRes);
          const payload = typeof inner.content?.[0]?.text === 'string' ? JSON.parse(inner.content[0].text) : inner;
          const newId = String(payload.overlay_id ?? '');
          if (newId) {
            const previousId = opts.gate?.stepMarkingId;
            if (previousId && previousId !== newId) {
              try {
                await mcpCall(session, opts.mcpServerUrl, 'remove_overlay', { overlayId: previousId });
              } catch { /* previous may be gone already */ }
            }
            (opts.gate ??= {}).stepMarkingId = newId;
            // Phase 6: remember the category so the limit exemption stays
            // honest (only a same-category removal frees a same-category slot).
            (opts.gate ??= {}).stepMarkingIsText = call.name === 'template_overlay'
              && String(call.arguments.template ?? '').toLowerCase() === 'text';
          }
        } catch { /* unparseable result — leave step state alone */ }
      }

      return JSON.stringify(result);
    } finally {
      if (session.sessionId) {
        await fetch(`${opts.mcpServerUrl}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': session.sessionId },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: session.nextId } }),
        }).catch(() => undefined);
      }
    }
  }

  private async getConfigLocal(_opts: ChatSessionOptions, args: Record<string, unknown>): Promise<string> {
    const category = String(args.category ?? '');
    const key = String(args.key ?? '');
    if (!category || !key) return JSON.stringify({ error: 'category and key are required.' });
    const value = await this.store.getConfig(`${category}.${key}`);
    return JSON.stringify({ category, key, value: redactSecretsLocal(key, value) });
  }

  private async setConfigLocal(opts: ChatSessionOptions, args: Record<string, unknown>): Promise<string> {
    const category = String(args.category ?? '');
    const key = String(args.key ?? '');
    const value = args.value;
    if (!category || !key || typeof value !== 'object') return JSON.stringify({ error: 'category, key, and object value are required.' });
    await this.store.setConfig(`${category}.${key}`, value as Record<string, unknown>, category);
    return JSON.stringify({ success: true, category, key, updated: true, by: opts.userRole });
  }

  /**
   * switch_ai_model: resolve the requested slug against the admin-approved
   * registry (tolerating OpenRouter variant suffixes) and persist it for this
   * user. Permission model: any signed-in user may switch among APPROVED
   * combos; unapproved slugs get an actionable explanation instead of a bare
   * rejection so lower-quality models can recover and explain.
   */
  private async switchModelLocal(_opts: ChatSessionOptions, args: Record<string, unknown>): Promise<string> {
    const slug = String(args.slug ?? '').trim();
    if (!slug) {
      return JSON.stringify({
        error: 'missing_slug',
        message: "Tell me which model as a slug, e.g. 'qwen/qwen3.5-35b-a3b:nitro'.",
      });
    }
    const cfg = (await this.store.getConfig('provider.approved')) as { models?: ApprovedModel[] } | null;
    const registry = Array.isArray(cfg?.models) && cfg!.models!.length > 0
      ? cfg!.models!
      : DEFAULT_APPROVED_MODELS;
    const match = findApprovedModel(registry, slug);
    if (!match) {
      return JSON.stringify({
        error: 'not_approved',
        requested: slug,
        allowed: registry.map((m) => ({ id: m.id, label: m.label ?? m.model, model: m.model })),
        message:
          'That model is not in the approved list yet. You can pick any listed option now; ' +
          'to use the requested model, ask an administrator to approve it.',
      });
    }

    // Persist per-user selection; applies from the NEXT chat message because
    // the current turn's stream is already running on the previous model.
    const previous = _opts.providerModel;
    if (_opts.userId) {
      await this.store.setConfig(userSelectionKey(_opts.userId), { modelId: match.id }, 'provider');
    } else {
      // No identity bound to the session: apply without persistence.
      return JSON.stringify({ ok: true, switched: false, reason: 'no_user_context', active_model: previous });
    }

    return JSON.stringify({
      ok: true,
      switched: true,
      id: match.id,
      label: match.label ?? match.model,
      model: match.model,
      effective_from: 'next message',
      note: match.model.includes(':nitro') ? 'nitro variant selected — fastest available providers.' : undefined,
      previous,
    });
  }
}

function redactSecretsLocal(key: string, value: unknown): unknown {
  if (/api[_-]?key|secret|password|token/i.test(key)) return '<redacted>';
  return value;
}

export const createChat = (store: LibSqlStore): InteriorChat => new InteriorChat(store);
