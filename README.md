# Free Video Maker

Make a short video for your shop or business **in your browser**: motion graphics, kinetic captions, music and an
optional voice. No sign-up, no watermark, nothing uploaded. Your photos and your video never leave your device.

**Use it:** https://www.leymish.com/tools/video-maker/

## What it does
- **Templates:**
  - **Product promo:** product, price, up to 3 photos, 3 benefits, call to action.
  - **Tip / explainer:** hook, 3 points, call to action.
  - **Announcement / offer.**
- **Formats:** 9:16 (Reels, Shorts, TikTok) or 16:9 (YouTube), 1080p, 30 fps, MP4 (H.264 + AAC where the browser
  supports them).
- **Look:** your colours and logo; captions that light up word by word as they're spoken.
- **Voice:** an AI-generated voice that runs on your device ([Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
  via [kokoro-js](https://www.npmjs.com/package/kokoro-js)). It downloads about 90 MB the first time. Each line's clip
  sets its scene's length. Or **record your own voice**, or use no voice. There is **no voice cloning**.
- **Music:** 4 short beds synthesised in the browser (no samples). Each export is yours to use, including
  commercially.
- **End card:** an optional "Made free at leymish.com" end card, on by default, which you can switch off. There's no
  watermark.

## How it works
- **Drawing:** a small Canvas 2D scene engine (`src/engine.js`) draws any moment of the video. The preview and the
  export use the same code.
- **Sound:** voice clips, your recording and the music are mixed in an `OfflineAudioContext` (`src/export.js`).
- **Encoding:** frames and audio are encoded with **WebCodecs** and written to MP4 by
  [Mediabunny](https://github.com/Vanilagy/mediabunny).
- **Voice:** the voice runs in a Web Worker (`src/voice-worker.js`).

## Browser support (tested 23 Oct 2026)
- **Works:** Chrome and Edge on desktop and Android. Safari 26+ and Firefox desktop are best-effort.
- **Firefox on Android:** has no WebCodecs video encoding, so the page lets you preview but not export.

## Build
```
npm install
node build.mjs                 # bundles src/ into ../../site/tools/video-maker/ (or set VM_OUT)
node test/e2e.mjs <page-url> <out-dir> [--voice] [--webgpu] [--cpu-only]
```

## Licence
**GPL-3.0-or-later** (see `LICENSE`). The voice pipeline includes eSpeak NG (GPL-3) through `phonemizer`, so the whole
tool is GPL-3.

Third-party parts:

| Part | Licence |
|---|---|
| kokoro-js, Kokoro-82M, transformers.js | Apache-2.0 |
| Mediabunny | MPL-2.0 |
| phonemizer | Apache-2.0, with eSpeak NG GPL-3 |

Made by [LeyMish Labs](https://www.leymish.com), South Australia.
