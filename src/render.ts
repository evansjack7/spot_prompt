import type { Block, Piece, ScriptDoc, Word } from './markup';

export type RenderMode = 'prompter' | 'preview';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function wordHtml(w: Word, mode: RenderMode): string {
  if (w.cut && mode === 'prompter') return '';
  const inner = w.frags
    .filter((f) => mode === 'preview' || !f.styles.includes('cut'))
    .map((f) => (f.styles.length ? `<span class="${f.styles.map((s) => 's-' + s).join(' ')}">${esc(f.text)}</span>` : esc(f.text)))
    .join('');
  const t = w.tokens.length ? ` data-t="${w.tokens[0]}"` : '';
  return `<span class="w${w.cut ? ' s-cut' : ''}"${t}>${inner}</span>`;
}

function pieceHtml(p: Piece, mode: RenderMode, showDirections: boolean): string {
  if (p.k === 'w') return wordHtml(p.w, mode);
  if (p.cut && mode === 'prompter') return '';
  if (p.k === 'dir') return showDirections ? `<span class="dir${p.cut ? ' s-cut' : ''}">${esc(p.text)}</span>` : '';
  return `<span class="pause${p.long ? ' long' : ''}${p.cut ? ' s-cut' : ''}" aria-label="pause">${p.long ? '‖' : '/'}</span>`;
}

function lineVisible(b: Extract<Block, { k: 'line' }>, mode: RenderMode, showDirections: boolean): boolean {
  if (mode === 'preview') return true;
  return b.pieces.some((p) => (p.k === 'w' ? !p.w.cut : !p.cut && (p.k === 'pause' || showDirections)));
}

export function renderDoc(doc: ScriptDoc, mode: RenderMode, opts: { showDirections?: boolean } = {}): string {
  const showDir = opts.showDirections ?? true;
  const out: string[] = [];
  let firstVisible = true;
  for (const b of doc.blocks) {
    switch (b.k) {
      case 'line': {
        if (!lineVisible(b, mode, showDir)) continue;
        if (b.note && !showDir && mode === 'prompter') continue;
        const cls = ['ln'];
        if (b.para && !firstVisible) cls.push('para');
        if (b.note) cls.push('note');
        const body = b.pieces.map((p) => pieceHtml(p, mode, showDir)).filter(Boolean).join(' ');
        out.push(`<p class="${cls.join(' ')}" data-line="${b.line}">${body}</p>`);
        break;
      }
      case 'heading':
        out.push(`<h${b.level + 1} class="hd">${esc(b.text)}</h${b.level + 1}>`);
        break;
      case 'take':
        out.push(`<div class="take"><span class="take-n">TAKE ${b.n}</span>${b.label ? `<span class="take-l">${esc(b.label.replace(/^take\s*\d+\s*[:\-–]?\s*/i, ''))}</span>` : ''}</div>`);
        break;
      case 'page':
        out.push('<div class="page" aria-hidden="true"></div>');
        break;
    }
    firstVisible = false;
  }
  return out.join('\n');
}
