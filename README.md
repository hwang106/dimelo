# Dímelo

A Duolingo-style app for **fast Dominican Spanish**: ear training for dropped sounds, student slang,
newcomers, parent calls, conferences and the neighborhood. A PWA, so it installs on Windows
(Edge/Chrome) and Android (Chrome).

## Run it locally
```
node serve.js        # http://localhost:5190/
```

## What's inside
- `app/js/content.js`: all units, phrases, slang and role-plays. **Edit here to fix or add content.**
- `tools/gen-audio.py`: makes the audio (Microsoft neural voices es-DO Emilio + Ramona, via
  `pip install --user edge-tts`). Rerun after editing content; it only redoes changed lines.
- `app/js/srs.js`: FSRS-4.5 spaced repetition. `app/js/match.js`: forgiving answer checking.
- `app/js/lesson.js`, `dialogue.js`: lesson and role-play players. `clips.js`: YouTube clip lab.
  `partner.js`: optional Gemini conversation partner (your own free key, kept in the browser).
- `app/js/appsync.js`: OneDrive sync, borrowed at runtime from InkNotes (`/inknotes/js/`), so it
  only works when hosted next to InkNotes on hwang106.github.io. Records go in the `dimelo/` folder.

## Publishing (same as InkBoard)
1. Make a public repo `hwang106/dimelo`, push, and copy InkBoard's `.github/workflows` Pages workflow.
2. Add `https://hwang106.github.io/dimelo/` as a SPA redirect URI on the InkNotes Azure app
   registration (client ID in InkNotes `app/js/config.js`).
