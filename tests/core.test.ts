import { describe, expect, it } from 'vitest';
import { parseScript, lineText } from '../src/markup';
import { tokenize, similarity } from '../src/normalize';
import { Tracker } from '../src/tracker';
import { htmlToMarkup } from '../src/paste';

const SCRIPT = `# Opening
Hi, I'm standing here on the *edge* of the Grand Canyon. /
Behind me, the Colorado River has carved **two billion** years of rock.

[walk to camera]
It took roughly 6 million years to cut this deep.
~~This sentence was cut from the final version.~~
--- Take 2: the lookout
Up here at the lookout, the wind never really stops.
> remind crew: drone shot
Let's head down the trail and see what the river looks like up close.`;

/** Simulate a recogniser: emits words one by one, calling hear() on a rolling buffer. */
function speak(tr: Tracker, text: string, buf: string[] = []): string[] {
  for (const w of tokenize(text)) {
    buf.push(w);
    tr.hear(buf);
  }
  return buf;
}

const lineOfPos = (_doc: ReturnType<typeof parseScript>, tr: Tracker) => tr.currentLine();

describe('normalize', () => {
  it('expands numbers and strips punctuation', () => {
    expect(tokenize("It's 6 million — 1999's 2nd best!")).toEqual(
      ['its', 'six', 'million', 'nineteen', 'ninety', 'nines', 'second', 'best'],
    );
    expect(tokenize('2024')).toEqual(['twenty', 'twenty', 'four']);
    expect(tokenize('$5')).toEqual(['five', 'dollars']);
  });
  it('fuzzy similarity', () => {
    expect(similarity('canyon', 'canyons')).toBeGreaterThan(0.8);
    expect(similarity('colorado', 'collarado')).toBeGreaterThan(0.6);
    expect(similarity('the', 'they')).toBe(0);
    expect(similarity('rock', 'river')).toBe(0);
  });
});

describe('markup', () => {
  const doc = parseScript(SCRIPT);
  it('parses blocks', () => {
    const kinds = doc.blocks.map((b) => b.k);
    expect(kinds).toEqual(['heading', 'line', 'line', 'line', 'line', 'line', 'take', 'line', 'line', 'line']);
    expect(doc.takes[0].label).toBe('Take 2: the lookout');
  });
  it('styles, directions, pauses and cuts', () => {
    const l0 = doc.blocks[1];
    if (l0.k !== 'line') throw 0;
    const edge = l0.pieces.find((p) => p.k === 'w' && p.w.frags[0].text === 'edge');
    expect(edge && edge.k === 'w' && edge.w.frags[0].styles).toEqual(['stress']);
    expect(l0.pieces[l0.pieces.length - 1]).toMatchObject({ k: 'pause', long: false });
    const dir = doc.blocks[3];
    expect(dir.k === 'line' && dir.pieces[0]).toMatchObject({ k: 'dir', text: 'walk to camera' });
    // cut line has no tracked tokens
    const cut = doc.lines[4];
    expect(cut.endToken - cut.firstToken).toBe(0);
    // note line not tracked
    const note = doc.lines[6];
    expect(note.endToken - note.firstToken).toBe(0);
    expect(lineText(doc, 1)).toBe('Behind me, the Colorado River has carved two billion years of rock.');
  });
  it('keeps snake_case and and/or literal', () => {
    const d = parseScript('use snake_case and/or not');
    expect(d.tokens.map((t) => t.t)).toEqual(['use', 'snake', 'case', 'and', 'or', 'not']);
  });
});

describe('tracker', () => {
  it('follows exact reading line by line', () => {
    const doc = parseScript(SCRIPT);
    const tr = new Tracker(doc);
    const buf = speak(tr, "Hi I'm standing here on the edge of the Grand Canyon");
    expect(lineOfPos(doc, tr)).toBe(1); // finished line 0 → shows line 1
    speak(tr, 'Behind me the Colorado River has carved two billion years of rock', buf);
    expect(lineOfPos(doc, tr)).toBe(3); // line 2 is a direction only
  });

  it('tolerates swapped and dropped words', () => {
    const doc = parseScript(SCRIPT);
    const tr = new Tracker(doc);
    const buf = speak(tr, "hey I'm standing right here at the edge of grand canyon");
    expect(tr.currentLine()).toBe(1);
    speak(tr, 'behind me the colorado has cut two billion years of stone', buf);
    expect(tr.currentLine()).toBe(3);
  });

  it('stays put during a tangent, resumes after', () => {
    const doc = parseScript(SCRIPT);
    const tr = new Tracker(doc);
    const buf = speak(tr, "Hi I'm standing here on the edge of the Grand Canyon");
    const before = tr.pos;
    speak(tr, 'sorry guys a bird just flew right past me that was wild okay so anyway', buf);
    expect(tr.pos).toBe(before);
    speak(tr, 'behind me the Colorado River has carved', buf);
    expect(tr.pos).toBeGreaterThan(before + 4);
    expect(tr.currentLine()).toBe(1);
  });

  it('does not move on a couple of stop-words', () => {
    const doc = parseScript(SCRIPT);
    const tr = new Tracker(doc);
    speak(tr, 'and so the');
    expect(tr.pos).toBe(0);
  });

  it('skips cut text and follows across take breaks', () => {
    const doc = parseScript(SCRIPT);
    const tr = new Tracker(doc);
    tr.setPos(doc.lines[3].firstToken);
    const buf = speak(tr, 'it took roughly six million years to cut this deep');
    speak(tr, 'up here at the lookout the wind never really stops', buf);
    expect(tr.currentLine()).toBe(7);
  });

  it('jumps ahead when the reader skips a paragraph', () => {
    const doc = parseScript(SCRIPT);
    const tr = new Tracker(doc, { lookAhead: 10 });
    speak(tr, "let's head down the trail and see what the river looks like");
    expect(tr.currentLine()).toBe(7);
  });

  it('follows a retake back to the start of a line', () => {
    const doc = parseScript(SCRIPT);
    const tr = new Tracker(doc);
    const buf = speak(tr, "Hi I'm standing here on the edge of the Grand Canyon behind me the Colorado River has carved two billion years");
    const ahead = tr.pos;
    speak(tr, "um let me go again hi I'm standing here on the edge", buf);
    expect(tr.pos).toBeLessThan(ahead);
    expect(tr.currentLine()).toBe(0);
  });

  it('manual stepping', () => {
    const doc = parseScript(SCRIPT);
    const tr = new Tracker(doc);
    tr.stepLine(1);
    expect(tr.currentLine()).toBe(1);
    tr.stepLine(1); // skips non-tracked direction line
    expect(tr.currentLine()).toBe(3);
    tr.stepLine(-1);
    expect(tr.currentLine()).toBe(1);
  });
});

describe('paste', () => {
  it('converts rich text to markup', () => {
    const html = '<p>Hello <b>world</b>, <i>this</i> is <u>key</u> and <s>gone</s>.</p><p><mark>Bright</mark></p><h2>Part two</h2>';
    expect(htmlToMarkup(html)).toBe('Hello **world**, *this* is _key_ and ~~gone~~.\n\n==Bright==\n\n## Part two');
  });
});
