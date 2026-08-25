import type { LibSqlStore } from './libsql-store.js';

/**
 * Audio provider abstraction (Phase C).
 *
 * The chat panel can accept voice input (STT) and optionally speak replies
 * (TTS). Default OFF. Two providers:
 *  - "openrouter": OpenRouter `/audio/transcriptions` (e.g. fish-audio/transcribe-1)
 *    and `/audio/speech` (e.g. fish-audio/s1), OpenAI-shaped, base64 audio in.
 *  - "local": an OpenAI-compatible STT server (whisper.cpp server / faster-whisper)
 *    at a configured URL. TTS is only available if the local server exposes an
 *    OpenAI-compatible speech endpoint.
 *
 * Both are thin HTTP adapters behind one interface so the panel never cares.
 */

export interface AudioConfig {
  enabled: boolean;
  provider: 'off' | 'openrouter' | 'local';
  sttModel: string;
  ttsModel: string;
  sttUrl: string;
  ttsUrl: string;
}

export interface TranscribeResult {
  text: string;
  durationSec?: number;
}

export interface AudioProvider {
  name: string;
  /** Transcribe raw audio bytes (wav/mp3/ogg/webm). */
  transcribe(audio: Buffer, mime: string): Promise<TranscribeResult>;
  /** Synthesize speech from text; returns audio bytes + mime, or null if unsupported. */
  synthesize(text: string): Promise<{ audio: Buffer; mime: string } | null>;
}

const DEFAULT_AUDIO: AudioConfig = {
  enabled: false,
  provider: 'off',
  sttModel: 'fish-audio/transcribe-1',
  ttsModel: 'fish-audio/s1',
  sttUrl: '',
  ttsUrl: '',
};

class OpenRouterAudio implements AudioProvider {
  name = 'openrouter';
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string, private cfg: AudioConfig) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async transcribe(audio: Buffer, mime: string): Promise<TranscribeResult> {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mime }), 'audio.' + extFor(mime));
    form.append('model', this.cfg.sttModel);
    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenRouter STT failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as { text?: string; usage?: { seconds?: number } };
    return { text: data.text ?? '', durationSec: data.usage?.seconds };
  }

  async synthesize(text: string): Promise<{ audio: Buffer; mime: string } | null> {
    const res = await fetch(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.cfg.ttsModel, input: text, response_format: 'mp3' }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenRouter TTS failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return { audio: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg' };
  }
}

class LocalWhisper implements AudioProvider {
  name = 'local';

  constructor(private cfg: AudioConfig) {}

  async transcribe(audio: Buffer, mime: string): Promise<TranscribeResult> {
    if (!this.cfg.sttUrl) throw new Error('Local STT URL is not configured.');
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mime }), 'audio.' + extFor(mime));
    form.append('model', this.cfg.sttModel || 'whisper-1');
    const res = await fetch(this.cfg.sttUrl, { method: 'POST', body: form });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Local STT failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as { text?: string };
    return { text: data.text ?? '' };
  }

  async synthesize(_text: string): Promise<{ audio: Buffer; mime: string } | null> {
    if (!this.cfg.ttsUrl) return null;
    const form = new FormData();
    form.append('text', _text);
    const res = await fetch(this.cfg.ttsUrl, { method: 'POST', body: form });
    if (!res.ok) return null;
    return { audio: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') ?? 'audio/wav' };
  }
}

export class AudioBridge {
  private store: LibSqlStore;
  private _cached: AudioConfig | null = null;

  constructor(store: LibSqlStore) {
    this.store = store;
  }

  async config(): Promise<AudioConfig> {
    if (this._cached) return this._cached;
    const stored = (await this.store.getConfig('audio.provider')) as Record<string, unknown> | null;
    const cfg: AudioConfig = {
      ...DEFAULT_AUDIO,
      ...(stored as Partial<AudioConfig> | null),
    };
    if (!cfg.sttUrl) cfg.sttUrl = process.env.AUDIO_STT_URL ?? '';
    if (!cfg.ttsUrl) cfg.ttsUrl = process.env.AUDIO_TTS_URL ?? '';
    this._cached = cfg;
    return cfg;
  }

  async provider(): Promise<AudioProvider | null> {
    const cfg = await this.config();
    if (!cfg.enabled || cfg.provider === 'off') return null;
    if (cfg.provider === 'openrouter') {
      const prov = (await this.store.getConfig('provider.chat')) as Record<string, unknown> | null;
      const key = (prov?.apiKey as string) || process.env.PROVIDER_API_KEY || '';
      const base = (prov?.baseUrl as string) || 'https://openrouter.ai/api/v1';
      if (!key) throw new Error('OpenRouter API key is not configured (Provider settings).');
      return new OpenRouterAudio(base, key, cfg);
    }
    if (cfg.provider === 'local') return new LocalWhisper(cfg);
    return null;
  }

  invalidate(): void {
    this._cached = null;
  }
}

function extFor(mime: string): string {
  switch (mime) {
    case 'audio/webm': return 'webm';
    case 'audio/mp3': case 'audio/mpeg': return 'mp3';
    case 'audio/ogg': return 'ogg';
    case 'audio/m4a': return 'm4a';
    case 'audio/flac': return 'flac';
    default: return 'wav';
  }
}
