// Fully offline recognition with Vosk (Kaldi compiled to WebAssembly).
// The model (~40 MB) is downloaded once; vosk-browser unpacks it into
// IndexedDB keyed by its URL, so later loads need no network at all.
import type { EngineHandlers, SpeechEngine } from './types';
import type { Model } from 'vosk-browser';

export interface VoskModelInfo { id: string; label: string; url: string; lang: string }

export const VOSK_MODELS: VoskModelInfo[] = [
  {
    id: 'en-us-small',
    label: 'English (US) — small, 40 MB',
    url: 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz',
    lang: 'en-US',
  },
];

/** Same-origin URL a user-imported model archive is served from (via the service worker cache). */
export const IMPORTED_MODEL_URL = new URL('vosk-model/imported-model.tar.gz', document.baseURI).href;
export const IMPORTED_MODEL_CACHE = 'spotprompt-vosk-import';

const READY_KEY = 'spotprompt.voskReady:';

export function modelUrlFor(id: string): string {
  if (id === 'imported') return IMPORTED_MODEL_URL;
  return (VOSK_MODELS.find((m) => m.id === id) ?? VOSK_MODELS[0]).url;
}

/** Has this model been fully downloaded + unpacked on this device? */
export async function isModelCached(url: string): Promise<boolean> {
  try {
    if (localStorage.getItem(READY_KEY + url) === '1') return true;
  } catch { /* ignore */ }
  // Look directly into vosk-browser's IDBFS store.
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open('/vosk'); } catch { resolve(false); return; }
    req.onupgradeneeded = () => { req.transaction?.abort(); resolve(false); };
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const key = `/vosk/${url.replace(/[\W]/g, '_')}/extracted.ok`;
        const g = db.transaction('FILE_DATA', 'readonly').objectStore('FILE_DATA').get(key);
        g.onsuccess = () => { db.close(); resolve(!!g.result); };
        g.onerror = () => { db.close(); resolve(false); };
      } catch { db.close(); resolve(false); }
    };
  });
}

let voskLib: typeof import('vosk-browser') | null = null;
const models = new Map<string, Promise<Model>>();

export async function loadModel(url: string, onProgress?: EngineHandlers['onProgress']): Promise<Model> {
  let p = models.get(url);
  if (!p) {
    p = (async () => {
      onProgress?.(0, (await isModelCached(url)) ? 'Loading offline speech model…' : 'Downloading speech model (≈40 MB, one time)…');
      if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
      voskLib ??= await import('vosk-browser');
      const model = await voskLib.createModel(url);
      try { localStorage.setItem(READY_KEY + url, '1'); } catch { /* ignore */ }
      onProgress?.(1, 'Speech model ready');
      return model;
    })();
    models.set(url, p);
    p.catch(() => models.delete(url));
  }
  return p;
}

/** Store a user-provided model .tar.gz so it can be loaded offline. */
export async function importModelFile(file: File): Promise<void> {
  const cache = await caches.open(IMPORTED_MODEL_CACHE);
  await cache.put(IMPORTED_MODEL_URL, new Response(file, { headers: { 'Content-Type': 'application/gzip' } }));
  try { localStorage.removeItem(READY_KEY + IMPORTED_MODEL_URL); } catch { /* ignore */ }
  models.delete(IMPORTED_MODEL_URL);
}

export class VoskEngine implements SpeechEngine {
  readonly id = 'vosk';
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognizer: any = null;
  private running = false;

  constructor(private h: EngineHandlers, private modelUrl: string, private grammar: string[] | null) {}

  async start() {
    this.running = true;
    this.h.onState('loading');
    let model: Model;
    try {
      model = await loadModel(this.modelUrl, this.h.onProgress);
    } catch (e) {
      this.running = false;
      this.h.onState('error', navigator.onLine
        ? 'Could not load the speech model: ' + String(e)
        : 'The offline speech model isn\'t downloaded yet. Connect once and tap "Download offline model" in Settings.');
      return;
    }
    if (!this.running) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        video: false,
      });
    } catch {
      this.running = false;
      this.h.onState('error', 'Microphone permission denied.');
      return;
    }
    if (!this.running) { this.release(); return; }
    this.ctx = new AudioContext();
    const sr = this.ctx.sampleRate;
    const grammar = this.grammar ? JSON.stringify([...this.grammar, '[unk]']) : undefined;
    const rec = new model.KaldiRecognizer(sr, grammar);
    this.recognizer = rec;
    rec.on('result', (m: any) => { const t = m.result?.text; if (t) this.h.onText(t, true); this.h.onText('', false); });
    rec.on('partialresult', (m: any) => this.h.onText(m.result?.partial ?? '', false));

    const src = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is deprecated but universally supported and what vosk-browser expects.
    const node = this.ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (ev) => {
      if (!this.running) return;
      try { rec.acceptWaveform(ev.inputBuffer); } catch { /* recognizer gone */ }
      if (this.h.onLevel) {
        const d = ev.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < d.length; i += 8) sum += d[i] * d[i];
        this.h.onLevel(Math.min(1, Math.sqrt(sum / (d.length / 8)) * 6));
      }
    };
    src.connect(node);
    node.connect(this.ctx.destination);
    this.node = node;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.h.onState('listening');
  }

  private release() {
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    try { this.recognizer?.remove(); } catch { /* ignore */ }
    this.recognizer = null;
  }

  stop() {
    this.running = false;
    this.release();
    this.h.onState('idle');
  }
}
