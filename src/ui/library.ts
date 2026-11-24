import { createScript, deleteScript, listScripts, saveScript, type Script } from '../store';
import { download, h, pickFile, toast } from './dom';
import { openSettings } from './settings';

export function libraryView(root: HTMLElement): () => void {
  const list = h('div', { class: 'lib-list' });

  const render = () => {
    list.replaceChildren();
    const scripts = listScripts();
    if (!scripts.length) list.append(h('p', { class: 'empty' }, 'No scripts yet. Create one or paste from anywhere.'));
    for (const s of scripts) list.append(card(s));
  };

  const card = (s: Script) => {
    const preview = s.body.replace(/[#*_=~\[\]>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
    const words = s.body.split(/\s+/).filter(Boolean).length;
    const more = h('details', { class: 'more' },
      h('summary', { 'aria-label': 'More actions' }, '⋯'),
      h('div', { class: 'menu' },
        h('button', { onclick: () => { createScript(s.title + ' (copy)', s.body); render(); } }, 'Duplicate'),
        h('button', { onclick: () => download(safeName(s.title) + '.txt', s.body) }, 'Export .txt'),
        h('button', {
          class: 'danger',
          onclick: () => { if (confirm(`Delete “${s.title}”?`)) { deleteScript(s.id); render(); } },
        }, 'Delete'),
      ),
    );
    return h('article', { class: 'card' },
      h('a', { class: 'card-main', href: `#/edit/${s.id}` },
        h('h3', {}, s.title || 'Untitled'),
        h('p', {}, preview || '(empty)'),
        h('small', {}, `${words} words · ~${Math.max(1, Math.round(words / 150))} min · ${new Date(s.updated).toLocaleDateString()}`),
      ),
      h('div', { class: 'card-actions' },
        h('a', { class: 'btn primary', href: `#/prompt/${s.id}` }, '▶ Prompt'),
        more,
      ),
    );
  };

  const newScript = () => {
    const s = createScript('Untitled script', '');
    location.hash = `#/edit/${s.id}`;
  };
  const pasteNew = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return toast('Clipboard is empty');
      const s = createScript(text.trim().split('\n')[0].slice(0, 50) || 'Pasted script', text);
      location.hash = `#/edit/${s.id}`;
    } catch {
      toast('Clipboard blocked: create a new script and paste into the editor');
    }
  };
  const importFile = async () => {
    const f = await pickFile('.txt,.md,.fountain,text/plain');
    if (!f) return;
    const s = createScript(f.name.replace(/\.[^.]+$/, ''), await f.text());
    saveScript(s);
    location.hash = `#/edit/${s.id}`;
  };

  root.replaceChildren(
    h('header', { class: 'bar' },
      h('h1', { class: 'logo' }, h('span', { class: 'dot' }), 'SpotPrompt'),
      h('div', { class: 'spacer' }),
      h('span', { class: 'net-pill', id: 'net' }),
      h('button', { class: 'icon', 'aria-label': 'Settings', onclick: () => openSettings() }, '⚙'),
    ),
    h('main', { class: 'lib' },
      h('div', { class: 'lib-actions' },
        h('button', { class: 'btn primary', onclick: newScript }, '+ New script'),
        h('button', { class: 'btn', onclick: pasteNew }, 'Paste as new'),
        h('button', { class: 'btn', onclick: importFile }, 'Import file'),
      ),
      list,
    ),
  );
  const net = root.querySelector('#net')!;
  const updNet = () => { net.textContent = navigator.onLine ? 'online' : 'offline'; net.className = 'net-pill ' + (navigator.onLine ? 'on' : 'off'); };
  updNet();
  addEventListener('online', updNet);
  addEventListener('offline', updNet);
  render();
  return () => { removeEventListener('online', updNet); removeEventListener('offline', updNet); };
}

function safeName(s: string) {
  return s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'script';
}
