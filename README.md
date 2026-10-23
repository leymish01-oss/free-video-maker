# Free Video Maker

Make a short video for your shop or business **in your browser**: motion graphics, kinetic captions, music and an
optional voice. No sign-up, no watermark, nothing uploaded. Your photos and your video never leave your device.

**Use it:** https://www.leymish.com/tools/video-maker/

## What it does
- **Templates:**
  - **Product promo:** product, price, up to 3 photos, 3 benefits, call to action.
  - **Tip / explainer:** hook, 3 points, call to action.
  - **Announcement / offer.**
  - **Black Friday sale:** the discount (big), what it covers, a code, a countdown line, call to action.
  - **Christmas gift guide:** three gifts with prices and photos, and the last order date.
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

## Looks
- **4 themes** (`src/themes.js`): Midnight Neon, Sunset Pop, Clean Mono and Earthy Clay. A theme sets the background
  (solid, gradient, mesh glow, retro grid or bokeh lights), colours, highlight words (colour, box or gold foil), the
  price-pill style and the end-card style. The engine draws all of these.
- **Custom:** pick background, text and accent. **Match my logo:** the main colours are read from your logo in the
  browser (k-means) and turned into a palette.
- **Readable by design:** every theme, every custom palette and every logo palette is checked for WCAG AA contrast
  (captions 4.5:1 or better) against every colour the text can sit on; `node test/themes.test.mjs` tests the presets,
  500 random custom palettes and 200 random logos.
- **Designer themes are a separate paid content pack.** On leymish.com the page also offers 8 extra themes and Match
  my logo (US$2 each, or US$5 for all). Their designs are not part of this program or this repository and are not
  covered by its GPL licence; `src/premium.js` only loads them from the site's server and asks it whether an export may
  use one. Without that server, the tool runs with its free themes and every feature, and Match my logo is free too.
- **Fonts:** 5 pairs (Inter, Poppins, Playfair Display, Bebas Neue and Space Grotesk headlines, Inter body), self-hosted
  OFL files from Fontsource. Nothing is loaded from Google Fonts.
- **Motion:** Snappy, Smooth or Bouncy. **Texture:** none, film grain or soft shapes.
- The look is remembered on your device, and `?theme=…&font=…&motion=…` links share it.

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
node test/e2e.mjs <page-url> <out-dir> [--voice] [--webgpu] [--cpu-only] [--themes a,b,c]
node test/themes.test.mjs      # contrast checks for every look
node test/paywall.mjs <page-url>   # the Designer-themes gate, with the server mocked
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
| Inter, Poppins, Playfair Display, Bebas Neue, Space Grotesk (via Fontsource) | SIL Open Font License 1.1 |

Made by [LeyMish Labs](https://www.leymish.com), South Australia.
