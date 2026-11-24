// SpotPrompt script markup
// -----------------------------------------------------------------------------
//   *word*        stress                 **word**     strong stress
//   _word_        underline / lean       ==words==    highlight
//   ~~words~~     cut (hidden in prompter, not tracked; may span lines)
//   [smile]       direction / cue (shown small, never tracked)
//   /   //        short pause / long beat (standalone)
//   # Heading     section heading (not tracked)
//   > note        presenter note line (not tracked)
//   ---  label    take break  ("--- Take 2: the intro")
//   +++           page break  (next text starts on a fresh screen)
//   blank line    paragraph break; single newline = line break
//   \*            literal character
// -----------------------------------------------------------------------------
import { tokenize } from './normalize';

export type Style = 'stress' | 'strong' | 'under' | 'hl' | 'cut';

export interface Frag { text: string; styles: Style[] }
export interface Word { id: number; frags: Frag[]; tokens: number[]; line: number; cut: boolean }

export type Piece =
  | { k: 'w'; w: Word }
  | { k: 'dir'; text: string; cut: boolean }
  | { k: 'pause'; long: boolean; cut: boolean };

export type Block =
  | { k: 'line'; line: number; pieces: Piece[]; para: boolean; note: boolean }
  | { k: 'heading'; level: number; text: string; cut: boolean }
  | { k: 'take'; n: number; label: string }
  | { k: 'page' };

export interface Token { t: string; word: number; line: number }
export interface LineInfo { block: number; firstToken: number; endToken: number }
export interface TakeInfo { n: number; label: string; block: number; token: number }

export interface ScriptDoc {
  blocks: Block[];
  words: Word[];
  tokens: Token[];
  lines: LineInfo[];
  takes: TakeInfo[];
}

const TAKE_RE = /^\s*-{3,}\s*(.*)$/;
const PAGE_RE = /^\s*\+{3,}\s*$/;
const HEAD_RE = /^\s*(#{1,3})\s+(.*)$/;
const NOTE_RE = /^\s*>\s?(.*)$/;

export function parseScript(src: string): ScriptDoc {
  const doc: ScriptDoc = { blocks: [], words: [], tokens: [], lines: [], takes: [] };
  const rows = src.replace(/\r\n?/g, '\n').split('\n');
  let cut = false; // cut state persists across lines
  let pendingPara = true;
  let takeN = 1;

  for (const row of rows) {
    if (!row.trim()) {
      pendingPara = true;
      continue;
    }
    const take = !cut && row.match(TAKE_RE);
    if (take) {
      takeN++;
      const label = take[1].trim();
      doc.blocks.push({ k: 'take', n: takeN, label });
      doc.takes.push({ n: takeN, label, block: doc.blocks.length - 1, token: doc.tokens.length });
      pendingPara = true;
      continue;
    }
    if (!cut && PAGE_RE.test(row)) {
      doc.blocks.push({ k: 'page' });
      pendingPara = true;
      continue;
    }
    const head = !cut && row.match(HEAD_RE);
    if (head) {
      doc.blocks.push({ k: 'heading', level: head[1].length, text: stripMarkers(head[2]), cut: false });
      pendingPara = true;
      continue;
    }
    const noteM = row.match(NOTE_RE);
    const isNote = !!noteM && !cut;
    const body = isNote ? noteM![1] : row;

    const lineIdx = doc.lines.length;
    const firstToken = doc.tokens.length;
    const res = parseInline(body, cut, lineIdx, doc, !isNote);
    cut = res.cut;
    doc.blocks.push({ k: 'line', line: lineIdx, pieces: res.pieces, para: pendingPara, note: isNote });
    doc.lines.push({ block: doc.blocks.length - 1, firstToken, endToken: doc.tokens.length });
    pendingPara = false;
  }
  return doc;
}

function stripMarkers(s: string): string {
  return s.replace(/\\(.)/g, '$1').replace(/\*\*|==|~~|[*_]/g, '');
}

function parseInline(
  s: string,
  cutIn: boolean,
  lineIdx: number,
  doc: ScriptDoc,
  tracked: boolean,
): { pieces: Piece[]; cut: boolean } {
  const pieces: Piece[] = [];
  const st = { stress: false, strong: false, under: false, hl: false, cut: cutIn };
  let frags: Frag[] = [];
  let buf = '';

  const styles = (): Style[] => {
    const out: Style[] = [];
    if (st.stress) out.push('stress');
    if (st.strong) out.push('strong');
    if (st.under) out.push('under');
    if (st.hl) out.push('hl');
    if (st.cut) out.push('cut');
    return out;
  };
  const flushFrag = () => {
    if (buf) frags.push({ text: buf, styles: styles() });
    buf = '';
  };
  const endWord = () => {
    flushFrag();
    if (!frags.length) return;
    const text = frags.map((f) => f.text).join('');
    const isCut = frags.every((f) => f.styles.includes('cut'));
    const word: Word = { id: doc.words.length, frags, tokens: [], line: lineIdx, cut: isCut };
    if (tracked && !isCut) {
      for (const t of tokenize(text)) {
        word.tokens.push(doc.tokens.length);
        doc.tokens.push({ t, word: word.id, line: lineIdx });
      }
    }
    doc.words.push(word);
    pieces.push({ k: 'w', w: word });
    frags = [];
  };
  const toggle = (k: keyof typeof st) => {
    flushFrag();
    st[k] = !st[k];
  };
  const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
  const isWordCh = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const two = s.slice(i, i + 2);
    if (c === '\\' && i + 1 < s.length) {
      buf += s[++i];
      continue;
    }
    if (/\s/.test(c)) {
      endWord();
      continue;
    }
    if (two === '~~') { toggle('cut'); i++; continue; }
    if (two === '**') { toggle('strong'); i++; continue; }
    if (two === '==') { toggle('hl'); i++; continue; }
    if (c === '[') {
      const close = s.indexOf(']', i + 1);
      if (close > i) {
        endWord();
        pieces.push({ k: 'dir', text: s.slice(i + 1, close).trim(), cut: st.cut });
        i = close;
        continue;
      }
    }
    if (c === '/' && isSpace(s[i - 1])) {
      const long = s[i + 1] === '/';
      const after = s[i + (long ? 2 : 1)];
      if (isSpace(after)) {
        endWord();
        pieces.push({ k: 'pause', long, cut: st.cut });
        if (long) i++;
        continue;
      }
    }
    if (c === '*') { toggle('stress'); continue; }
    if (c === '_') {
      // only a marker at a word boundary, so snake_case stays literal
      if (!(isWordCh(s[i - 1]) && isWordCh(s[i + 1]))) { toggle('under'); continue; }
    }
    buf += c;
  }
  endWord();
  return { pieces, cut: st.cut };
}

/** Plain spoken text of a line (for debugging / tests). */
export function lineText(doc: ScriptDoc, line: number): string {
  const b = doc.blocks[doc.lines[line].block];
  if (b.k !== 'line') return '';
  return b.pieces
    .filter((p): p is { k: 'w'; w: Word } => p.k === 'w' && !p.w.cut)
    .map((p) => p.w.frags.map((f) => f.text).join(''))
    .join(' ');
}
