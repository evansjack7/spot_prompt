import { parseScript } from '../markup';
import { htmlToMarkup } from '../paste';
import { renderDoc } from '../render';
import { getScript, saveScript } from '../store';
import { h, toast } from './dom';

type Tool = { label: string; title: string; run: (ta: HTMLTextAreaElement) => void; cls?: string };

function insert(ta: HTMLTextAreaElement, text: string, selectFrom?: number, selectTo?: number) {
  ta.focus();
  const start = ta.selectionStart;
  // execCommand keeps the native undo stack; fall back if unavailable
  if (!document.execCommand?.('insertText', false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }
  if (selectFrom != null) ta.setSelectionRange(start + selectFrom, start + (selectTo ?? selectFrom));
}

function wrap(open: string, close = open, placeholder = 'text'): Tool['run'] {
  return (ta) => {
    let sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    // keep surrounding whitespace outside the markers
    const lead = sel.match(/^\s*/)![0];
    const trail = sel.match(/\s*$/)![0];
    sel = sel.trim();
    if (!sel) return insert(ta, open + placeholder + close, open.length, open.length + placeholder.length);
    insert(ta, lead + open + sel + close + trail);
  };
}

function linePrefix(prefix: string): Tool['run'] {
  return (ta) => {
    const v = ta.value;
    const ls = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    ta.setSelectionRange(ls, ls);
    insert(ta, prefix);
  };
}

function ownLine(text: string): Tool['run'] {
  return (ta) => {
    const v = ta.value;
    const before = v.slice(0, ta.selectionStart);
    const pre = before.length && !before.endsWith('\n') ? '\n' : '';
    insert(ta, `${pre}${text}\n`);
  };
}

const TOOLS: Tool[] = [
  { label: 'B', title: 'Strong stress  **word**', run: wrap('**'), cls: 't-strong' },
  { label: 'I', title: 'Stress  *word*', run: wrap('*'), cls: 't-stress' },
  { label: 'U', title: 'Underline / lean on it  _word_', run: wrap('_'), cls: 't-under' },
  { label: 'HL', title: 'Highlight  ==words==', run: wrap('=='), cls: 't-hl' },
  { label: '/', title: 'Short pause', run: (ta) => insert(ta, ' / ') },
  { label: '‖', title: 'Long beat  //', run: (ta) => insert(ta, ' // ') },
  { label: '[ ]', title: 'Direction / cue (not read)  [smile]', run: wrap('[', ']', 'direction') },
  { label: 'Note', title: 'Presenter note line  > note', run: linePrefix('> ') },
  { label: 'Cut', title: 'Cut: hidden in the prompter  ~~text~~', run: wrap('~~'), cls: 't-cut' },
  { label: 'H', title: 'Section heading  # Heading', run: linePrefix('# ') },
  { label: 'Take', title: 'Take break  --- label', run: ownLine('--- Take') },
  { label: 'Page', title: 'Page break: next text starts on a fresh screen  +++', run: ownLine('+++') },
];

const HELP = `
<h3>Formatting</h3>
<table>
<tr><td><code>**word**</code></td><td>Strong stress</td></tr>
<tr><td><code>*word*</code></td><td>Stress</td></tr>
<tr><td><code>_word_</code></td><td>Underline / lean on it</td></tr>
<tr><td><code>==words==</code></td><td>Highlight</td></tr>
<tr><td><code>/</code> &nbsp; <code>//</code></td><td>Short pause / long beat (with spaces around)</td></tr>
<tr><td><code>[smile]</code></td><td>Direction or cue, shown small, never needs to be read</td></tr>
<tr><td><code>&gt; note</code></td><td>Presenter note line, not tracked</td></tr>
<tr><td><code>~~text~~</code></td><td>Cut: hidden in the prompter, can span lines</td></tr>
<tr><td><code># Heading</code></td><td>Section heading</td></tr>
<tr><td><code>--- Take 2: intro</code></td><td>Take break</td></tr>
<tr><td><code>+++</code></td><td>Page break, next text starts on a fresh screen</td></tr>
<tr><td>new line / blank line</td><td>Line break / paragraph break</td></tr>
<tr><td><code>\\*</code></td><td>Literal character</td></tr>
</table>
<p>Pasting from Google Docs, Word or a web page keeps <b>bold</b> (strong), <i>italic</i> (stress), <u>underline</u>, strikethrough (cut) and highlights. Use <kbd>Ctrl/Cmd+Shift+V</kbd> to paste plain text.</p>
<p>Voice tracking follows any visible words. Directions, notes, headings and cuts are skipped automatically.</p>`;

export function editorView(root: HTMLElement, id: string): () => void {
  const script = getScript(id);
  if (!script) {
    location.hash = '#/';
    return () => {};
  }
  const title = h('input', { class: 'title-input', value: script.title, 'aria-label': 'Script title', placeholder: 'Script title' });
  const ta = h('textarea', {
    class: 'src',
    spellcheck: true,
    placeholder: 'Paste or type your script here…\n\nTip: blank line = new paragraph, --- = take break, [cue] = direction.',
    'aria-label': 'Script text',
  });
  ta.value = script.body;
  const preview = h('div', { class: 'preview prompter-text theme-dark' });
  const stats = h('span', { class: 'stats' });
  const help = h('div', { class: 'help', html: HELP, hidden: true });
  const panes = h('div', { class: 'panes show-write' }, ta, preview);

  let saveT = 0;
  let prevT = 0;
  const save = () => {
    script.body = ta.value;
    script.title = title.value.trim() || 'Untitled script';
    script.updated = Date.now();
    saveScript(script);
  };
  const updatePreview = () => {
    const doc = parseScript(ta.value);
    preview.innerHTML = renderDoc(doc, 'preview');
    const words = doc.tokens.length;
    stats.textContent = `${words} spoken words · ~${Math.max(1, Math.round(words / 150))} min`;
  };
  const changed = () => {
    clearTimeout(saveT);
    clearTimeout(prevT);
    saveT = window.setTimeout(save, 400);
    prevT = window.setTimeout(updatePreview, 150);
  };
  ta.addEventListener('input', changed);
  title.addEventListener('input', changed);

  ta.addEventListener('paste', (e) => {
    const html = e.clipboardData?.getData('text/html');
    if (!html) return; // plain text paste: let the browser do it
    e.preventDefault();
    const md = htmlToMarkup(html);
    insert(ta, md);
    toast('Pasted with formatting');
  });

  ta.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    const tool = k === 'b' ? TOOLS[0] : k === 'i' ? TOOLS[1] : k === 'u' ? TOOLS[2] : null;
    if (tool) { e.preventDefault(); tool.run(ta); }
  });

  const toolbar = h('div', { class: 'toolbar', role: 'toolbar' },
    ...TOOLS.map((t) => h('button', {
      class: 'tool ' + (t.cls ?? ''), title: t.title, 'aria-label': t.title,
      onmousedown: (e: Event) => e.preventDefault(), // keep textarea selection
      onclick: () => t.run(ta),
    }, t.label)),
    h('button', { class: 'tool', title: 'Formatting help', onclick: () => { help.hidden = !help.hidden; } }, '?'),
  );

  const tabs = h('div', { class: 'tabs' },
    h('button', { class: 'tab active', 'data-tab': 'write' }, 'Write'),
    h('button', { class: 'tab', 'data-tab': 'preview' }, 'Preview'),
  );
  tabs.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    tabs.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    panes.className = 'panes show-' + b.dataset.tab;
  });

  root.replaceChildren(
    h('header', { class: 'bar' },
      h('a', { class: 'icon', href: '#/', 'aria-label': 'Back to library', onclick: save }, '←'),
      title,
      h('a', { class: 'btn primary', href: `#/prompt/${id}`, onclick: save }, '▶ Prompt'),
    ),
    toolbar,
    help,
    h('div', { class: 'editor-sub' }, tabs, stats),
    panes,
  );
  updatePreview();
  if (!ta.value) ta.focus();
  const onHide = () => { if (document.visibilityState === 'hidden') save(); };
  document.addEventListener('visibilitychange', onHide);

  return () => {
    document.removeEventListener('visibilitychange', onHide);
    clearTimeout(saveT);
    clearTimeout(prevT);
    save();
  };
}
