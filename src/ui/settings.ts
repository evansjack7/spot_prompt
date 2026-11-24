import { loadSettings, saveSettings, type Settings } from '../store';
import { importModelFile, isModelCached, loadModel, modelUrlFor, VOSK_MODELS } from '../speech/vosk';
import { installWebSpeechLocal, webSpeechCtor, webSpeechLocalAvailability } from '../speech/webspeech';
import { h, pickFile, toast } from './dom';

type Field =
  | { k: keyof Settings; label: string; type: 'range'; min: number; max: number; step: number; fmt?: (v: number) => string }
  | { k: keyof Settings; label: string; type: 'bool' }
  | { k: keyof Settings; label: string; type: 'select'; options: [string, string][] };

const DISPLAY: Field[] = [
  { k: 'theme', label: 'Colours', type: 'select', options: [['dark', 'White on black'], ['yellow', 'Yellow on black'], ['green', 'Green on black'], ['light', 'Black on white']] },
  { k: 'font', label: 'Font', type: 'select', options: [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']] },
  { k: 'fontPortrait', label: 'Text size (portrait)', type: 'range', min: 18, max: 160, step: 2, fmt: (v) => v + 'px' },
  { k: 'fontLandscape', label: 'Text size (landscape)', type: 'range', min: 18, max: 220, step: 2, fmt: (v) => v + 'px' },
  { k: 'lineHeight', label: 'Line spacing', type: 'range', min: 1, max: 2.2, step: 0.05, fmt: (v) => v.toFixed(2) },
  { k: 'margin', label: 'Side margins', type: 'range', min: 0, max: 30, step: 1, fmt: (v) => v + '%' },
  { k: 'marker', label: 'Reading line position', type: 'range', min: 10, max: 70, step: 1, fmt: (v) => v + '% from top' },
  { k: 'uppercase', label: 'ALL CAPS', type: 'bool' },
  { k: 'dimRead', label: 'Dim text already read', type: 'bool' },
  { k: 'showDirections', label: 'Show directions & notes', type: 'bool' },
  { k: 'mirrorX', label: 'Mirror horizontally (beam-splitter glass)', type: 'bool' },
  { k: 'mirrorY', label: 'Flip vertically', type: 'bool' },
  { k: 'rotate', label: 'Rotate text', type: 'select', options: [['0', 'None'], ['90', '90° clockwise'], ['270', '90° counter-clockwise']] },
  { k: 'orientationLock', label: 'Lock orientation (fullscreen)', type: 'select', options: [['auto', 'Follow device'], ['portrait', 'Portrait'], ['landscape', 'Landscape']] },
];

const TRACKING: Field[] = [
  { k: 'engine', label: 'Speech engine', type: 'select', options: [['auto', 'Automatic (best available)'], ['vosk', 'Offline (Vosk, on-device)'], ['webspeech', 'Browser speech (Chrome)']] },
  { k: 'webSpeechLocal', label: 'Browser speech: on-device only', type: 'bool' },
  { k: 'lang', label: 'Language', type: 'select', options: [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-AU', 'English (AU)'], ['en-CA', 'English (CA)']] },
  { k: 'sensitivity', label: 'Words needed to move', type: 'range', min: 1.2, max: 4.5, step: 0.1, fmt: (v) => (v < 1.8 ? 'loose' : v < 2.8 ? 'normal' : 'strict') + ` (${v.toFixed(1)})` },
  { k: 'followRetakes', label: 'Jump back when I re-read a line', type: 'bool' },
  { k: 'voskGrammar', label: 'Offline: limit vocabulary to the script (more accurate, worse at tangents)', type: 'bool' },
  { k: 'showTranscript', label: 'Show what the mic hears', type: 'bool' },
  { k: 'autoSpeed', label: 'Auto-scroll speed (no voice)', type: 'range', min: 10, max: 300, step: 5, fmt: (v) => v + ' px/s' },
];

function fieldEl(f: Field, s: Settings, set: (k: keyof Settings, v: unknown) => void): HTMLElement {
  const id = 'set-' + f.k;
  const val = s[f.k];
  if (f.type === 'bool') {
    const i = h('input', { type: 'checkbox', id, checked: !!val, onchange: (e: Event) => set(f.k, (e.target as HTMLInputElement).checked) });
    return h('label', { class: 'row bool', for: id }, h('span', {}, f.label), i);
  }
  if (f.type === 'select') {
    const sel = h('select', { id, onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; set(f.k, f.k === 'rotate' ? +v : v); } },
      ...f.options.map(([v, l]) => h('option', { value: v, selected: String(val) === v }, l)));
    return h('label', { class: 'row', for: id }, h('span', {}, f.label), sel);
  }
  const out = h('output', {}, f.fmt ? f.fmt(val as number) : String(val));
  const r = h('input', {
    type: 'range', id, min: f.min, max: f.max, step: f.step, value: String(val),
    oninput: (e: Event) => { const v = +(e.target as HTMLInputElement).value; out.textContent = f.fmt ? f.fmt(v) : String(v); set(f.k, v); },
  });
  return h('label', { class: 'row range', for: id }, h('span', {}, f.label, ' ', out), r);
}

async function engineStatus(s: Settings, box: HTMLElement) {
  box.replaceChildren(h('p', { class: 'muted' }, 'Checking speech engines…'));
  const url = modelUrlFor(s.voskModel);
  const cached = await isModelCached(url);
  const hasWeb = !!webSpeechCtor();
  const local = hasWeb ? await webSpeechLocalAvailability(s.lang) : 'unsupported';

  const dl = h('button', { class: 'btn' + (cached ? '' : ' primary') }, cached ? 'Re-check offline model' : 'Download offline model (≈40 MB)');
  dl.addEventListener('click', async () => {
    if (!navigator.onLine && !cached) return toast('Connect to the internet once to download the model');
    dl.disabled = true;
    dl.textContent = 'Downloading & unpacking… keep this open';
    try {
      await loadModel(url);
      toast('Offline speech model ready ✓');
    } catch (e) {
      toast('Download failed: ' + String(e), 5000);
    }
    engineStatus(s, box);
  });
  const imp = h('button', { class: 'btn' }, 'Import model file…');
  imp.addEventListener('click', async () => {
    const f = await pickFile('.tar.gz,.tgz,application/gzip');
    if (!f) return;
    await importModelFile(f);
    const cur = loadSettings();
    cur.voskModel = 'imported';
    saveSettings(cur);
    s.voskModel = 'imported';
    toast('Model imported, unpacking…');
    try { await loadModel(modelUrlFor('imported')); toast('Imported model ready ✓'); } catch (e) { toast('Model failed to load: ' + String(e), 5000); }
    engineStatus(s, box);
  });

  const rows: HTMLElement[] = [
    h('p', {}, h('b', {}, 'Offline (Vosk): '), cached ? '✅ model on this device, works with no signal' : '⬇️ not downloaded yet'),
    h('div', { class: 'btn-row' }, dl, imp),
    h('p', {}, h('b', {}, 'Browser speech: '),
      !hasWeb ? '❌ not supported in this browser'
        : local === 'available' ? '✅ on-device recognition installed (works offline)'
          : local === 'downloadable' ? '⬇️ on-device pack available to install'
            : local === 'downloading' ? '⏳ on-device pack downloading…'
              : '🌐 needs internet in this browser'),
  ];
  if (local === 'downloadable') {
    const b = h('button', { class: 'btn' }, `Install on-device ${s.lang} pack`);
    b.addEventListener('click', async () => {
      b.disabled = true;
      const ok = await installWebSpeechLocal(s.lang);
      toast(ok ? 'Installing… this can take a minute' : 'Install not available');
      setTimeout(() => engineStatus(s, box), 3000);
    });
    rows.push(h('div', { class: 'btn-row' }, b));
  }
  rows.push(h('p', { class: 'muted' }, `Automatic picks: ${local === 'available' ? 'browser on-device' : cached ? 'offline Vosk' : navigator.onLine && hasWeb ? 'browser speech (online)' : 'offline Vosk (download needed)'}.`));
  rows.push(h('label', { class: 'row' }, h('span', {}, 'Offline model'),
    h('select', { onchange: (e: Event) => { const c = loadSettings(); c.voskModel = (e.target as HTMLSelectElement).value; saveSettings(c); s.voskModel = c.voskModel; engineStatus(s, box); } },
      ...VOSK_MODELS.map((m) => h('option', { value: m.id, selected: s.voskModel === m.id }, m.label)),
      h('option', { value: 'imported', selected: s.voskModel === 'imported' }, 'Imported model file'))));
  box.replaceChildren(...rows);
}

/** Open the settings sheet. `onChange` fires live as values change. */
export function openSettings(onChange?: (s: Settings) => void, section: 'display' | 'tracking' = 'display') {
  const s = loadSettings();
  const set = (k: keyof Settings, v: unknown) => {
    (s as unknown as Record<string, unknown>)[k] = v;
    saveSettings(s);
    onChange?.(s);
  };
  const engineBox = h('div', { class: 'engine-box' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const disp = h('section', { class: 'sec', hidden: section !== 'display' }, ...DISPLAY.map((f) => fieldEl(f, s, set)));
  const trk = h('section', { class: 'sec', hidden: section !== 'tracking' }, engineBox, ...TRACKING.map((f) => fieldEl(f, s, set)));
  const tabD = h('button', { class: 'tab' + (section === 'display' ? ' active' : '') }, 'Display');
  const tabT = h('button', { class: 'tab' + (section === 'tracking' ? ' active' : '') }, 'Voice tracking');
  tabD.onclick = () => { disp.hidden = false; trk.hidden = true; tabD.classList.add('active'); tabT.classList.remove('active'); };
  tabT.onclick = () => { disp.hidden = true; trk.hidden = false; tabT.classList.add('active'); tabD.classList.remove('active'); };

  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => { if (e.target === overlay) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Settings' },
      h('header', {}, h('div', { class: 'tabs' }, tabD, tabT), h('button', { class: 'icon', 'aria-label': 'Close', onclick: close }, '✕')),
      h('div', { class: 'sheet-body' }, disp, trk),
    ),
  );
  document.body.append(overlay);
  document.addEventListener('keydown', esc);
  engineStatus(s, engineBox);
}
