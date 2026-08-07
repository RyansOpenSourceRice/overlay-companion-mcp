import type { SurrealDbStore } from './surreal-store.js';
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
}

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
    name: 'set_display_actor',
    description: 'Switch which agent owns the display for drawing overlays: interior (this assistant) or exterior (external MCP agent).',
    parameters: { type: 'object', properties: { actor: { type: 'string', enum: ['interior', 'exterior'] } }, required: ['actor'] },
  },
  {
    name: 'get_overlay_capabilities',
    description: 'List overlay engine capabilities and template catalog.',
    parameters: { type: 'object', properties: {} },
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
  private store: SurrealDbStore;

  constructor(store: SurrealDbStore) {
    this.store = store;
  }

  private async opts(): Promise<ChatSessionOptions> {
    const provider = (await this.store.getConfig('provider.chat')) as Record<string, unknown> | null;
    return {
      mcpServerUrl: process.env.MCP_SERVER_URL || 'http://localhost:3001',
      providerBaseUrl: (provider?.baseUrl as string) || 'https://openrouter.ai/api/v1',
      providerApiKey: (provider?.apiKey as string) || process.env.PROVIDER_API_KEY || '',
      providerModel: (provider?.model as string) || 'deepseek/deepseek-chat-v3-0324',
      userRole: 'user',
    };
  }

  /**
   * Stream a chat completion from OpenRouter. Executes bounded tool calls
   * against the C# MCP server and returns the final assistant text.
   * `messages` uses the OpenAI chat shape; the model may request tools.
   */
  async *stream(opts: ChatSessionOptions, messages: Array<Record<string, unknown>>): AsyncGenerator<string> {
    if (!opts.providerApiKey) {
      yield 'The chat provider is not configured. Ask an admin to set the provider API key in Settings.';
      return;
    }
    const body: Record<string, unknown> = {
      model: opts.providerModel,
      messages,
      stream: true,
      tools: TOOL_ALLOWLIST.map((t) => ({ type: 'function', function: t })),
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
              if (choice?.delta?.content) yield choice.delta.content;
              if (choice?.delta?.tool_calls) {
                for (const tc of choice.delta.tool_calls) {
                  const existing = toolCalls.find((t) => t.id === tc.id);
                  if (existing) {
                    if (tc.function?.arguments) existing.arguments = { ...existing.arguments, ...parsePartialArgs(existing.arguments, tc.function.arguments) };
                  } else if (tc.function) {
                    toolCalls.push({ id: tc.id ?? randomUUID(), name: tc.function.name ?? '', arguments: parsePartialArgs({}, tc.function.arguments ?? '') });
                  }
                }
              }
              if (choice?.finish_reason) {
                // Tool calls are gathered on finish; executed by the caller loop.
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
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Execute a single allowlisted tool via the C# MCP server (the same tools an
   * external client uses). Config tools are admin-only and served here.
   */
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

    const session = await openMcpSession(opts.mcpServerUrl);
    try {
      const args = MCP_TOOL_ARG_MAP[call.name] ? MCP_TOOL_ARG_MAP[call.name](call.arguments) : call.arguments;
      const result = await mcpCall(session, opts.mcpServerUrl, call.name, args);
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
}

function redactSecretsLocal(key: string, value: unknown): unknown {
  if (/api[_-]?key|secret|password|token/i.test(key)) return '<redacted>';
  return value;
}

function parsePartialArgs(accum: Record<string, unknown>, raw: string): Record<string, unknown> {
  try {
    return { ...accum, ...JSON.parse(raw) };
  } catch {
    return accum;
  }
}

export const createChat = (store: SurrealDbStore): InteriorChat => new InteriorChat(store);
