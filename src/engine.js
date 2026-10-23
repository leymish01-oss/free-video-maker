// Free Video Maker: the scene engine. Draws any moment of a video onto a Canvas 2D context, so the preview and the
// export use exactly the same code. No animation library: small easing helpers below.
// SPDX-License-Identifier: GPL-3.0-or-later

export const SIZES = { "9x16": [1080, 1920], "16x9": [1920, 1080] };
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x) => (x = clamp(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fadeIn = (t, start, len = 0.45) => easeOut((t - start) / len);

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

/** Draw wrapped accent text; shrinks the font until it fits maxLines. Returns the block height. */
function headline(ctx, text, x, y, maxWidth, size, theme, opts = {}) {
  const { maxLines = 4, weight = 800, align = "left", alpha = 1, lift = 0 } = opts;
  let lines, fs = size;
  for (; fs > size * 0.45; fs *= 0.92) {
    ctx.font = `${weight} ${fs}px ${FONT}`;
    lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines) break;
  }
  const lh = fs * 1.08;
  const space = ctx.measureText(" ").width;
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    const lw = line.reduce((a, wd, j) => a + ctx.measureText(wd.w).width + (j ? space : 0), 0);
    let cx = align === "center" ? x + (maxWidth - lw) / 2 : x;
    line.forEach((wd, j) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = wd.accent ? theme.accent : theme.ink;
      ctx.fillText(wd.w, cx, y + i * lh + lift);
      cx += ctx.measureText(wd.w).width + space;
      if (j === line.length - 1) ctx.globalAlpha = 1;
    });
  });
  ctx.globalAlpha = 1;
  return lines.length * lh;
}

function roundRect(ctx, x, y, w, h, r) {
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
  ctx.font = `700 ${fs}px ${FONT}`;
  const maxW = W * (portrait ? 0.8 : 0.66);
  const lines = wrap(ctx, text, maxW);
  const words = lines.flat();
  const lit = Math.floor(clamp((local - 0.15) / Math.max(0.6, dur - 0.5)) * words.length + 0.999);
  const lh = fs * 1.3;
  const boxH = lines.length * lh + fs * 0.7;
  const y0 = H * (portrait ? 0.79 : 0.8) - boxH / 2;
  const alpha = fadeIn(local, 0.05, 0.25) * (1 - easeOut((local - (dur - 0.2)) / 0.2));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  roundRect(ctx, (W - maxW) / 2 - fs * 0.6, y0, maxW + fs * 1.2, boxH, fs * 0.35);
  ctx.fill();
  const space = ctx.measureText(" ").width;
  let k = 0;
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    const lw = line.reduce((a, wd, j) => a + ctx.measureText(wd.w).width + (j ? space : 0), 0);
    let cx = (W - lw) / 2;
    line.forEach((wd) => {
      ctx.fillStyle = k < lit ? "#ffffff" : "rgba(255,255,255,0.45)";
      ctx.fillText(wd.w, cx, y0 + fs * 0.35 + i * lh);
      cx += ctx.measureText(wd.w).width + space;
      k++;
    });
  });
  ctx.globalAlpha = 1;
}

/** Draw one scene at local time `lt` (seconds into the scene). */
function scene(ctx, s, lt, W, H, theme, assets) {
  const portrait = H > W;
  const pad = portrait ? W * 0.08 : W * 0.07;
  const top = portrait ? H * 0.17 : H * 0.14;
  const enter = fadeIn(lt, 0.0, 0.5);
  const lift = (1 - enter) * 40;
  const p = clamp(lt / Math.max(0.1, s.dur));
  const big = portrait ? 96 : 92;

  if (s.type === "hook" || s.type === "title") {
    if (s.kicker) {
      ctx.font = `700 ${portrait ? 34 : 30}px ${FONT}`;
      ctx.fillStyle = theme.accent; ctx.globalAlpha = enter; ctx.textBaseline = "top";
      ctx.fillText(String(s.kicker).toUpperCase(), pad, top + lift); ctx.globalAlpha = 1;
    }
    headline(ctx, s.headline, pad, top + (s.kicker ? 70 : 0), W - pad * 2, s.type === "hook" ? big * 1.12 : big,
      theme, { alpha: s.type === "hook" ? 1 : enter, lift: s.type === "hook" ? 0 : lift, maxLines: portrait ? 5 : 3 });
  } else if (s.type === "product") {
    const img = assets.photos[s.photo || 0];
    if (portrait) {
      photo(ctx, img, pad, top, W - pad * 2, H * 0.36, p, 36);  // ends at 0.53 H, clear of the caption at 0.79 H
      const y = top + H * 0.39;
      const hh = headline(ctx, s.headline, pad, y + lift, W - pad * 2, 74, theme, { alpha: enter, maxLines: 2 });
      if (s.price) pill(ctx, s.price, pad, y + hh + 28 + lift, 54, theme, fadeIn(lt, 0.35));
    } else {
      photo(ctx, img, W * 0.5, top, W * 0.43, H * 0.66, p, 36);
      headline(ctx, s.headline, pad, top + 40 + lift, W * 0.38, 80, theme, { alpha: enter, maxLines: 3 });
      if (s.price) pill(ctx, s.price, pad, top + 320 + lift, 54, theme, fadeIn(lt, 0.35));
    }
  } else if (s.type === "points") {
    if (s.kicker) {
      ctx.font = `700 ${portrait ? 34 : 30}px ${FONT}`; ctx.fillStyle = theme.accent; ctx.textBaseline = "top";
      ctx.globalAlpha = enter; ctx.fillText(String(s.kicker).toUpperCase(), pad, top); ctx.globalAlpha = 1;
    }
    const items = (s.items || []).filter(Boolean).slice(0, 3);
    const gap = Math.max(0.35, (s.dur - 0.8) / Math.max(1, items.length));
    let y = top + 90;
    items.forEach((it, i) => {
      const a = fadeIn(lt, 0.3 + i * gap, 0.4);
      const dx = (1 - a) * -60;
      ctx.globalAlpha = a;
      ctx.fillStyle = theme.accent;
      ctx.beginPath(); ctx.arc(pad + 26 + dx, y + 40, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = theme.bg; ctx.font = `800 32px ${FONT}`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.fillText("✓", pad + 26 + dx, y + 42); ctx.textAlign = "left";
      const h = headline(ctx, it, pad + 80 + dx, y + 8, W - pad * 2 - 80, portrait ? 62 : 58, theme, { weight: 700, maxLines: 3, alpha: a });
      y += Math.max(110, h + 50);
    });
    ctx.globalAlpha = 1;
  } else if (s.type === "photo") {
    const img = assets.photos[s.photo || 0];
    photo(ctx, img, 0, 0, W, H, p, 0);
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(0, 0, W, H);
    headline(ctx, s.headline, pad, top + lift, W - pad * 2, big * 0.85, { ...theme, ink: "#ffffff" }, { alpha: enter, maxLines: 4 });
  } else if (s.type === "cta" || s.type === "endcard") {
    const cy = portrait ? H * 0.32 : H * 0.28;
    const h = headline(ctx, s.headline, pad, cy + lift, W - pad * 2, s.type === "endcard" ? 64 : big, theme,
      { alpha: enter, align: "center", maxLines: 3 });
    if (s.button) pill(ctx, s.button, null, cy + h + 60, portrait ? 52 : 48, theme, fadeIn(lt, 0.35), W);
    if (s.small) {
      ctx.font = `600 ${portrait ? 36 : 32}px ${FONT}`; ctx.fillStyle = theme.muted; ctx.textAlign = "center";
      ctx.textBaseline = "top"; ctx.globalAlpha = fadeIn(lt, 0.6);
      ctx.fillText(s.small, W / 2, cy + h + (s.button ? 210 : 60)); ctx.globalAlpha = 1; ctx.textAlign = "left";
    }
  }
}

function pill(ctx, text, x, y, fs, theme, alpha, W) {
  ctx.font = `800 ${fs}px ${FONT}`;
  const w = ctx.measureText(text).width + fs * 1.4, h = fs * 1.8;
  const px = x == null ? (W - w) / 2 : x;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = theme.accent; roundRect(ctx, px, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = theme.onAccent; ctx.textBaseline = "middle"; ctx.fillText(text, px + fs * 0.7, y + h / 2 + 2);
  ctx.globalAlpha = 1;
}

/** Draw the whole frame at time t. */
export function drawFrame(ctx, tl, t, opts) {
  const { width: W, height: H, theme, assets } = opts;
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, W, H);
  // a soft accent glow that drifts, so a still scene never looks frozen
  const g = ctx.createRadialGradient(W * (0.8 - 0.1 * Math.sin(t / 3)), H * 0.15, 10, W * 0.8, H * 0.15, W * 0.9);
  g.addColorStop(0, theme.glow); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
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
}

/** Colours: background, ink and accent from the user's pick; the rest derived. */
export function makeTheme(bg = "#16181d", accent = "#4cc38a") {
  const dark = luminance(bg) < 0.5;
  return { bg, accent, ink: dark ? "#f7f6f2" : "#16181d", muted: dark ? "#a3a8b2" : "#5d636f",
    onAccent: luminance(accent) > 0.55 ? "#16181d" : "#ffffff", glow: hexA(accent, dark ? 0.16 : 0.12) };
}
function luminance(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
function hexA(hex, a) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
