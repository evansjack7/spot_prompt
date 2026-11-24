import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { ensureSample } from './store';
import { editorView } from './ui/editor';
import { libraryView } from './ui/library';
import { prompterView } from './ui/prompter';
import { toast } from './ui/dom';

const app = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

function route() {
  cleanup?.();
  cleanup = null;
  const [, view, id] = location.hash.split('/');
  document.body.dataset.view = view || 'library';
  if (view === 'edit' && id) cleanup = editorView(app, id);
  else if (view === 'prompt' && id) cleanup = prompterView(app, id);
  else cleanup = libraryView(app);
}

ensureSample();
addEventListener('hashchange', route);
addEventListener('beforeunload', () => cleanup?.());
route();

// Never reload mid-take: apply updates only outside the prompter.
let updateReady = false;
const applyUpdate = () => {
  if (!updateReady || document.body.dataset.view === 'prompt') return;
  cleanup?.();
  updateSW(true);
};
addEventListener('hashchange', applyUpdate);
const updateSW = registerSW({
  onNeedRefresh() {
    updateReady = true;
    if (document.body.dataset.view === 'prompt') toast('App update downloaded, will apply when you leave the prompter');
    else { toast('Updating…'); setTimeout(applyUpdate, 1200); }
  },
  onOfflineReady() {
    toast('Ready to work offline ✓');
  },
});
