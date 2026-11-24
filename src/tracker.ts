// Voice position tracker.
//
// Keeps `pos` = index of the next unread script token. Every time the
// recogniser produces words we take the last few spoken words and run a
// weighted local alignment (Smith-Waterman style) against a window of the
// script around `pos`. The alignment tolerates:
//   - swapped / substituted words      (diagonal mismatch, small penalty)
//   - words the recogniser dropped     (skip script word, small penalty)
//   - filler / extra spoken words      (skip spoken word, small penalty)
// A move is only accepted when enough *meaningful* words matched
// (stop-words like "the", "and" count for little), so tangents leave the
// position where it was until you resume the script.
import { similarity, wordWeight } from './normalize';
import type { ScriptDoc } from './markup';

export interface TrackerOptions {
  /** Weighted matched words needed to move (≈ number of content words). */
  minWeight: number;
  /** Allow jumping backwards when you re-read a line (retake). */
  followRetakes: boolean;
  lookAhead: number;
  lookBack: number;
  /** Spoken words considered per update. */
  tail: number;
}

export const DEFAULT_TRACKER: TrackerOptions = {
  minWeight: 2.2,
  followRetakes: true,
  lookAhead: 80,
  lookBack: 40,
  tail: 12,
};

const MATCH_SIM = 0.6;
const SUB_PEN = 0.5;
const SPOKEN_GAP = 0.45;
const SCRIPT_GAP = 0.45;
const SCRIPT_GAP_STOP = 0.2;

interface Cand { pos: number; score: number; weight: number; count: number; fresh: number; freshCount: number; freshMiss: number }

export class Tracker {
  pos = 0;
  opts: TrackerOptions;
  private toks: string[];
  private weights: Float32Array;
  private tokLine: Int32Array;

  constructor(private doc: ScriptDoc, opts: Partial<TrackerOptions> = {}) {
    this.opts = { ...DEFAULT_TRACKER, ...opts };
    this.toks = doc.tokens.map((t) => t.t);
    this.weights = Float32Array.from(this.toks, wordWeight);
    this.tokLine = Int32Array.from(doc.tokens, (t) => t.line);
  }

  get length() { return this.toks.length; }

  setPos(p: number) {
    this.pos = Math.max(0, Math.min(this.toks.length, p));
  }

  /**
   * Feed the most recent spoken words (normalised tokens, oldest first).
   * Returns true when the position changed.
   */
  hear(spoken: string[]): boolean {
    const S = spoken.slice(-this.opts.tail);
    if (S.length < 2 || !this.toks.length) return false;
    const { minWeight, lookAhead, lookBack, followRetakes } = this.opts;

    const lo = Math.max(0, this.pos - lookBack);
    const hi = Math.min(this.toks.length, this.pos + lookAhead);
    let best = this.align(S, lo, hi, minWeight);

    // Lost? (skipped ahead a paragraph, or jumped elsewhere) → search everywhere, stricter.
    if (!best && S.length >= 5) {
      best = this.align(S, 0, this.toks.length, Math.max(4, minWeight * 1.8));
    }
    if (!best) return false;

    if (best.pos > this.pos) {
      // Moving forward needs fresh evidence beyond where we are. A tight path
      // (more matches than misses) needs ~one content word; a path that crosses
      // a lot of unmatched words (e.g. a tangent) must earn the full threshold.
      const needFresh = best.freshMiss <= best.freshCount ? 0.9 : minWeight;
      if (best.fresh < needFresh) return false;
      this.pos = best.pos;
      return true;
    }
    if (best.pos < this.pos - 1 && followRetakes && best.weight >= Math.max(3.2, minWeight * 1.4)) {
      this.pos = best.pos;
      return true;
    }
    return false;
  }

  private align(S: string[], lo: number, hi: number, minWeight: number): Cand | null {
    const n = hi - lo;
    const m = S.length;
    if (n <= 0) return null;
    // rolling rows: H = score, W = matched weight on path, C = matched count,
    // F/FC = "fresh" matched weight/count (script tokens at/after pos),
    // FP = misses in the fresh part (incl. unmatched spoken words after the last old match)
    const mk = () => ({ H: new Float32Array(n + 1), W: new Float32Array(n + 1), F: new Float32Array(n + 1), C: new Int16Array(n + 1), FC: new Int16Array(n + 1), FP: new Int16Array(n + 1) });
    let prev = mk(), cur = mk();
    const pos = this.pos;
    let best: Cand | null = null;

    for (let i = 1; i <= m; i++) {
      const sw = S[i - 1];
      cur.H[0] = 0; cur.W[0] = 0; cur.F[0] = 0; cur.C[0] = 0; cur.FC[0] = 0; cur.FP[0] = 0;
      for (let j = 1; j <= n; j++) {
        const k = lo + j - 1;
        const tw = this.weights[k];
        const sim = similarity(sw, this.toks[k]);
        let src = prev, sj = j - 1, h: number, gain = 0, miss = 0;
        if (sim >= MATCH_SIM) { gain = tw * sim; h = prev.H[j - 1] + gain; }
        else { h = prev.H[j - 1] - SUB_PEN; miss = 1; }
        const hu = prev.H[j] - SPOKEN_GAP; // extra spoken word
        if (hu > h) { h = hu; src = prev; sj = j; gain = 0; miss = 1; }
        const hl = cur.H[j - 1] - (tw < 0.5 ? SCRIPT_GAP_STOP : SCRIPT_GAP); // skipped script word
        if (hl > h) { h = hl; src = cur; sj = j - 1; gain = 0; miss = tw < 0.5 ? 0 : 1; }
        if (h <= 0) {
          cur.H[j] = 0; cur.W[j] = 0; cur.F[j] = 0; cur.C[j] = 0; cur.FC[j] = 0; cur.FP[j] = 0;
        } else {
          cur.H[j] = h;
          cur.W[j] = src.W[sj] + gain;
          const fresh = k >= pos || (sj === j && k >= pos - 1);
          cur.F[j] = src.F[sj] + (fresh ? gain : 0);
          cur.C[j] = src.C[sj] + (gain > 0 ? 1 : 0);
          cur.FC[j] = src.FC[sj] + (fresh && gain > 0 ? 1 : 0);
          cur.FP[j] = src.FP[sj] + (fresh ? miss : 0);
        }
      }
      [prev, cur] = [cur, prev];
    }
    // `prev` now holds the last row: alignments ending at the most recent
    // spoken word (possibly via trailing "extra word" moves).
    for (let j = 1; j <= n; j++) {
      const C = prev.C[j], W = prev.W[j];
      if (C < 2 || W < minWeight) continue;
      const p = lo + j;
      const ahead = p - pos;
      const dist = ahead >= 0 ? Math.max(0, ahead - m) * 0.02 : -ahead * 0.05;
      const score = prev.H[j] - dist;
      if (!best || score > best.score) best = { pos: p, score, weight: W, count: C, fresh: prev.F[j], freshCount: prev.FC[j], freshMiss: prev.FP[j] };
    }
    return best;
  }

  /** Line considered "current" for display: finishes a line once nearly all of it is read. */
  currentLine(): number {
    const N = this.toks.length;
    if (!N) return 0;
    if (this.pos >= N) return this.tokLine[N - 1];
    if (this.pos > 0) {
      const prevLine = this.tokLine[this.pos - 1];
      const info = this.doc.lines[prevLine];
      const len = info.endToken - info.firstToken;
      const remaining = info.endToken - this.pos;
      if (remaining > 0 && remaining <= Math.max(1, Math.floor(len * 0.25)) && len >= 3) {
        return this.nextTrackedLine(prevLine) ?? prevLine;
      }
    }
    return this.tokLine[this.pos];
  }

  /** Token index the display should treat as "here" (start of current line if line finished). */
  displayToken(): number {
    const line = this.currentLine();
    const info = this.doc.lines[line];
    if (this.pos < info.firstToken) return info.firstToken;
    return Math.min(this.pos, this.toks.length - 1);
  }

  private nextTrackedLine(line: number): number | null {
    for (let l = line + 1; l < this.doc.lines.length; l++) {
      const li = this.doc.lines[l];
      if (li.endToken > li.firstToken) return l;
    }
    return null;
  }

  private prevTrackedLine(line: number): number | null {
    for (let l = line - 1; l >= 0; l--) {
      const li = this.doc.lines[l];
      if (li.endToken > li.firstToken) return l;
    }
    return null;
  }

  /** Manual nudge by whole lines (remote / arrow keys). */
  stepLine(delta: number) {
    let line = this.currentLine();
    const info = this.doc.lines[line];
    if (delta < 0 && this.pos > info.firstToken) {
      // first press goes to the start of the current line
      this.pos = info.firstToken;
      delta++;
    }
    while (delta > 0) { const n = this.nextTrackedLine(line); if (n == null) { this.pos = this.toks.length; return; } line = n; delta--; }
    while (delta < 0) { const p = this.prevTrackedLine(line); if (p == null) break; line = p; delta++; }
    this.pos = this.doc.lines[line].firstToken;
  }
}
