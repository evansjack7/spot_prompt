// Convert pasted rich text (Google Docs, Word, web pages) into SpotPrompt markup.
//   bold → **strong**   italic → *stress*   underline → _under_
//   strike → ~~cut~~    highlight → ==hl==   headings → #
type S = 'cut' | 'hl' | 'strong' | 'stress' | 'under';
const ORDER: S[] = ['cut', 'hl', 'strong', 'stress', 'under'];
const MARK: Record<S, string> = { cut: '~~', hl: '==', strong: '**', stress: '*', under: '_' };

const BLOCK = new Set(['P', 'DIV', 'LI', 'TR', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'UL', 'OL', 'TABLE', 'PRE']);
const PARA = new Set(['P', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'PRE']);
const SKIP = new Set(['STYLE', 'SCRIPT', 'HEAD', 'META', 'TITLE', 'XML']);

function ownStyles(el: HTMLElement): Set<S> {
  const out = new Set<S>();
  const tag = el.tagName;
  const st = el.style;
  const fw = st?.fontWeight;
  const bold = tag === 'B' || tag === 'STRONG';
  const boldOff = fw === 'normal' || fw === '400' || (fw !== '' && fw !== undefined && +fw < 600);
  if ((bold && !boldOff) || (fw && (fw === 'bold' || +fw >= 600))) out.add('strong');
  if (tag === 'I' || tag === 'EM' || st?.fontStyle === 'italic') out.add('stress');
  const deco = `${st?.textDecoration ?? ''} ${st?.textDecorationLine ?? ''}`;
  if (tag === 'U' || tag === 'INS' || deco.includes('underline')) out.add('under');
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || deco.includes('line-through')) out.add('cut');
  const bg = st?.backgroundColor;
  if (tag === 'MARK' || (bg && !/^(transparent|initial|inherit|rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|#?fff(fff)?|white|rgb\(\s*255,\s*255,\s*255\s*\))$/i.test(bg.trim()))) out.add('hl');
  return out;
}

function wrap(inner: string, styles: S[]): string {
  if (!styles.length || !inner.trim()) return inner;
  const lead = inner.match(/^\s*/)![0];
  const trail = inner.match(/\s*$/)![0];
  const core = inner.trim();
  const open = styles.map((s) => MARK[s]).join('');
  const close = [...styles].reverse().map((s) => MARK[s]).join('');
  // markers can't wrap line breaks cleanly except cut; wrap each line separately
  if (core.includes('\n')) {
    return lead + core.split('\n').map((l) => (l.trim() ? open + l.trim() + close : l)).join('\n') + trail;
  }
  return lead + open + core + close + trail;
}

function render(node: Node, active: Set<S>): string {
  if (node.nodeType === 3) {
    return (node.nodeValue ?? '').replace(/[\s ]+/g, ' ').replace(/([*_~=[\]\\])/g, '\\$1');
  }
  if (node.nodeType !== 1) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (SKIP.has(tag)) return '';
  if (tag === 'BR') return '\n';

  const h = tag.match(/^H([1-6])$/);
  const own = ownStyles(el);
  const now = new Set([...active, ...own]);
  let inner = '';
  for (const c of Array.from(el.childNodes)) inner += render(c, h ? new Set(['strong']) : now);

  if (h) {
    const text = inner.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return `\n\n${'#'.repeat(Math.min(3, +h[1]))} ${text}\n\n`;
  }
  const added = ORDER.filter((s) => own.has(s) && !active.has(s));
  let out = wrap(inner, added);
  if (BLOCK.has(tag)) out = PARA.has(tag) ? `\n\n${out}\n\n` : `\n${out}\n`;
  return out;
}

export function htmlToMarkup(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const raw = render(doc.body, new Set());
  return raw
    .split('\n')
    .map((l) => l.replace(/^ +| +$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
