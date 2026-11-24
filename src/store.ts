export interface Script {
  id: string;
  title: string;
  body: string;
  updated: number;
  /** last tracked token position, for resuming */
  pos?: number;
}

export type Theme = 'dark' | 'yellow' | 'light' | 'green';
export type EngineChoice = 'auto' | 'vosk' | 'webspeech';

export interface Settings {
  theme: Theme;
  fontPortrait: number;
  fontLandscape: number;
  lineHeight: number;
  margin: number; // % each side
  marker: number; // % from top of screen
  mirrorX: boolean;
  mirrorY: boolean;
  rotate: 0 | 90 | 270;
  orientationLock: 'auto' | 'portrait' | 'landscape';
  uppercase: boolean;
  font: 'sans' | 'serif' | 'mono';
  dimRead: boolean;
  showDirections: boolean;
  showTranscript: boolean;
  engine: EngineChoice;
  webSpeechLocal: boolean;
  lang: string;
  voskModel: string;
  voskGrammar: boolean;
  sensitivity: number;
  followRetakes: boolean;
  autoSpeed: number; // px per second
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  fontPortrait: 44,
  fontLandscape: 64,
  lineHeight: 1.35,
  margin: 6,
  marker: 30,
  mirrorX: false,
  mirrorY: false,
  rotate: 0,
  orientationLock: 'auto',
  uppercase: false,
  font: 'sans',
  dimRead: true,
  showDirections: true,
  showTranscript: false,
  engine: 'auto',
  webSpeechLocal: true,
  lang: 'en-US',
  voskModel: 'en-us-small',
  voskGrammar: false,
  sensitivity: 2.2,
  followRetakes: true,
  autoSpeed: 60,
};

const SCRIPTS_KEY = 'spotprompt.scripts.v1';
const SETTINGS_KEY = 'spotprompt.settings.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('save failed', e);
  }
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(SETTINGS_KEY, {}) };
}
export function saveSettings(s: Settings) {
  write(SETTINGS_KEY, s);
}

export function listScripts(): Script[] {
  return read<Script[]>(SCRIPTS_KEY, []).sort((a, b) => b.updated - a.updated);
}
export function getScript(id: string): Script | undefined {
  return read<Script[]>(SCRIPTS_KEY, []).find((s) => s.id === id);
}
export function saveScript(s: Script) {
  const all = read<Script[]>(SCRIPTS_KEY, []);
  const i = all.findIndex((x) => x.id === s.id);
  if (i >= 0) all[i] = s;
  else all.push(s);
  write(SCRIPTS_KEY, all);
}
export function deleteScript(id: string) {
  write(SCRIPTS_KEY, read<Script[]>(SCRIPTS_KEY, []).filter((s) => s.id !== id));
}
export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function createScript(title: string, body: string): Script {
  const s: Script = { id: newId(), title, body, updated: Date.now() };
  saveScript(s);
  return s;
}

export const SAMPLE_SCRIPT = `# Cold open
[look to camera 1]
Hi, I'm out here on the *edge* of the Grand Canyon, /
and behind me the Colorado River has carved **two billion years** of rock.

It took roughly 6 million years to cut this deep. //
~~Fun fact: this line got cut from the edit, so it's hidden in the prompter.~~

--- Take 2: the lookout
[walk to the railing]
Up here at the lookout, the wind _never_ really stops.
> Note: wait for the drone pass before this line
Let's head down the trail and see what the river looks like ==up close==.

+++
# Outro
Thanks for watching, and I'll see you on the next adventure.`;

export function ensureSample() {
  if (!localStorage.getItem(SCRIPTS_KEY)) createScript('Sample: Grand Canyon', SAMPLE_SCRIPT);
}
