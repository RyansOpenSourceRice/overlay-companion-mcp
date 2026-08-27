/**
 * In-app chat assistant (Phase B1/B2/B3).
 *
 * A SECOND client to the same C# MCP tools. Streams the assistant from
 * POST /api/chat (SSE). Includes the display-ownership toggle (interior vs
 * exterior) and surfaces which tools the assistant may use. Config-via-chat is
 * handled server-side for admin users (B3).
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class ChatPanel {
  private container: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLInputElement;
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
        <input type="text" id="chat-input" placeholder="Ask the assistant to annotate the screen…" aria-label="Chat with the in-app assistant" />
        <button id="chat-send" class="btn btn-primary">Send</button>
      </div>
    `;
    this.messagesEl = this.container.querySelector('#chat-messages')!;
    this.inputEl = this.container.querySelector('#chat-input')!;
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
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.send();
    });

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

  /** Human "impact" phrasing per tool so users see outcomes, not plumbing. */
  private static IMPACT: Record<string, string> = {
    draw_overlay: 'Annotated your screen',
    template_overlay: 'Annotated your screen',
    take_screenshot: 'Looked at your screen',
    get_display_info: 'Checked display layout',
    set_display_actor: 'Switched who owns the canvas',
    get_overlay_capabilities: 'Checked overlay support',
    get_config: 'Read app configuration',
    set_config: 'Updated app configuration',
  };

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

  async send(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text) return;
    this.inputEl.value = '';
    this.history.push({ role: 'user', content: text });
    this.appendMessage('user', text);

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
      if (!res.body) { this.appendMessage('assistant', 'No stream from server.'); return; }

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
          thinkingEl.appendChild(Object.assign(document.createElement('summary'), { textContent: 'Thinking…' }));
          this.messagesEl.appendChild(thinkingEl);
        }
        return thinkingEl;
      };
      /** One compact "✔ impact" row per tool call; raw payload stays collapsed.
       *  Block layout keeps the label pinned to its line when <details> opens
       *  (the payload grows downward, never sideways). */
      const addImpact = (tool: string, resultJson: string) => {
        const impact = ChatPanel.IMPACT[tool] ?? 'Applied your change';
        const line = document.createElement('div');
        line.className = 'chat-impact';
        const label = document.createElement('span');
        label.className = 'chat-impact-label';
        label.textContent = `✔ ${impact}`;
        const details = document.createElement('details');
        details.className = 'chat-impact-details';
        const summary = document.createElement('summary');
        summary.textContent = 'details';
        const pre = document.createElement('pre');
        pre.textContent = resultJson.slice(0, 600);
        details.appendChild(summary);
        details.appendChild(pre);
        line.appendChild(label);
        line.appendChild(details);
        this.messagesEl.appendChild(line);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
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
                // Collapsible reasoning (issue #1): short header by default so
                // it never pushes the conversation out of view.
                thinkingText += parsed.thinking;
                const t = ensureThinking() as HTMLDetailsElement & { _pre?: HTMLElement };
                if (!t._pre) {
                  t._pre = document.createElement('pre');
                  t._pre.style.whiteSpace = 'pre-wrap';
                  t.appendChild(t._pre);
                }
                if (!t.open) t.open = false;
                t._pre.textContent = thinkingText;
                t.querySelector('summary')!.textContent =
                  `Thinking (${Math.min(Math.round(thinkingText.length / 4), 999)} tokens)…`;
              } else if (parsed.text) {
                assistantText += parsed.text;
                ensureBubble().textContent = assistantText;
                this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
              } else if (parsed.tool) {
                // Issue #3/#4: show the effect, not the machinery. The raw
                // result is one click away under 'details'.
                const result = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
                addImpact(parsed.tool, result ?? '');
              }
            } catch {
              /* ignore non-JSON SSE */
            }
          }
        }
      }
      if (assistantText) this.history.push({ role: 'assistant', content: assistantText });
    } catch (err) {
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
