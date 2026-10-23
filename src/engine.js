// Free Video Maker: the scene engine. Draws any moment of a video onto a Canvas 2D context, so the preview and the
// export use exactly the same code. No animation library: small easing helpers below; the look (colours, fonts,
// motion, texture) comes from themes.js.
// SPDX-License-Identifier: GPL-3.0-or-later
import { FONTS, BODY, FALLBACK, MOTIONS, rgba, glowAlpha } from "./themes.js";

export const SIZES = { "9x16": [1080, 1920], "16x9": [1920, 1080] };

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x) => (x = clamp(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// the frame being drawn uses one motion style and one font pair (set at the top of drawFrame)
let M = MOTIONS.smooth, HEAD = FONTS.inter.head, NOW = 0; // NOW: the frame time, for effects that shimmer
const span = (len) => len * M.len / 0.45;
/** Opacity of something entering at `start`: 0..1. */
const fadeIn = (t, start, len = 0.45) => easeOut((t - start) / span(len));
/** Movement of something entering at `start`: 0..1, and past 1 briefly for the bouncy style. */
const moveIn = (t, start, len = 0.45) => M.ease((t - start) / span(len));
const hf = (size) => `${HEAD.weight} ${size * (HEAD.scale || 1)}px "${HEAD.family}", ${FALLBACK}`;
const bf = (size, weight = 700) => `${weight} ${size}px "${BODY}", ${FALLBACK}`;

/** Lay out the scenes on a timeline: each scene lasts its own `dur` (set from its voice clip when there is one). */
export function timeline(scenes) {
  let t = 0;
  return scenes.map((s) => { const out = { ...s, start: t }; t += s.dur; return out; });
}
export const totalDuration = (tl) => tl.reduce((a, s) => a + s.dur, 0);

/** Split "text with *accent* words" into [{text, accent}] runs. */
function runs(text) {
  const out = [];
  String(text || "").split(/(\*[^*]+\*)/).forEach((p) => {
    if (!p) return;
    if (p.startsWith("*") && p.endsWith("*")) out.push({ text: p.slice(1, -1), accent: true });
    else out.push({ text: p, accent: false });
  });
  return out;
}

/** Word-wrap accent runs into lines that fit maxWidth; returns [[{word, accent}]] */
function wrap(ctx, text, maxWidth) {
  const words = [];
  runs(text).forEach((r) => r.text.split(/(\s+)/).forEach((w, i, all) => {
    if (!w || /^\s+$/.test(w)) return;
    // punctuation right after an *accent* run ("*free*,") belongs to the previous word: no space before it
    const glued = i === 0 && words.length && !/^\s/.test(r.text) && /^[,.;:!?)'’]/.test(w);
    if (glued) words[words.length - 1].tail = (words[words.length - 1].tail || "") + w;
    else words.push({ w, accent: r.accent });
  }));
  words.forEach((wd) => { if (wd.tail) { wd.w += wd.tail; delete wd.tail; } });
  const lines = [[]];
  let width = 0;
  const space = ctx.measureText(" ").width;
  words.forEach((wd) => {
    const ww = ctx.measureText(wd.w).width;
    if (lines[lines.length - 1].length && width + space + ww > maxWidth) { lines.push([]); width = 0; }
    const cur = lines[lines.length - 1];
    width += (cur.length ? space : 0) + ww;
    cur.push(wd);
  });
  return lines;
}

/** Draw wrapped accent text in the headline font; shrinks it until it fits maxLines. Returns the block height. */
function headline(ctx, text, x, y, maxWidth, size, theme, opts = {}) {
  const { maxLines = 4, align = "left", alpha = 1, lift = 0, body = false, weight = 700 } = opts;
  const font = (fs) => (body ? bf(fs, weight) : hf(fs));
  if (!body && HEAD.upper) text = String(text || "").toUpperCase();
  let lines, fs = size;
  for (; fs > size * 0.45; fs *= 0.92) {
    ctx.font = font(fs);
    lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines) break;
  }
  const real = fs * (body ? 1 : HEAD.scale || 1);
  const lh = real * (body ? 1.12 : HEAD.upper ? 0.98 : 1.08);
  const space = ctx.measureText(" ").width;
  ctx.textBaseline = "top";
  ctx.globalAlpha = alpha;
  lines.forEach((line, i) => {
    const lw = line.reduce((a, wd, j) => a + ctx.measureText(wd.w).width + (j ? space : 0), 0);
    let cx = align === "center" ? x + (maxWidth - lw) / 2 : x;
    const ly = y + i * lh + lift;
    line.forEach((wd, j) => {
      const ww = ctx.measureText(wd.w).width;
      if (wd.accent && theme.highlightStyle === "box") { // one box across neighbouring highlighted words
        const joined = line[j + 1] && line[j + 1].accent ? space : 0;
        ctx.fillStyle = theme.accent;
        ctx.fillRect(cx - real * 0.1, ly - real * 0.04, ww + joined + real * 0.2, real * 1.04);
        ctx.fillStyle = theme.onAccent;
      } else if (wd.accent && theme.highlightStyle === "foil") { // gold foil: a bright band sweeps across the word
        const g = ctx.createLinearGradient(cx, ly, cx + ww, ly + real);
        const s = clamp(((NOW * 0.55 + cx / 1400) % 1.6) - 0.3, 0, 1);
        g.addColorStop(0, theme.foil[0]); g.addColorStop(s, theme.foil[1]); g.addColorStop(1, theme.foil[2]);
        ctx.fillStyle = g;
      } else ctx.fillStyle = wd.accent ? theme.highlight : theme.ink;
      ctx.fillText(wd.w, cx, ly);
      cx += ww + space;
    });
  });
  ctx.globalAlpha = 1;
  return lines.length * lh;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Cover-fit an image into a box, with a slow push-in (Ken Burns). */
function photo(ctx, img, x, y, w, h, progress, radius) {
  if (!img) return;
  const zoom = 1.04 + 0.08 * progress;
  const s = Math.max(w / img.width, h / img.height) * zoom;
  const iw = img.width * s, ih = img.height * s;
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2 - 0.03 * h * progress, iw, ih);
  ctx.restore();
}

/** Kinetic caption: the scene's spoken line near the bottom, words lighting up as they're said. */
function caption(ctx, text, W, H, local, dur, theme, portrait) {
  if (!text) return;
  const fs = portrait ? 46 : 40;
  ctx.font = bf(fs, 700);
  const maxW = W * (portrait ? 0.8 : 0.66);
  const lines = wrap(ctx, text, maxW);
  const words = lines.flat();
  const lit = Math.floor(clamp((local - 0.15) / Math.max(0.6, dur - 0.5)) * words.length + 0.999);
  const lh = fs * 1.3;
  const boxH = lines.length * lh + fs * 0.7;
  const y0 = H * (portrait ? 0.79 : 0.8) - boxH / 2;
  const alpha = fadeIn(local, 0.05, 0.25) * (1 - easeOut((local - (dur - 0.2)) / 0.2));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = theme.caption.bg;
  roundRect(ctx, (W - maxW) / 2 - fs * 0.6, y0, maxW + fs * 1.2, boxH, Math.min(theme.radius, fs * 0.5));
  ctx.fill();
  const space = ctx.measureText(" ").width;
  const dim = rgba(theme.caption.ink, 0.45);
  let k = 0;
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    const lw = line.reduce((a, wd, j) => a + ctx.measureText(wd.w).width + (j ? space : 0), 0);
    let cx = (W - lw) / 2;
    line.forEach((wd) => {
      ctx.fillStyle = k < lit ? theme.caption.ink : dim;
      ctx.fillText(wd.w, cx, y0 + fs * 0.35 + i * lh);
      cx += ctx.measureText(wd.w).width + space;
      k++;
    });
  });
  ctx.globalAlpha = 1;
}

function kicker(ctx, text, x, y, size, theme, alpha) {
  ctx.font = bf(size, 800);
  ctx.fillStyle = theme.kicker || theme.accent; ctx.globalAlpha = alpha; ctx.textBaseline = "top";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${size * 0.12}px`;
  ctx.fillText(String(text).toUpperCase(), x, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.globalAlpha = 1;
}

/** Draw one scene at local time `lt` (seconds into the scene). */
function scene(ctx, s, lt, W, H, theme, assets) {
  const portrait = H > W;
  const pad = portrait ? W * 0.08 : W * 0.07;
  const top = portrait ? H * 0.17 : H * 0.14;
  const enter = fadeIn(lt, 0.0, 0.5);
  const lift = (1 - moveIn(lt, 0.0, 0.5)) * M.lift;
  const p = clamp(lt / Math.max(0.1, s.dur));
  const big = portrait ? 96 : 92;

  if (s.type === "hook" || s.type === "title") {
    if (s.kicker) kicker(ctx, s.kicker, pad, top + lift, portrait ? 34 : 30, theme, enter);
    headline(ctx, s.headline, pad, top + (s.kicker ? 70 : 0), W - pad * 2, (s.type === "hook" ? big * 1.12 : big) * (s.size || 1),
      theme, { alpha: s.type === "hook" ? 1 : enter, lift: s.type === "hook" ? 0 : lift, maxLines: portrait ? 5 : 3 });
  } else if (s.type === "product") {
    const img = assets.photos[s.photo || 0];
    if (portrait) {
      photo(ctx, img, pad, top, W - pad * 2, H * 0.36, p, theme.radius);  // ends at 0.53 H, clear of the caption at 0.79 H
      const y = top + H * 0.39;
      const hh = headline(ctx, s.headline, pad, y + lift, W - pad * 2, 74, theme, { alpha: enter, maxLines: 2 });
      if (s.price) pill(ctx, s.price, pad, y + hh + 28 + lift, 54, theme, fadeIn(lt, 0.35), W, moveIn(lt, 0.35));
    } else {
      photo(ctx, img, W * 0.5, top, W * 0.43, H * 0.66, p, theme.radius);
      headline(ctx, s.headline, pad, top + 40 + lift, W * 0.38, 80, theme, { alpha: enter, maxLines: 3 });
      if (s.price) pill(ctx, s.price, pad, top + 320 + lift, 54, theme, fadeIn(lt, 0.35), W, moveIn(lt, 0.35));
    }
  } else if (s.type === "points") {
    if (s.kicker) kicker(ctx, s.kicker, pad, top, portrait ? 34 : 30, theme, enter);
    const items = (s.items || []).filter(Boolean).slice(0, 3);
    const gap = Math.max(0.35, (s.dur - 0.8) / Math.max(1, items.length));
    let y = top + 90;
    items.forEach((it, i) => {
      const a = fadeIn(lt, 0.3 + i * gap, 0.4);
      const dx = (1 - moveIn(lt, 0.3 + i * gap, 0.4)) * -M.lift * 1.4;
      ctx.globalAlpha = a;
      ctx.fillStyle = theme.accent;
      ctx.beginPath(); ctx.arc(pad + 26 + dx, y + 40, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = theme.onAccent; ctx.font = bf(32, 800); ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.fillText("✓", pad + 26 + dx, y + 42); ctx.textAlign = "left";
      const h = headline(ctx, it, pad + 80 + dx, y + 8, W - pad * 2 - 80, portrait ? 62 : 58, theme, { body: true, weight: 700, maxLines: 3, alpha: a });
      y += Math.max(110, h + 50);
    });
    ctx.globalAlpha = 1;
  } else if (s.type === "photo") {
    const img = assets.photos[s.photo || 0];
    photo(ctx, img, 0, 0, W, H, p, 0);
    ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, 0, W, H);
    headline(ctx, s.headline, pad, top + lift, W - pad * 2, big * 0.85, { ...theme, ink: "#ffffff", highlight: "#ffffff", highlightStyle: "color" }, { alpha: enter, maxLines: 4 });
  } else if (s.type === "cta" || s.type === "endcard") {
    const cy = portrait ? H * 0.32 : H * 0.28;
    const style = s.type === "endcard" ? theme.endcard : "center";
    const size = s.type === "endcard" ? 64 : big;
    let h;
    if (style === "stripe") { // a band in the surface colour slides in behind the line
      ctx.font = hf(size);
      const est = Math.min(3, wrap(ctx, HEAD.upper ? String(s.headline).toUpperCase() : s.headline, W - pad * 2).length) * size * (HEAD.scale || 1) * 1.08;
      const bx = (1 - moveIn(lt, 0, 0.5)) * -W;
      ctx.fillStyle = theme.surface; ctx.fillRect(bx, cy - pad * 0.5, W, est + pad);
      ctx.fillStyle = theme.accent; ctx.fillRect(bx, cy - pad * 0.5, W, 10); ctx.fillRect(bx, cy + est + pad * 0.5 - 10, W, 10);
      h = headline(ctx, s.headline, pad, cy, W - pad * 2, size, theme, { alpha: enter, align: "center", maxLines: 3 });
    } else {
      h = headline(ctx, s.headline, pad, cy + lift, W - pad * 2, size, theme, { alpha: enter, align: "center", maxLines: 3 });
    }
    if (style === "frame") { // a thin accent frame draws itself around the card
      const inset = pad * 0.5, len = 2 * (W + H - 4 * inset);
      ctx.save(); ctx.strokeStyle = theme.accent; ctx.lineWidth = 6; ctx.globalAlpha = 0.9;
      ctx.setLineDash([len * easeOut(lt / 1.2), len]);
      roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, theme.radius); ctx.stroke(); ctx.restore();
    }
    if (s.button) pill(ctx, s.button, null, cy + h + 60, portrait ? 52 : 48, theme, fadeIn(lt, 0.35), W, moveIn(lt, 0.35));
    if (s.small) {
      ctx.font = bf(portrait ? 36 : 32, 600); ctx.fillStyle = theme.muted; ctx.textAlign = "center";
      ctx.textBaseline = "top"; ctx.globalAlpha = fadeIn(lt, 0.6);
      ctx.fillText(s.small, W / 2, cy + h + (s.button ? 210 : 60)); ctx.globalAlpha = 1; ctx.textAlign = "left";
    }
  }
}

/** The price or button pill, in the theme's style; `pop` (0..1, may overshoot) scales it in. */
function pill(ctx, text, x, y, fs, theme, alpha, W, pop = 1) {
  ctx.font = bf(fs, 800);
  const w = ctx.measureText(text).width + fs * 1.4, h = fs * 1.8;
  const px = x == null ? (W - w) / 2 : x;
  const r = theme.pill === "tag" ? Math.min(theme.radius, 12) : Math.min(h / 2, Math.max(theme.radius, 6));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(px + w / 2, y + h / 2);
  ctx.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop);
  if (theme.pill === "tag") ctx.rotate(-0.045);
  ctx.translate(-(px + w / 2), -(y + h / 2));
  let ink = theme.onAccent;
  roundRect(ctx, px, y, w, h, r);
  if (theme.pill === "outline") { ctx.lineWidth = fs * 0.09; ctx.strokeStyle = theme.accent; ctx.stroke(); ink = theme.ink; }
  else if (theme.pill === "soft") { ctx.fillStyle = rgba(theme.accent, 0.22); ctx.fill(); ink = theme.ink; }
  else {
    if (theme.pill === "glow") { ctx.shadowColor = theme.accent; ctx.shadowBlur = fs * 0.9; }
    ctx.fillStyle = theme.accent; ctx.fill(); ctx.shadowBlur = 0;
  }
  ctx.fillStyle = ink; ctx.textBaseline = "middle"; ctx.fillText(text, px + fs * 0.7, y + h / 2 + 2);
  ctx.restore();
}

// --------------------------------------------------------------------------------------------- background layers
function background(ctx, th, W, H, t) {
  const b = th.bg;
  if (b.type === "solid") { ctx.fillStyle = b.color; ctx.fillRect(0, 0, W, H); }
  else if (b.type === "mesh") {
    ctx.fillStyle = b.base; ctx.fillRect(0, 0, W, H);
    b.blobs.forEach(([c, a], i) => { // big soft blobs that drift slowly in opposite corners
      const x = W * (i % 2 ? 0.85 : 0.15) + Math.sin(t / 4 + i * 2.1) * W * 0.12;
      const y = H * (i % 2 ? 0.78 : 0.18) + Math.cos(t / 5 + i * 1.3) * H * 0.06;
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * 0.6);
      g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    });
  } else { // linear and grid: a CSS-style angled gradient
    const a = ((b.angle ?? 180) - 90) * Math.PI / 180;
    const r = Math.abs(W / 2 * Math.cos(a)) + Math.abs(H / 2 * Math.sin(a));
    const g = ctx.createLinearGradient(W / 2 - Math.cos(a) * r, H / 2 - Math.sin(a) * r, W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
    b.stops.forEach((c, i) => g.addColorStop(i / (b.stops.length - 1), c));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (b.type === "bokeh") { // out-of-focus party lights that drift up and twinkle
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < (b.count || 18); i++) {
      const [c, a] = b.lights[i % b.lights.length];
      const r = Math.min(W, H) * (0.03 + 0.09 * rnd());
      const x = W * rnd() + Math.sin(t / 3 + i) * W * 0.015;
      const y = ((H * rnd() - t * (8 + 14 * rnd())) % (H + 2 * r) + H + 2 * r) % (H + 2 * r) - r;
      const tw = a * (0.55 + 0.45 * Math.sin(t * 1.4 + i * 1.7));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(c, tw)); g.addColorStop(0.7, rgba(c, tw * 0.6)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (b.type === "grid") { // a retro horizon grid rolling towards the viewer
    const hz = H * 0.6, vx = W / 2;
    ctx.save(); ctx.strokeStyle = rgba(b.line, 0.42); ctx.lineWidth = 3;
    for (let i = -14; i <= 14; i++) { ctx.beginPath(); ctx.moveTo(vx + i * W * 0.025, hz); ctx.lineTo(vx + i * W * 0.2, H); ctx.stroke(); }
    const roll = (t * 0.6) % 1;
    for (let k = 0; k < 12; k++) { const z = (k + roll) / 12, y = hz + (H - hz) * z * z; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = rgba(b.line, 0.85); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, hz); ctx.lineTo(W, hz); ctx.stroke();
    ctx.restore();
  }
  if (b.type !== "mesh") { // a soft accent glow that drifts, so a still scene never looks frozen
    const g = ctx.createRadialGradient(W * (0.8 - 0.1 * Math.sin(t / 3)), H * 0.15, 10, W * 0.8, H * 0.15, W * 0.9);
    g.addColorStop(0, rgba(th.accent, glowAlpha(th))); g.addColorStop(1, rgba(th.accent, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

let grainTile = null;
function grain() { // a 256 px tile of fixed noise (seeded, so every export is identical)
  if (grainTile) return grainTile;
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
  const x = c.getContext("2d"), img = x.createImageData(256, 256);
  let s = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = s & 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v > 127 ? 255 : 0;
    img.data[i + 3] = (s >> 8) & 31;
  }
  x.putImageData(img, 0, 0);
  return (grainTile = c);
}
function texture(ctx, th, kind, W, H, t) {
  if (kind === "grain") { // static grain: noise that moved every frame made the MP4 about 15 times bigger
    ctx.save(); ctx.globalAlpha = 0.5;
    ctx.fillStyle = ctx.createPattern(grain(), "repeat"); ctx.fillRect(0, 0, W, H); ctx.restore();
  } else if (kind === "shapes") {
    ctx.save();
    [[0.12, 0.3, 0.32], [0.9, 0.55, 0.22], [0.4, 0.95, 0.28]].forEach(([x, y, r], i) => {
      const cx = W * x + Math.sin(t / 3 + i) * W * 0.03, cy = H * y + Math.cos(t / 4 + i) * H * 0.02;
      ctx.fillStyle = rgba(i % 2 ? th.highlight : th.accent, 0.07);
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(W, H) * r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.strokeStyle = rgba(th.accent, 0.12); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(W * 0.82 + Math.sin(t / 2) * 12, H * 0.12, Math.min(W, H) * 0.09, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

/** Draw the whole frame at time t. opts: {width, height, theme, font, motion, texture, assets, captions} */
export function drawFrame(ctx, tl, t, opts) {
  const { width: W, height: H, theme, assets } = opts;
  M = MOTIONS[opts.motion] || MOTIONS.smooth;
  HEAD = (FONTS[opts.font] || FONTS[theme.font] || FONTS.inter).head;
  NOW = t;
  background(ctx, theme, W, H, t);
  texture(ctx, theme, opts.texture ?? theme.texture, W, H, t);
  const s = tl.find((x) => t >= x.start && t < x.start + x.dur) || tl[tl.length - 1];
  if (!s) return;
  const lt = t - s.start;
  const out = 1 - easeInOut((lt - (s.dur - 0.25)) / 0.25);
  ctx.save();
  ctx.globalAlpha = s === tl[tl.length - 1] ? 1 : out;
  scene(ctx, s, lt, W, H, theme, assets);
  ctx.restore();
  if (assets.logo) { // the user's logo, small, top left
    const lh = H > W ? 90 : 80, lw = lh * assets.logo.width / assets.logo.height;
    ctx.drawImage(assets.logo, H > W ? W * 0.08 : W * 0.07, H > W ? H * 0.06 : H * 0.05, Math.min(lw, W * 0.4), lh);
  }
  if (opts.captions !== false && s.line && s.type !== "endcard") caption(ctx, s.line, W, H, lt, s.dur, theme, H > W);
  if (opts.stamp) stamp(ctx, W, H);
}

/** A preview made with a locked Designer theme: diagonal "PREVIEW · leymish.com" lines and a corner badge, burned in. */
function stamp(ctx, W, H) {
  ctx.save();
  const fs = Math.round(Math.min(W, H) * 0.075);
  ctx.font = bf(fs, 800); ctx.textBaseline = "middle"; ctx.textAlign = "center";
  ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 7);
  const text = "PREVIEW · leymish.com", step = fs * 3.2, span = Math.hypot(W, H);
  ctx.lineWidth = Math.max(2, fs * 0.07); ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.fillStyle = "rgba(255,255,255,0.34)";
  for (let y = -span / 2; y <= span / 2; y += step) {
    for (const x of [-span / 3, span / 3]) { ctx.strokeText(text, x + (y / step % 2) * fs * 2, y); ctx.fillText(text, x + (y / step % 2) * fs * 2, y); }
  }
  ctx.restore();
  ctx.save(); // the corner badge
  const bfs = Math.round(Math.min(W, H) * 0.032), pad = bfs * 0.6;
  ctx.font = bf(bfs, 800);
  const label = "PREVIEW", w = ctx.measureText(label).width + pad * 2, h = bfs * 1.8;
  const x = W - w - W * 0.04, y = H * 0.03;
  ctx.fillStyle = "rgba(255,122,46,0.92)"; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = "#0b1f3f"; ctx.textBaseline = "middle"; ctx.fillText(label, x + pad, y + h / 2 + 1);
  ctx.restore();
}

/** A one-second swatch loop for the theme picker: a word, a highlight and a pill, drawn small. */
export function drawSwatch(ctx, theme, t, font, motion) {
  const W = ctx.canvas.width, H = ctx.canvas.height, k = W / 360;
  M = MOTIONS[motion] || MOTIONS.smooth;
  HEAD = (FONTS[font] || FONTS[theme.font] || FONTS.inter).head;
  NOW = t;
  ctx.save(); ctx.scale(k, k);
  background(ctx, theme, 360, H / k, t);
  texture(ctx, theme, theme.texture, 360, H / k, t);
  const lt = t % 1.6;
  headline(ctx, "Your *best* seller", 26, 44 + (1 - moveIn(lt, 0, 0.4)) * M.lift * 0.5, 308, 54, theme, { alpha: fadeIn(lt, 0, 0.4), maxLines: 2 });
  pill(ctx, "$29", 26, 186, 26, theme, fadeIn(lt, 0.3, 0.3), 360, moveIn(lt, 0.3, 0.3));
  ctx.restore();
}
