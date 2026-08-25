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
    this.container.innerHTML = `
      <div class="chat-header">
        <span class="chat-title">In-app assistant</span>
        <div class="chat-header-right">
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
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.send();
    });

    void this.loadTools();
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
        body: JSON.stringify({ messages: this.history }),
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
      const ensureBubble = () => {
        if (!bubble) {
          bubble = document.createElement('div');
          bubble.className = 'chat-msg chat-msg--assistant';
          this.messagesEl.appendChild(bubble);
        }
        return bubble;
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
              const parsed = JSON.parse(payload) as { text?: string; tool?: string; result?: string; error?: string };
              if (parsed.error) {
                ensureBubble().textContent = `Error: ${parsed.error}`;
              } else if (parsed.text) {
                assistantText += parsed.text;
                ensureBubble().textContent = assistantText;
              } else if (parsed.tool) {
                const result = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
                const toolLine = document.createElement('div');
                toolLine.className = 'chat-tool-call';
                toolLine.textContent = `⚙ ${parsed.tool}: ${result.slice(0, 120)}`;
                this.messagesEl.appendChild(toolLine);
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
