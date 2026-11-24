import { describe, expect, it } from 'vitest';
import { parseScript } from '../src/markup';
import { tokenize } from '../src/normalize';
import { Tracker } from '../src/tracker';

// Deterministic PRNG
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

const LINES = [
  'Welcome back to the channel, today we are hiking the Angel Ridge trail.',
  'It is about eleven miles round trip with three thousand feet of climbing.',
  'The first section winds through old growth cedar and hemlock forest.',
  'You will cross the creek twice, so bring shoes that can get wet.',
  'After the second crossing the switchbacks begin in earnest.',
  'Take your time here, the views open up once you clear the tree line.',
  'At the saddle there is a small lake that is perfect for lunch.',
  'From the lake it is another mile of scrambling to reach the summit.',
  'On a clear day you can see three volcanoes from the top.',
  'Remember to pack out everything you bring in and stay on the trail.',
  'Thanks for watching, and I will see you on the next adventure.',
];
const TANGENTS = [
  'oh wow look at that hawk up there',
  'hang on my pack strap is twisted',
  'sorry a dog just ran past me',
  'man it is getting windy up here',
];
const VOCAB = 'apple banana river stone cloud happy seven quick purple garden window'.split(' ');

describe('noisy recognition simulation', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`seed ${seed}: reaches each line, never runs ahead during tangents`, () => {
      const r = rng(seed);
      const doc = parseScript(LINES.join('\n'));
      const tr = new Tracker(doc);
      const buf: string[] = [];
      let lagging = 0;
      for (let li = 0; li < LINES.length; li++) {
        for (const w of tokenize(LINES[li])) {
          const x = r();
          if (x < 0.2) continue; // dropped by recogniser
          buf.push(x < 0.35 ? VOCAB[Math.floor(r() * VOCAB.length)] : w);
          tr.hear(buf);
        }
        const after = tr.currentLine();
        expect(after, `after reading line ${li}`).toBeGreaterThanOrEqual(li);
        expect(after).toBeLessThanOrEqual(li + 1);
        if (after < Math.min(li + 1, LINES.length - 1)) { lagging++; }
        if (r() < 0.5) {
          const pos = tr.pos;
          for (const w of tokenize(TANGENTS[Math.floor(r() * TANGENTS.length)])) { buf.push(w); tr.hear(buf); }
          expect(tr.pos, `tangent after line ${li} moved`).toBe(pos);
        }
      }
      // With ~35% garbled/dropped words a line's last words are sometimes lost; it must catch up on the next line (checked above).
      expect(lagging, 'lines still showing after being read (catch up on next line)').toBeLessThanOrEqual(4);
      expect(tr.pos).toBeGreaterThan(tr.length - 4);
    });
  }
});
