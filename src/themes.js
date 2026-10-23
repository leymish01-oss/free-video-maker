// Free Video Maker: looks. Ten curated themes, five font pairs, three motion styles, a custom palette and a palette
// taken from the user's logo. Every palette is checked for WCAG AA contrast against every colour text can sit on.
// SPDX-License-Identifier: GPL-3.0-or-later

// ------------------------------------------------------------------------------------------------------ colour maths
export function rgb(c) {
  const m = String(c).match(/rgba?\(([^)]+)\)/);
  if (m) { const [r, g, b, a = 1] = m[1].split(",").map(Number); return [r, g, b, a]; }
  const h = String(c).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6), 16);
  return [n >> 16, (n >> 8) & 255, n & 255, 1];
}
export const hex = ([r, g, b]) => "#" + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
export const rgba = (c, a) => { const [r, g, b] = rgb(c); return `rgba(${r},${g},${b},${a})`; };
/** Paint `top` (any alpha) over an opaque `under`. */
export function over(top, under) {
  const [r, g, b, a] = rgb(top), [R, G, B] = rgb(under);
  return hex([r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)]);
}
export const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t)); };
export function lum(c) {
  const v = rgb(c).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** Move `c` toward black or white (whichever gains contrast against every colour in `on`) until it reaches `min`. */
export function ensure(c, on, min) {
  const worst = (x) => Math.min(...on.map((b) => contrast(x, b)));
  if (worst(c) >= min) return c;
  const dark = on.reduce((a, b) => a + lum(b), 0) / on.length > 0.18;
  let best = c;
  for (let t = 0.05; t <= 1.0001; t += 0.05) { best = mix(c, dark ? "#000000" : "#ffffff", t); if (worst(best) >= min) return best; }
  return worst("#000000") > worst("#ffffff") ? "#000000" : "#ffffff";
}
const bestOn = (c) => (contrast("#ffffff", c) >= contrast("#000000", c) ? "#ffffff" : "#000000"); // one of them always reaches 4.58:1

// ------------------------------------------------------------------------------------------------------- the themes
// The 4 free themes (dark, colourful, light mono, warm light). The 8 "Designer themes" are a separate paid content pack,
// not part of this GPL program: the page loads them from our server for preview and unlocks them for export.
// bg.type: solid | linear (stops, angle) | mesh (base + drifting blobs) | grid (retro horizon grid) | bokeh (glowing lights)
// pill: solid | outline | glow | tag | soft   endcard: center | stripe | frame   highlightStyle: color | box | foil
export const THEMES = [
  { id: "midnight-neon", name: "Midnight Neon", font: "space", texture: "grain",
    bg: { type: "mesh", base: "#07080f", blobs: [["#00e5ff", 0.2], ["#ff2bd6", 0.2]] },
    surface: "#141831", ink: "#f5f7ff", muted: "#aab3da", accent: "#00e5ff", highlight: "#ff6ade", onAccent: "#03141a",
    caption: { bg: "rgba(4,5,12,0.78)", ink: "#ffffff" }, pill: "glow", endcard: "frame", radius: 28 },
  { id: "sunset-pop", name: "Sunset Pop", font: "poppins", texture: "shapes",
    bg: { type: "linear", angle: 150, stops: ["#a3263f", "#77258c", "#3d1d93"] },
    surface: "#5c2a8f", ink: "#fff5e6", muted: "#ffeedd", accent: "#ffd27a", highlight: "#ffd27a", onAccent: "#3a1240",
    caption: { bg: "rgba(30,8,40,0.72)", ink: "#fff8ee" }, pill: "solid", endcard: "center", radius: 40 },
  { id: "clean-mono", name: "Clean Mono", font: "inter", texture: "none",
    bg: { type: "solid", color: "#ffffff" },
    surface: "#f2f2f2", ink: "#0a0a0a", muted: "#555555", accent: "#d40500", highlight: "#d40500", onAccent: "#ffffff",
    caption: { bg: "rgba(10,10,10,0.88)", ink: "#ffffff" }, pill: "solid", endcard: "center", radius: 0 },
  { id: "earthy-clay", name: "Earthy Clay", font: "playfair", texture: "grain",
    bg: { type: "linear", angle: 170, stops: ["#f1e5d1", "#e8d6bb"] },
    surface: "#fbf4e8", ink: "#2b1d14", muted: "#465020", accent: "#a8481f", highlight: "#9c3f1a", onAccent: "#ffffff",
    caption: { bg: "rgba(43,29,20,0.86)", ink: "#fbf4e8" }, pill: "solid", endcard: "frame", radius: 18 },
];
export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_THEME = "midnight-neon";

// --------------------------------------------------------------------------------------------- fonts and motion
// Self-hosted OFL fonts (from @fontsource, copied next to the page by build.mjs). Nothing is fetched from Google.
export const FONTS = {
  inter: { name: "Inter", head: { family: "VM Inter", weight: 800 } },
  poppins: { name: "Poppins + Inter", head: { family: "VM Poppins", weight: 800 } },
  playfair: { name: "Playfair Display + Inter", head: { family: "VM Playfair", weight: 800 } },
  bebas: { name: "Bebas Neue + Inter", head: { family: "VM Bebas", weight: 400, upper: true, scale: 1.2 } },
  space: { name: "Space Grotesk + Inter", head: { family: "VM Space Grotesk", weight: 700 } },
};
export const BODY = "VM Inter";
export const FONT_FILES = [
  ["VM Inter", "inter-latin-600-normal.woff2", 600], ["VM Inter", "inter-latin-700-normal.woff2", 700],
  ["VM Inter", "inter-latin-800-normal.woff2", 800], ["VM Poppins", "poppins-latin-800-normal.woff2", 800],
  ["VM Playfair", "playfair-display-latin-800-normal.woff2", 800], ["VM Bebas", "bebas-neue-latin-400-normal.woff2", 400],
  ["VM Space Grotesk", "space-grotesk-latin-700-normal.woff2", 700],
];
export const FALLBACK = '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';

const c01 = (x) => Math.max(0, Math.min(1, x));
const back = (x) => { x = c01(x); const s = 1.9; return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); };
export const MOTIONS = {
  snappy: { name: "Snappy", len: 0.26, lift: 26, ease: (x) => 1 - Math.pow(1 - c01(x), 4) },
  smooth: { name: "Smooth", len: 0.6, lift: 44, ease: (x) => (x = c01(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2) },
  bouncy: { name: "Bouncy", len: 0.55, lift: 70, ease: back },
};
export const TEXTURES = { none: "None", grain: "Film grain", shapes: "Soft shapes" };

// ------------------------------------------------------------------------------------------------ contrast checks
/** Every opaque colour that text can sit on in this theme (gradient stops, and the glow or blobs painted over them). */
export function surfaces(t) {
  const b = t.bg;
  const base = b.type === "solid" ? [b.color] : b.type === "mesh" ? [b.base] : b.stops;
  const out = [...base];
  if (b.type === "mesh") b.blobs.forEach(([c, a]) => base.forEach((x) => out.push(over(rgba(c, a), x))));
  else base.forEach((x) => out.push(over(rgba(t.accent, glowAlpha(t)), x)));
  if (b.type === "bokeh") b.lights.forEach(([c, a]) => base.forEach((x) => out.push(over(rgba(c, a), x))));
  return out;
}
export const glowAlpha = (t) => (lum(surfaces0(t)) < 0.4 ? 0.14 : 0.1);
const surfaces0 = (t) => (t.bg.type === "solid" ? t.bg.color : t.bg.type === "mesh" ? t.bg.base : t.bg.stops[0]);

/** The contrast of each text role against its worst background. AA: 4.5 for normal text, 3 for large text. */
export function audit(t) {
  const on = surfaces(t);
  const worst = (c, list = on) => Math.min(...list.map((b) => contrast(c, b)));
  const captionOn = on.map((b) => over(t.caption.bg, b));
  const r = {
    ink: worst(t.ink), // headlines and points
    caption: worst(t.caption.ink, captionOn), // the kinetic caption over its box
    muted: worst(t.muted), // the end card's small line
    onAccent: contrast(t.onAccent, t.accent), // text on a solid pill / box highlight / check mark
    highlight: t.highlightStyle === "box" ? contrast(t.onAccent, t.accent) // large headline words (foil: every shade)
      : Math.min(...[t.highlight, ...(t.highlightStyle === "foil" ? t.foil : [])].map((c) => worst(c))),
    kicker: worst(t.kicker || t.accent), // large bold label
    surfaceInk: contrast(t.ink, t.surface), // text on a stripe end card or a points chip
  };
  if (t.endcard === "stripe" && t.highlightStyle !== "box") r.highlightSurface = contrast(t.highlight, t.surface);
  if (t.pill === "soft") r.pillText = worst(t.ink, on.map((b) => over(rgba(t.accent, 0.22), b)));
  return r;
}
/** AA minimums per role (large text = headlines ≥ 24 px bold, which every headline, kicker and highlight is). */
export const AA = { ink: 4.5, caption: 4.5, muted: 4.5, onAccent: 4.5, highlight: 3, kicker: 3, surfaceInk: 4.5, pillText: 4.5, highlightSurface: 3 };
export const passes = (t) => Object.entries(audit(t)).every(([k, v]) => v >= AA[k]);

// ------------------------------------------------------------------------------------- custom and logo palettes
/** A theme from three colours; nudges text and accent until every role passes AA. Returns {theme, adjusted}. */
export function customTheme(bgIn, inkIn, accentIn, base = THEMES[0]) {
  const bg = hex(rgb(bgIn));
  const dark = lum(bg) < 0.3;
  const t = { ...base, id: "custom", name: "Custom", bg: { type: "solid", color: bg }, highlightStyle: "color",
    caption: { bg: dark ? "rgba(0,0,0,0.78)" : "rgba(12,12,12,0.86)", ink: "#ffffff" }, pill: "solid", endcard: "center" };
  const on = () => surfaces(t);
  t.ink = hex(rgb(inkIn)); t.accent = hex(rgb(accentIn));
  // the glow is painted in the accent colour, so each nudge can shift what the text sits on: repeat until all pass,
  // and if a mid-tone background can't reach AA with any text colour, deepen it a little
  for (let round = 0; round < 12; round++) {
    t.ink = ensure(t.ink, on(), 4.5);
    t.accent = ensure(t.accent, on(), 3);
    t.highlight = t.accent;
    t.onAccent = bestOn(t.accent);
    t.muted = ensure(mix(t.ink, t.bg.color, 0.3), on(), 4.5);
    t.surface = mix(t.bg.color, t.ink, 0.1);
    if (contrast(t.ink, t.surface) < 4.5) t.surface = t.bg.color;
    if (passes(t)) break;
    if (round >= 2) t.bg = { type: "solid", color: mix(t.bg.color, lum(t.bg.color) > 0.18 ? "#ffffff" : "#000000", 0.12) };
  }
  const adjusted = t.ink !== hex(rgb(inkIn)) || t.accent !== hex(rgb(accentIn)) || t.bg.color !== bg;
  return { theme: t, adjusted };
}

/** Three colours from logo pixels (RGBA bytes): k-means on the opaque, non-white pixels, deterministic. */
export function logoColors(data) {
  const px = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const c = [data[i], data[i + 1], data[i + 2]];
    if (lum(hex(c)) > 0.88) continue; // the paper the logo sits on
    px.push(c);
  }
  if (px.length < 8) return null;
  const k = Math.min(4, px.length);
  const sorted = [...px].sort((a, b) => lum(hex(a)) - lum(hex(b)));
  let cent = Array.from({ length: k }, (_, i) => sorted[Math.floor((i + 0.5) * sorted.length / k)].slice());
  let groups = [];
  for (let it = 0; it < 10; it++) {
    groups = cent.map(() => []);
    px.forEach((p) => {
      let bi = 0, bd = Infinity;
      cent.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = i; } });
      groups[bi].push(p);
    });
    cent = cent.map((c, i) => groups[i].length ? [0, 1, 2].map((j) => groups[i].reduce((a, p) => a + p[j], 0) / groups[i].length) : c);
  }
  const sat = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  return cent.map((c, i) => ({ color: hex(c), share: groups[i].length / px.length, sat: sat(c) }))
    .filter((x) => x.share > 0.02).sort((a, b) => b.share - a.share);
}

/** A palette that passes AA, built from logo colours: the most vivid colour leads, the background is a deep tone. */
export function logoTheme(colors) {
  if (!colors || !colors.length) return null;
  const accent = [...colors].sort((a, b) => b.sat * Math.sqrt(b.share) - a.sat * Math.sqrt(a.share))[0].color;
  const darkest = [...colors].sort((a, b) => lum(a.color) - lum(b.color))[0];
  const bg = lum(darkest.color) < 0.04 && darkest.color !== accent ? darkest.color : mix(accent, "#05060a", 0.86);
  return customTheme(bg, "#ffffff", accent).theme;
}
