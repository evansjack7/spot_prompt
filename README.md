# SpotPrompt

A voice-tracking teleprompter that runs on your phone, tablet or laptop and works **offline on location**.

* Paste or write a script with formatting (stress, pauses, cues, cuts, take breaks).
* A high-contrast prompter scrolls **by listening to you**. It follows when you read, holds still while you go off on a tangent, and picks up again when you come back to the script.
* Matching is fuzzy: swapped words, dropped words and recogniser mistakes are fine. Once you've said enough of a line, it counts.
* Portrait or landscape, any text size (pinch, A−/A+, or per-orientation sliders), mirror mode for beam-splitter glass, rotate-text mode.

## Install on Android

1. Open the app's URL (GitHub Pages, see below) in **Chrome**.
2. Menu ⋮ → **Install app** / **Add to Home screen**.
3. Open it once while online, then **⚙ Settings → Voice tracking → Download offline model** (~40 MB, one time).
4. Done. It now works with no signal: scripts, prompter and voice tracking all run on the device.

It's a Progressive Web App, so the same URL also works on iPhone/iPad (Safari → Share → Add to Home Screen) and desktop browsers.

## Voice tracking engines

| Engine | Offline | Notes |
|---|---|---|
| **Offline (Vosk)** | ✅ | Speech recognition in WebAssembly, entirely on-device. Model downloaded once and kept in browser storage. |
| **Browser speech** | ✅ if on-device | Chrome's built-in recogniser. Recent Chrome versions can install an on-device language pack (Settings shows an *Install* button when available). Otherwise it needs internet. |

**Automatic** (the default) picks on-device browser speech if installed, otherwise the offline Vosk model if downloaded, otherwise online browser speech.

Tuning (⚙ → Voice tracking):
* **Words needed to move**: lower = more responsive, higher = steadier during tangents.
* **Jump back when I re-read a line**: re-reading a line (a retake) moves the prompter back to it.
* **Show what the mic hears**: shows the live transcript, useful for checking the mic.

## Script formatting

| Markup | Meaning |
|---|---|
| `**word**` | strong stress (bold, accent colour) |
| `*word*` | stress (italic) |
| `_word_` | underline / lean on it |
| `==words==` | highlight |
| `/` and `//` | short pause / long beat (standalone, with spaces around) |
| `[smile]` | direction / cue, shown small and never needs to be read |
| `> note` | presenter note line, not tracked |
| `~~text~~` | cut: hidden in the prompter (can span lines) |
| `# Heading` | section heading |
| `--- Take 2: intro` | take break |
| `+++` | page break, next text starts on a fresh screen |
| new line / blank line | line break / paragraph break |
| `\*` | literal character |

Pasting from Google Docs, Word or web pages converts **bold** → strong, *italic* → stress, underline, strikethrough → cut, and highlights automatically. Ctrl/Cmd+Shift+V pastes plain text.

## Prompter controls

| Action | Touch | Keyboard / Bluetooth remote |
|---|---|---|
| Start/stop voice tracking | 🎙 | Space / Enter |
| Previous / next line | ▲ ▼ | ↑ ↓ ← → PageUp PageDown |
| Reposition | drag the text, or double-tap a word | |
| Text size | pinch, A− / A+ | + / − |
| Auto-scroll (no voice) | ⏵ | A |
| Mirror | ⇋ | M |
| Fullscreen | ⛶ | F |
| Hide controls | single tap | H |
| Back to start | ⏮ | Home |

The screen is kept awake while prompting. Your position is remembered per script.

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # parser + tracker tests (incl. noisy-speech simulation)
npm run build    # production build in dist/
```

The microphone needs HTTPS (or `localhost`).

### Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`.
Enable it once: repository **Settings → Pages → Source: GitHub Actions**.
The app is then at `https://<user>.github.io/spot_prompt/`.

### Code map

* `src/markup.ts`: script markup parser
* `src/normalize.ts`: word normalisation (numbers → words, punctuation) and fuzzy similarity
* `src/tracker.ts`: voice position tracker (weighted local alignment with tangent handling)
* `src/speech/`: Vosk (offline WASM) and Web Speech engines
* `src/paste.ts`: rich-text paste → markup
* `src/ui/`: library, editor, prompter, settings
