/**
 * In-app chat assistant (Phase B1/B2/B3).
 *
 * A SECOND client to the same C# MCP tools. Streams the assistant from
 * POST /api/chat (SSE). Includes the display-ownership toggle (interior vs
 * exterior) and surfaces which tools the assistant may use. Config-via-chat is
 * handled server-side for admin users (B3).
 */

import { renderMarkdown } from '../markdown';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class ChatPanel {
  private container: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLInputElement | HTMLTextAreaElement;
  private history: ChatMessage[] = [];
  private activeActor: string = 'exterior';
  private open = false;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recording = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('chat-panel');
    if (localStorage.getItem('oc.chatSide') === 'left') this.container.classList.add('chat-panel--left');
    // Dynamic awareness: refresh display owner + tool state periodically so
    // the header never shows stale ownership info.
    setInterval(() => { void this.loadTools(); }, 5000);
    this.container.innerHTML = `
      <div class="chat-resize" title="Drag to resize"></div>
        <div class="chat-header">
        <span class="chat-title">In-app assistant</span>
        <div class="chat-header-right">
          <select id="chat-model" class="chat-model-select" title="AI model (choices approved by your admin)" aria-label="AI model"></select>
          <button id="chat-side-toggle" class="chat-side-btn" title="Move assistant panel left/right" aria-label="Toggle assistant side">&#8646;</button>
          <span class="chat-actor-badge" id="chat-actor-badge">owner: exterior</span>
          <button class="chat-close-btn" id="chat-close" aria-label="Close assistant" title="Close assistant">&times;</button>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <button id="chat-mic" class="btn btn-secondary" title="Voice input (Phase C)" aria-label="Record voice input">🎤</button>
        <textarea id="chat-input" rows="1" placeholder="Ask the assistant to annotate the screen…" aria-label="Chat with the in-app assistant"></textarea>
        <button id="chat-send" class="btn btn-primary">Send</button>
      </div>
    `;
    this.messagesEl = this.container.querySelector('#chat-messages')!;
    this.inputEl = this.container.querySelector('#chat-input') as unknown as HTMLInputElement;
    const sendBtn = this.container.querySelector('#chat-send')!;
    const micBtn = this.container.querySelector('#chat-mic')!;
    const closeBtn = this.container.querySelector('#chat-close')!;

    sendBtn.addEventListener('click', () => void this.send());
    micBtn.addEventListener('click', () => void this.toggleMic());
    closeBtn.addEventListener('click', () => this.close());
    const sideBtn = this.container.querySelector('#chat-side-toggle');
    sideBtn?.addEventListener('click', () => {
      const left = this.container.classList.toggle('chat-panel--left');
      localStorage.setItem('oc.chatSide', left ? 'left' : 'right');
      document.body.classList.toggle('chat-left', left);
    });
    this.inputEl.addEventListener('keydown', ((e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (e.shiftKey || e.isComposing) return; // newline / IME composition
      e.preventDefault();
      void this.send();
    }) as EventListener);

    // Docked-panel resizing (R7): clamp 300-720px, persist preference.
    const handle = this.container.querySelector('.chat-resize');
    if (handle) {
      let startX = 0, startW = 0;
      const applyW = (px: number) => {
        document.documentElement.style.setProperty('--chat-w', `${Math.min(720, Math.max(300, px))}px`);
      };
      handle.addEventListener('pointerdown', ((ev: PointerEvent) => {
        startX = ev.clientX;
        startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chat-w') || '380', 10) || 380;
        const move = (e: PointerEvent): void => {
          // Squeezing outward from either dock side widens the panel.
          const delta = this.container.classList.contains('chat-panel--left')
            ? -(e.clientX - startX)
            : (startX - e.clientX);
          applyW(startW + delta);
        };
        const up = (): void => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          localStorage.setItem('oc.chatWidth', getComputedStyle(document.documentElement).getPropertyValue('--chat-w'));
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }) as EventListener);
      const savedW = localStorage.getItem('oc.chatWidth');
      if (savedW) document.documentElement.style.setProperty('--chat-w', savedW.trim());
    }

    this.inputEl.addEventListener('input', () => this.autosizeInput());
    this.autosizeInput();
    void this.loadTools();
    void this.loadModels();
  }

  private async loadModels(): Promise<void> {
    const select = this.container.querySelector('#chat-model') as HTMLSelectElement | null;
    if (!select) return;
    try {
      const res = await fetch('/api/chat/models', { credentials: 'include' });
      if (!res.ok) { select.style.display = 'none'; return; }
      const data = (await res.json()) as {
        active: string;
        default: { label: string; model: string };
        models: Array<{ id: string; label?: string; model: string }>;
      };
      // With only the admin default there is nothing to choose; hide it and
      // keep the header uncluttered.
      if (!data.models?.length) { select.style.display = 'none'; return; }
      select.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = data.default.label ?? 'Default';
      select.appendChild(def);
      for (const m of data.models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label || m.model;
        select.appendChild(opt);
      }
      if (data.active && data.active !== 'default') select.value = data.active;
      // Persist the choice server-side so it survives panel reopenings
      // (per-user storage under /api/chat/models/select).
      select.addEventListener('change', () => {
        void fetch('/api/chat/models/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ modelId: select.value || undefined }),
        }).catch(() => undefined);
      });
    } catch {
      /* server unreachable; leave hidden */
    }
  }

  /** Goal 7 — invisible system: one shimmering "working" indicator replaces
   *  per-tool impact rows and payload details. Tool calls themselves are never
   *  named or counted anywhere the user can see. */
  private static WORKING_PILL: HTMLElement | null = null;

  private showWorking(): void {
    let pill = ChatPanel.WORKING_PILL;
    if (!pill || !pill.isConnected) {
      pill = document.createElement('div');
      pill.className = 'chat-working';
      this.messagesEl.appendChild(pill);
      ChatPanel.WORKING_PILL = pill;
    }
    pill.style.display = '';
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private hideWorking(): void {
    if (ChatPanel.WORKING_PILL) ChatPanel.WORKING_PILL.style.display = 'none';
  }

  /**
   * Phase 5 item 6: context meter — mirrors the server's compaction budget
   * (COMPACTION_BUDGET_CHARS in /api/chat). Past ~100% the server compacts
   * older turns automatically; the meter makes that visible instead of magic.
   */
  // Mirrors COMPACTION_BUDGET_CHARS in infra/server/src/server.ts. Counting
  // formula differs slightly (server also counts tool_calls JSON) — near enough
  // for a visibility meter.
  private static CONTEXT_BUDGET = 24_000;

  private updateContextMeter(): void {
    let meter = this.container.querySelector('.chat-context-meter') as HTMLElement | null;
    if (!meter) {
      meter = document.createElement('div');
      meter.className = 'chat-context-meter';
      this.messagesEl.appendChild(meter);
    }
    const chars = this.history.reduce((n, m) => n + String(m.content ?? '').length, 0);
    const pct = Math.min(100, Math.round((chars / ChatPanel.CONTEXT_BUDGET) * 100));
    meter.textContent = `context ~${pct}% (older turns auto-compacted)`;
    meter.style.color = pct > 80 ? '#b45309' : 'var(--text-dim, #666)';
  }

  /**
   * Phase 5: inline Approve/Deny chip for an AI-requested preference change.
   * Approves via the same endpoint as the Settings GUI — one consent path.
   */
  private renderTaskPlan(steps: Array<{ index: number; text: string; status: string }>, mode: string): void {
    const marks: Record<string, string> = { done: '☑', in_progress: '▶', pending: '☐', skipped: '⊘', blocked: '⚠' };
    let host = this.messagesEl.querySelector('.chat-plan') as HTMLElement | null;
    if (!host) {
      host = document.createElement('div');
      host.className = 'chat-plan';
      this.messagesEl.prepend(host);
    }
    host.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'chat-plan-title';
    title.textContent = 'Checklist';
    host.appendChild(title);
    const ol = document.createElement('ol');
    for (const s of steps) {
      const li = document.createElement('li');
      li.className = `chat-plan-step chat-plan-step--${s.status}`;
      li.textContent = `${marks[s.status] ?? '☐'} ${s.text}`;
      ol.appendChild(li);
    }
    host.appendChild(ol);
    if (mode === 'plan') {
      const go = document.createElement('button');
      go.className = 'chat-plan-go';
      go.textContent = 'Go';
      go.onclick = () => {
        this.inputEl.value = 'Go — proceed with the checklist.';
        void this.send();
        go.remove();
      };
      host.appendChild(go);
    } else {
      const remaining = steps.filter((s) => s.status === 'pending' || s.status === 'in_progress').length;
      if (remaining === 0) {
        const done = document.createElement('span');
        done.className = 'chat-plan-done';
        done.textContent = 'All steps complete';
        host.appendChild(done);
      }
    }
}

  /** Phase 5: inline Approve/Deny chip for an AI-requested preference change.
   *  Approves via the same endpoint as the Settings GUI — one consent path. */
  private requestPrefApproval(requested: Record<string, unknown>): void {
    const human = Object.entries(requested)
      .map(([k, v]) => `${k.replace('maxSingularOpacity', 'single-marking opacity').replace('maxOverallOpacity', 'combined opacity')} = ${Math.round(Number(v) * 100)}%`)
      .join(', ');
    const chip = document.createElement('div');
    chip.className = 'chat-pref-approval';
    chip.appendChild(Object.assign(document.createElement('span'), {
      textContent: `The assistant wants to change ${human}.`,
    }));
    const approve = document.createElement('button');
    approve.textContent = 'Approve';
    approve.className = 'chat-pref-approval-btn';
    approve.onclick = async () => {
      const r = await fetch('/api/me/preferences/approve', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ approve: true }),
      });
      chip.textContent = r.ok ? 'Preference change applied.' : 'Approval failed.';
      setTimeout(() => chip.remove(), 4000);
    };
    const deny = document.createElement('button');
    deny.textContent = 'Deny';
    deny.className = 'chat-pref-approval-btn';
    deny.onclick = async () => {
      await fetch('/api/me/preferences/approve', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ approve: false }),
      });
      chip.textContent = 'Denied.';
      setTimeout(() => chip.remove(), 2500);
    };
    chip.appendChild(approve);
    chip.appendChild(deny);
    this.messagesEl.appendChild(chip);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async toggleMic(): Promise<void> {
    const micBtn = this.container.querySelector('#chat-mic') as HTMLButtonElement | null;
    if (this.recording) {
      this.mediaRecorder?.stop();
      this.recording = false;
      if (micBtn) micBtn.textContent = '🎤';
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.appendMessage('assistant', 'Voice input is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recording = true;
      if (micBtn) micBtn.textContent = '⏹';
      this.chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      this.mediaRecorder = rec;
      rec.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
        void this.transcribe(blob);
      };
      rec.start();
    } catch {
      this.appendMessage('assistant', 'Microphone access was denied.');
    }
  }

  private async transcribe(blob: Blob): Promise<void> {
    const arrayBuf = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const b64 = btoa(binary);
    try {
      const res = await fetch('/api/audio/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ audio: b64, mime: blob.type || 'audio/webm' }),
      });
      const data = (await res.json()) as { text?: string; error?: { message?: string } };
      if (!res.ok || !data.text) {
        this.appendMessage('assistant', `Voice: ${data.error?.message ?? res.status}`);
        return;
      }
      this.inputEl.value = data.text;
      void this.send();
    } catch {
      this.appendMessage('assistant', 'Voice transcription failed.');
    }
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.open = !this.open;
    this.setOpen(this.open);
  }

  close(): void {
    this.setOpen(false);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.container.classList.toggle('chat-panel--open', open);
    document.body.classList.toggle('chat-open', open);
    document.body.classList.toggle('chat-left', this.container.classList.contains('chat-panel--left'));
    // Keep the header "Assistant" toggle in sync with the panel's own state.
    const toggleBtn = document.getElementById('chat-toggle-btn');
    toggleBtn?.classList.toggle('active', open);
  }

  private async loadTools(): Promise<void> {
    try {
      const res = await fetch('/api/chat/tools', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { allowlist: string[]; activeActor: string };
      this.activeActor = data.activeActor ?? 'exterior';
      this.updateActorBadge();
    } catch {
      /* server unreachable in dev; keep default */
    }
  }

  private updateActorBadge(): void {
    const badge = this.container.querySelector('#chat-actor-badge');
    if (badge) badge.textContent = `display owner: ${this.activeActor}`;
  }

  /** Auto-grow textarea up to a cap so long prompts stay readable. */
  private autosizeInput(): void {
    const el = this.inputEl as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  async send(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text) return;
    this.inputEl.value = '';
    this.autosizeInput();
    this.history.push({ role: 'user', content: text });
    this.appendMessage('user', text);
    this.updateContextMeter();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messages: this.history, modelId: (this.container.querySelector('#chat-model') as HTMLSelectElement | null)?.value || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        this.appendMessage('assistant', `Error: ${err?.error?.message ?? res.status}`);
        return;
      }
      if (!res.body) { this.hideWorking(); this.appendMessage('assistant', 'No stream from server.'); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      let bubble: HTMLElement | null = null;
      let thinkingEl: HTMLElement | null = null;
      let thinkingText = '';
      const ensureBubble = () => {
        if (!bubble) {
          bubble = document.createElement('div');
          bubble.className = 'chat-msg chat-msg--assistant';
          this.messagesEl.appendChild(bubble);
        }
        return bubble;
      };
      const ensureThinking = () => {
        if (!thinkingEl) {
          thinkingEl = document.createElement('details');
          thinkingEl.className = 'chat-thinking';
          // Phase 5 item 7: the visible surface is three animated dots, not
          // streamed reasoning. Raw text is opt-in via the summary toggle.
          const summary = document.createElement('summary');
          summary.innerHTML = '<span class="chat-thinking-dots"><i></i><i></i><i></i></span>';
          thinkingEl.appendChild(summary);
          this.messagesEl.appendChild(thinkingEl);
        }
        return thinkingEl;
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              const parsed = JSON.parse(payload) as { text?: string; tool?: string; result?: string; error?: string; thinking?: string };
              if (parsed.error) {
                ensureBubble().textContent = `Error: ${parsed.error}`;
              } else if (parsed.thinking) {
                // Phase 5 item 7: reasoning NEVER streams into the user's view.
                // A 3-dot shimmer signals liveness; raw text stays in a tiny
                // collapsed <details> for the curious. Token counting removed.
                thinkingText += parsed.thinking;
                const t = ensureThinking() as HTMLDetailsElement & { _pre?: HTMLElement };
                if (!t._pre) {
                  t._pre = document.createElement('pre');
                  t._pre.style.whiteSpace = 'pre-wrap';
                  t.appendChild(t._pre);
                }
                t._pre.textContent = thinkingText;
                              } else if (parsed.text) {
                assistantText += parsed.text;
                this.hideWorking();
                ensureBubble().innerHTML = renderMarkdown(assistantText);
                this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
              } else if (parsed.tool) {
                // Invisible plumbing (Goal 7): only liveness is shown.
                this.showWorking();
                // Phase 5 item 5: Plan/Act checklist — parse plan tool results
                // and keep the checklist rendered above the conversation.
                if (parsed.tool === 'set_task_plan' || parsed.tool === 'update_task_step') {
                  try {
                    const res = JSON.parse(String(parsed.result ?? '{}')) as { ok?: boolean; steps?: Array<{ index: number; text: string; status: string }>; mode?: string };
                    if (res.ok && res.steps) this.renderTaskPlan(res.steps, res.mode ?? 'act');
                  } catch { /* ignore malformed */ }
                }
                // Phase 5: the assistant requested a preference change (opacity
                // caps) — surface an Approve/Deny chip instead of swallowing it.
                if (parsed.tool === 'set_my_preferences' && typeof parsed.result === 'string' && parsed.result.includes('pending_approval')) {
                  try {
                    const res = JSON.parse(parsed.result) as { requested?: Record<string, unknown> };
                    if (res.requested) this.requestPrefApproval(res.requested);
                  } catch { /* ignore malformed */ }
                }
                // Phase 3.5 A5: prose streamed before a tool call is interim
                // narration, not the answer — demote it to a muted one-liner
                // and start a fresh bubble for whatever follows.
                if (assistantText) {
                  // TS can't track the ensureBubble() assignment through the
                  // closure, so read the current bubble via a function call.
                  const interimBubble = ((): HTMLElement | null => bubble)();
                  if (interimBubble) {
                    const interim = assistantText.trim().replace(/\s+/g, ' ');
                    interimBubble.className = 'chat-msg chat-msg--note';
                    interimBubble.textContent = interim.length > 160 ? `${interim.slice(0, 159)}…` : interim;
                  }
                  assistantText = '';
                  bubble = null;
                }
              }
            } catch {
              /* ignore non-JSON SSE */
            }
          }
        }
      }
      this.hideWorking();
      if (assistantText) this.history.push({ role: 'assistant', content: assistantText });
      this.updateContextMeter();
    } catch (err) {
      this.hideWorking();
      this.appendMessage('assistant', `Network error: ${(err as Error).message}`);
    }
  }

  private appendMessage(role: ChatMessage['role'], text: string): void {
    const el = document.createElement('div');
    el.className = `chat-msg chat-msg--${role}`;
    el.textContent = text;
    this.messagesEl.appendChild(el);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}
