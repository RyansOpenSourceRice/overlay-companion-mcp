import type { LibSqlStore } from './libsql-store.js';
import { latestFrame, currentPreview, mirrorControl, overlayControl, waitForPreview } from './screen-mirror.js';
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
    vision?: Array<Record<string, unknown>>;
  };
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
    // Served locally: user-owned preferences (mirrors the Settings GUI).
    name: 'set_my_preferences',
    description:
      "Read or change the user's assistant preferences. Call with NO arguments to read all settings. " +
      "enforcePreview (boolean): every screen marking is ghost-previewed to you for approval before the user sees it; you may enable it, never disable it. " +
      "maxTextMarkings / maxNonTextMarkings (integers 0..8): cap how many text / non-text markings may be on screen at once. " +
      "Only change these when the user explicitly asks (e.g. 'only 1 circle at a time'); you can tighten but never loosen them.",
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

async function mcpCall(session: McpSession, mcpServerUrl: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const id = session.nextId++;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId;
  const res = await fetch(`${mcpServerUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error(`MCP tools/call ${name} failed: ${res.status}`);
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
      if (!opts.userId) return JSON.stringify({ error: 'no_user_context' });
      const key = `assistant.chat.user.${opts.userId}`;
      if (Object.keys(call.arguments).length === 0) {
        const limits = await readMarkingLimits(this.store, opts.userId);
        const cur = (await this.store.getConfig(key)) as Record<string, unknown> | null;
        const value = ((cur && typeof cur === 'object' ? (cur.value ?? cur) : {}) ?? {}) as Record<string, unknown>;
        return JSON.stringify({
          enforcePreview: value.enforcePreview === true,
          ...limits,
          note: 'maxTextMarkings/maxNonTextMarkings cap how many markings may be on screen at once. You can only lower them; raising them is a user-only Settings change.',
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
          const current = isText ? stats.text : stats.non_text;
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
