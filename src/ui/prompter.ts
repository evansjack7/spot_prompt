import { parseScript } from '../markup';
import { tokenize } from '../normalize';
import { renderDoc } from '../render';
import { getScript, loadSettings, saveScript, saveSettings, type Settings } from '../store';
import { Tracker } from '../tracker';
import type { EngineState, SpeechEngine } from '../speech/types';
import { isModelCached, modelUrlFor, VoskEngine } from '../speech/vosk';
import { WebSpeechEngine, webSpeechCtor, webSpeechLocalAvailability } from '../speech/webspeech';
import { h, toast } from './dom';
import { openSettings } from './settings';

type Mode = 'idle' | 'voice' | 'auto';

export function prompterView(root: HTMLElement, id: string): () => void {
  const script = getScript(id);
  if (!script) { location.hash = '#/'; return () => {}; }
  let s = loadSettings();
  const doc = parseScript(script.body);
  const tracker = new Tracker(doc, { minWeight: s.sensitivity, followRetakes: s.followRetakes });
  if (script.pos && script.pos < tracker.length) tracker.setPos(script.pos);

  // ---------- DOM ----------
  const content = h('div', { class: 'content prompter-text' });
  const viewport = h('div', { class: 'viewport' }, content);
  const marker = h('div', { class: 'marker', 'aria-hidden': 'true' }, h('span', { class: 'arrow' }, '▶'));
  const mirror = h('div', { class: 'mirror' }, viewport, marker);
  const stage = h('div', { class: 'stage' }, mirror);
  const progress = h('div', { class: 'progress' }, h('i'));
  const status = h('span', { class: 'status' }, 'Ready');
  const level = h('span', { class: 'level' }, h('i'));
  const timer = h('span', { class: 'timer' }, '0:00');
  const transcript = h('div', { class: 'transcript', hidden: !s.showTranscript });
  const micBtn = h('button', { class: 'hud-btn mic', 'aria-label': 'Start voice tracking (Space)', title: 'Voice tracking (Space)' }, '🎙');
  const autoBtn = h('button', { class: 'hud-btn', 'aria-label': 'Auto-scroll', title: 'Auto-scroll without voice (A)' }, '⏵');
  const hudTop = h('div', { class: 'hud top' },
    h('a', { class: 'hud-btn', href: `#/edit/${id}`, 'aria-label': 'Exit to editor (Esc)', title: 'Exit (Esc)' }, '✕'),
    h('span', { class: 'hud-title' }, script.title),
    level, status, timer,
    h('button', { class: 'hud-btn', 'aria-label': 'Fullscreen', title: 'Fullscreen (F)', onclick: () => toggleFullscreen() }, '⛶'),
    h('button', { class: 'hud-btn', 'aria-label': 'Settings', title: 'Settings', onclick: () => openSettings(applySettings) }, '⚙'),
  );
  const hudBottom = h('div', { class: 'hud bottom' },
    h('button', { class: 'hud-btn', 'aria-label': 'Back to start', title: 'Back to start (Home)', onclick: () => jumpTo(0) }, '⏮'),
    h('button', { class: 'hud-btn', 'aria-label': 'Previous line', title: 'Previous line (↑)', onclick: () => step(-1) }, '▲'),
    micBtn,
    h('button', { class: 'hud-btn', 'aria-label': 'Next line', title: 'Next line (↓)', onclick: () => step(1) }, '▼'),
    autoBtn,
    h('span', { class: 'sep' }),
    h('button', { class: 'hud-btn', 'aria-label': 'Smaller text', title: 'Smaller (-)', onclick: () => zoom(-4) }, 'A−'),
    h('button', { class: 'hud-btn', 'aria-label': 'Bigger text', title: 'Bigger (+)', onclick: () => zoom(4) }, 'A+'),
    h('button', { class: 'hud-btn', 'aria-label': 'Mirror', title: 'Mirror (M)', onclick: () => { s.mirrorX = !s.mirrorX; persist(); } }, '⇋'),
  );
  const wrapper = h('div', { class: 'prompter' }, stage, progress, hudTop, hudBottom, transcript);
  root.replaceChildren(wrapper);

  // ---------- state ----------
  let tokEl: HTMLElement[] = [];
  let lineEl = new Map<number, HTMLElement>();
  let readTo = 0;
  let curLineEl: HTMLElement | null = null;
  let offset = 0;
  let target = 0;
  let mode: Mode = 'idle';
  let engine: SpeechEngine | null = null;
  let committed: string[] = [];
  let interim: string[] = [];
  let elapsed = 0;
  let timerStart = 0;
  let stageW = 0, stageH = 0;
  let renderedDirections = s.showDirections;

  // ---------- rendering ----------
  function renderContent() {
    content.innerHTML = renderDoc(doc, 'prompter', { showDirections: s.showDirections }) +
      '<div class="end-mark">— END —</div>';
    renderedDirections = s.showDirections;
    tokEl = new Array(doc.tokens.length);
    content.querySelectorAll<HTMLElement>('.w[data-t]').forEach((el) => { tokEl[+el.dataset.t!] = el; });
    let last: HTMLElement | undefined;
    for (let t = 0; t < tokEl.length; t++) { if (tokEl[t]) last = tokEl[t]; else if (last) tokEl[t] = last; }
    lineEl = new Map();
    content.querySelectorAll<HTMLElement>('.ln[data-line]').forEach((el) => lineEl.set(+el.dataset.line!, el));
    readTo = 0;
    curLineEl = null;
    markRead();
  }

  function markRead() {
    const p = tracker.pos;
    if (p > readTo) for (let t = readTo; t < p; t++) tokEl[t]?.classList.add('read');
    else for (let t = p; t < readTo; t++) tokEl[t]?.classList.remove('read');
    // a word is only "read" once all its tokens are read
    if (p < tokEl.length && p > 0 && tokEl[p] === tokEl[p - 1]) tokEl[p]?.classList.remove('read');
    readTo = p;
    const line = lineEl.get(tracker.currentLine()) ?? null;
    if (line !== curLineEl) {
      curLineEl?.classList.remove('cur');
      line?.classList.add('cur');
      curLineEl = line;
    }
    (progress.firstChild as HTMLElement).style.width = (tracker.length ? (100 * tracker.pos) / tracker.length : 0) + '%';
  }

  function markerY() { return stageH * (s.marker / 100); }

  function retarget() {
    if (mode === 'auto') return;
    const el = tokEl[tracker.displayToken()];
    if (!el) { target = markerY() - 40; return; }
    // centre the current word's row on the reading band
    target = markerY() - (el.offsetTop + el.offsetHeight / 2);
  }

  function onPosChanged() {
    markRead();
    retarget();
  }

  // ---------- layout & settings ----------
  function layoutStage() {
    const W = wrapper.clientWidth, H = wrapper.clientHeight;
    const rot = s.rotate;
    stageW = rot ? H : W;
    stageH = rot ? W : H;
    stage.style.width = stageW + 'px';
    stage.style.height = stageH + 'px';
    stage.style.transform = rot === 90 ? `translate(${W}px,0) rotate(90deg)` : rot === 270 ? `translate(0,${H}px) rotate(-90deg)` : '';
    const landscape = stageW > stageH;
    wrapper.style.setProperty('--fs', (landscape ? s.fontLandscape : s.fontPortrait) + 'px');
    wrapper.style.setProperty('--page-h', stageH + 'px');
  }

  function applySettings(next?: Settings) {
    if (next) s = next;
    wrapper.className = `prompter theme-${s.theme} font-${s.font}` +
      (s.uppercase ? ' upper' : '') + (s.dimRead ? ' dim-read' : '') + (hudHidden ? ' hud-hidden' : '');
    wrapper.style.setProperty('--lh', String(s.lineHeight));
    wrapper.style.setProperty('--margin', s.margin + '%');
    wrapper.style.setProperty('--marker', s.marker + '%');
    mirror.style.transform = `scale(${s.mirrorX ? -1 : 1}, ${s.mirrorY ? -1 : 1})`;
    transcript.hidden = !s.showTranscript;
    tracker.opts.minWeight = s.sensitivity;
    tracker.opts.followRetakes = s.followRetakes;
    if (renderedDirections !== s.showDirections) renderContent();
    layoutStage();
    requestAnimationFrame(retarget);
  }
  function persist() { saveSettings(s); applySettings(); }

  function zoom(delta: number) {
    const landscape = stageW > stageH;
    if (landscape) s.fontLandscape = clamp(s.fontLandscape + delta, 18, 220);
    else s.fontPortrait = clamp(s.fontPortrait + delta, 18, 160);
    persist();
  }

  // ---------- navigation ----------
  function step(d: number) { tracker.stepLine(d); resetHeard(); onPosChanged(); }
  function jumpTo(tok: number) { tracker.setPos(tok); resetHeard(); onPosChanged(); }
  function resetHeard() { committed = []; interim = []; }

  /** After manual scrolling: make the line under the reading marker the current position. */
  function snapToMarker() {
    const y = markerY() - offset;
    let best: HTMLElement | null = null;
    for (const el of tokEl) {
      if (!el) continue;
      if (el.offsetTop <= y + 4) best = el; else break;
    }
    if (best) {
      const line = doc.words.find((w) => w.tokens[0] === +best!.dataset.t!)?.line;
      const first = line != null ? doc.lines[line].firstToken : +best.dataset.t!;
      tracker.setPos(first);
    } else tracker.setPos(0);
    resetHeard();
    markRead();
  }

  // ---------- speech ----------
  function setStatus(state: EngineState | 'auto', msg?: string) {
    status.className = 'status ' + state;
    status.textContent = msg ?? ({ idle: 'Ready', loading: 'Loading…', listening: 'Listening', error: 'Error', auto: 'Auto-scroll' } as const)[state];
    micBtn.classList.toggle('on', state === 'listening' || state === 'loading');
    level.hidden = !(state === 'listening' && engine?.id === 'vosk');
  }

  async function pickEngine(): Promise<SpeechEngine> {
    const handlers = {
      onText: (text: string, final: boolean) => {
        const words = tokenize(text);
        if (final) { committed.push(...words); interim = []; if (committed.length > 80) committed = committed.slice(-40); }
        else interim = words;
        const heard = [...committed.slice(-30), ...interim];
        if (tracker.hear(heard)) onPosChanged();
        if (s.showTranscript) transcript.textContent = heard.slice(-14).join(' ');
      },
      onState: (st: EngineState, msg?: string) => {
        if (st === 'error') { toast(msg ?? 'Speech error', 5000); stopVoice(); setStatus('error', 'Mic off'); return; }
        if (st === 'listening') startTimer();
        if (mode === 'voice' || st !== 'idle') setStatus(st, st === 'loading' ? msg : engineLabel);
      },
      onLevel: (v: number) => { (level.firstChild as HTMLElement).style.width = Math.round(v * 100) + '%'; },
      onProgress: (_p: number, m: string) => setStatus('loading', m),
    };
    const voskUrl = modelUrlFor(s.voskModel);
    const grammar = s.voskGrammar ? [...new Set(doc.tokens.map((t) => t.t))] : null;
    const hasWeb = !!webSpeechCtor();
    const local = hasWeb ? await webSpeechLocalAvailability(s.lang) : 'unsupported';
    let choice = s.engine;
    if (choice === 'auto') {
      if (local === 'available') choice = 'webspeech';
      else if (await isModelCached(voskUrl)) choice = 'vosk';
      else if (navigator.onLine && hasWeb) choice = 'webspeech';
      else choice = 'vosk';
    }
    if (choice === 'webspeech' && hasWeb) {
      const onDevice = s.webSpeechLocal && local === 'available';
      engineLabel = onDevice ? 'Listening · on-device' : 'Listening · online';
      return new WebSpeechEngine(handlers, s.lang, onDevice);
    }
    engineLabel = 'Listening · offline';
    return new VoskEngine(handlers, voskUrl, grammar);
  }
  let engineLabel = 'Listening';

  async function startVoice() {
    if (mode === 'auto') stopAuto();
    mode = 'voice';
    resetHeard();
    setStatus('loading', 'Starting mic…');
    engine = await pickEngine();
    if (mode !== 'voice') return;
    await engine.start();
  }
  function stopVoice() {
    engine?.stop();
    engine = null;
    if (mode === 'voice') mode = 'idle';
    stopTimer();
    setStatus('idle');
  }
  micBtn.addEventListener('click', () => (mode === 'voice' ? stopVoice() : startVoice()));

  function startAuto() {
    if (mode === 'voice') stopVoice();
    mode = 'auto';
    target = offset;
    autoBtn.textContent = '⏸';
    setStatus('auto');
    startTimer();
  }
  function stopAuto() {
    mode = 'idle';
    autoBtn.textContent = '⏵';
    stopTimer();
    snapToMarker();
    retarget();
    setStatus('idle');
  }
  autoBtn.addEventListener('click', () => (mode === 'auto' ? stopAuto() : startAuto()));

  // ---------- timer ----------
  function startTimer() { if (!timerStart) timerStart = performance.now(); }
  function stopTimer() { if (timerStart) { elapsed += performance.now() - timerStart; timerStart = 0; } }
  const fmt = (ms: number) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

  // ---------- animation loop ----------
  let raf = 0;
  let last = performance.now();
  let dragging = false;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!dragging) {
      if (mode === 'auto') { target -= s.autoSpeed * dt; offset = target; }
      else offset += (target - offset) * Math.min(1, dt * 5);
    }
    content.style.transform = `translate3d(0,${offset.toFixed(1)}px,0)`;
    timer.textContent = fmt(elapsed + (timerStart ? now - timerStart : 0));
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  // ---------- gestures ----------
  /** Convert a screen-space drag into content-space vertical movement. */
  function contentDelta(dx: number, dy: number) {
    let d = s.rotate === 90 ? -dx : s.rotate === 270 ? dx : dy;
    if (s.mirrorY) d = -d;
    return d;
  }
  const pointers = new Map<number, { x: number; y: number }>();
  let start = { x: 0, y: 0, off: 0 };
  let pinch0 = 0, pinchFont = 0;
  let lastTap = 0;
  let hudHidden = false;
  viewport.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.setPointerCapture(e.pointerId);
    if (pointers.size === 1) start = { x: e.clientX, y: e.clientY, off: offset };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      pinchFont = stageW > stageH ? s.fontLandscape : s.fontPortrait;
      dragging = false;
    }
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch0) {
      const [a, b] = [...pointers.values()];
      const f = Math.round(pinchFont * (Math.hypot(a.x - b.x, a.y - b.y) / pinch0));
      if (stageW > stageH) s.fontLandscape = clamp(f, 18, 220); else s.fontPortrait = clamp(f, 18, 160);
      layoutStage();
      retarget();
      offset = target;
      return;
    }
    const d = contentDelta(e.clientX - start.x, e.clientY - start.y);
    if (!dragging && Math.abs(d) > 10) dragging = true;
    if (dragging) { offset = start.off + d; if (mode === 'auto') target = offset; }
  });
  const endPointer = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch0 && pointers.size < 2) { pinch0 = 0; saveSettings(s); return; }
    if (dragging) {
      dragging = false;
      if (mode !== 'auto') { snapToMarker(); retarget(); }
      return;
    }
    if (pointers.size) return;
    // tap / double-tap
    const now = performance.now();
    if (now - lastTap < 320) {
      lastTap = 0;
      const w = (e.target as HTMLElement).closest<HTMLElement>('.w[data-t]');
      if (w) { jumpTo(+w.dataset.t!); w.classList.add('flash'); setTimeout(() => w.classList.remove('flash'), 400); }
    } else {
      lastTap = now;
      setTimeout(() => { if (lastTap === now) { hudHidden = !hudHidden; wrapper.classList.toggle('hud-hidden', hudHidden); } }, 330);
    }
  };
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);
  let wheelT = 0;
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    offset -= e.deltaY * (s.mirrorY ? -1 : 1);
    if (mode === 'auto') { target = offset; return; }
    dragging = true;
    clearTimeout(wheelT);
    wheelT = window.setTimeout(() => { dragging = false; snapToMarker(); retarget(); }, 250);
  }, { passive: false });

  // ---------- keyboard / remotes ----------
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('.overlay')) return;
    const k = e.key;
    if (k === ' ' || k === 'Enter' || k === 'MediaPlayPause') { e.preventDefault(); mode === 'auto' ? stopAuto() : mode === 'voice' ? stopVoice() : startVoice(); }
    else if (k === 'ArrowDown' || k === 'PageDown' || k === 'ArrowRight') { e.preventDefault(); if (mode === 'auto') target -= stageH * 0.25; else step(1); }
    else if (k === 'ArrowUp' || k === 'PageUp' || k === 'ArrowLeft') { e.preventDefault(); if (mode === 'auto') target += stageH * 0.25; else step(-1); }
    else if (k === 'Home') jumpTo(0);
    else if (k === '+' || k === '=') zoom(4);
    else if (k === '-' || k === '_') zoom(-4);
    else if (k === 'a' || k === 'A') mode === 'auto' ? stopAuto() : startAuto();
    else if (k === 'm' || k === 'M') { s.mirrorX = !s.mirrorX; persist(); }
    else if (k === 'f' || k === 'F') toggleFullscreen();
    else if (k === 'h' || k === 'H') { hudHidden = !hudHidden; wrapper.classList.toggle('hud-hidden', hudHidden); }
    else if (k === 'Escape' && !document.fullscreenElement) location.hash = `#/edit/${id}`;
  };
  document.addEventListener('keydown', onKey);

  // ---------- fullscreen / orientation / wake lock ----------
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await wrapper.requestFullscreen({ navigationUI: 'hide' });
      if (s.orientationLock !== 'auto') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (screen.orientation as any)?.lock?.(s.orientationLock).catch(() => toast('Orientation lock not supported here; use Rotate text instead'));
      }
    } catch { toast('Fullscreen not available'); }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let wake: any = null;
  const lockWake = async () => {
    try { wake = await (navigator as any).wakeLock?.request('screen'); } catch { /* ignore */ }
  };
  const savePos = () => {
    const fresh = getScript(id);
    if (fresh) { fresh.pos = tracker.pos >= tracker.length ? 0 : tracker.pos; saveScript(fresh); }
  };
  const onVis = () => { if (document.visibilityState === 'visible') lockWake(); else savePos(); };
  document.addEventListener('visibilitychange', onVis);
  lockWake();

  const ro = new ResizeObserver(() => { layoutStage(); requestAnimationFrame(() => { retarget(); }); });
  ro.observe(wrapper);

  // ---------- go ----------
  renderContent();
  applySettings();
  requestAnimationFrame(() => { retarget(); offset = target; });
  setStatus('idle', tracker.pos ? 'Resumed: tap 🎙' : 'Tap 🎙 to start');

  return () => {
    stopVoice();
    cancelAnimationFrame(raf);
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    wake?.release?.().catch?.(() => {});
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    savePos();
  };
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
