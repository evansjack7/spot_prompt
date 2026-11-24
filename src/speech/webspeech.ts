// Browser SpeechRecognition (Chrome / Edge / Safari).
// On recent Chrome it can run fully on-device (`processLocally`), otherwise it
// needs a network connection.
import type { EngineHandlers, SpeechEngine } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = any;

export function webSpeechCtor(): AnyRec | null {
  const w = window as AnyRec;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export type LocalAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

/** Can this browser recognise speech on-device for `lang`? (Chrome 139+) */
export async function webSpeechLocalAvailability(lang: string): Promise<LocalAvailability> {
  const C = webSpeechCtor();
  if (!C || typeof C.available !== 'function') return 'unsupported';
  try {
    return await C.available({ langs: [lang], processLocally: true });
  } catch {
    return 'unsupported';
  }
}

export async function installWebSpeechLocal(lang: string): Promise<boolean> {
  const C = webSpeechCtor();
  if (!C || typeof C.install !== 'function') return false;
  try {
    return !!(await C.install({ langs: [lang], processLocally: true }));
  } catch {
    return false;
  }
}

export class WebSpeechEngine implements SpeechEngine {
  readonly id = 'webspeech';
  private rec: AnyRec | null = null;
  private active = false;
  private restartTimer = 0;
  private lastStart = 0;
  private fastFails = 0;

  constructor(private h: EngineHandlers, private lang: string, private local: boolean) {}

  async start() {
    const C = webSpeechCtor();
    if (!C) {
      this.h.onState('error', 'Speech recognition is not supported in this browser. Use the offline (Vosk) engine.');
      return;
    }
    this.active = true;
    this.fastFails = 0;
    this.spawn(C);
  }

  private spawn(C: AnyRec) {
    const rec = new C();
    this.rec = rec;
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    if (this.local && 'processLocally' in rec) rec.processLocally = true;

    rec.onstart = () => this.h.onState('listening');
    rec.onresult = (e: AnyRec) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) this.h.onText(t, true);
        else interim += ' ' + t;
      }
      this.h.onText(interim.trim(), false);
    };
    rec.onerror = (e: AnyRec) => {
      const err = e.error as string;
      if (err === 'no-speech' || err === 'aborted') return;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        this.active = false;
        this.h.onState('error', 'Microphone permission denied.');
      } else if (err === 'network') {
        this.active = false;
        this.h.onState('error', 'Speech service needs internet. Switch to the offline engine in Settings.');
      } else if (err === 'language-not-supported') {
        this.active = false;
        this.h.onState('error', `On-device recognition for ${this.lang} isn't installed. Install it in Settings or turn off "on-device".`);
      } else {
        this.h.onState('error', 'Speech error: ' + err);
      }
    };
    rec.onend = () => {
      // Chrome ends sessions after silence / ~60s: restart seamlessly.
      if (!this.active) { this.h.onState('idle'); return; }
      const quick = performance.now() - this.lastStart < 1000;
      this.fastFails = quick ? this.fastFails + 1 : 0;
      if (this.fastFails > 5) {
        this.active = false;
        this.h.onState('error', 'Speech recognition keeps stopping. Try the offline engine.');
        return;
      }
      this.restartTimer = window.setTimeout(() => this.active && this.spawn(C), quick ? 300 : 50);
    };
    this.lastStart = performance.now();
    try {
      rec.start();
    } catch (err) {
      this.h.onState('error', String(err));
    }
  }

  stop() {
    this.active = false;
    clearTimeout(this.restartTimer);
    try { this.rec?.stop(); } catch { /* ignore */ }
    this.rec = null;
    this.h.onState('idle');
  }
}
