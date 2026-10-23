// Every look keeps text readable: the 10 presets, custom palettes and logo palettes all pass WCAG AA contrast.
//   node test/themes.test.mjs            (exit code 1 on any failure)
// SPDX-License-Identifier: GPL-3.0-or-later
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES, FONTS, MOTIONS, FONT_FILES, audit, AA, passes, customTheme, logoColors, logoTheme, contrast } from "../src/themes.js";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log("FAIL", msg); } };

// 1. the presets
check(THEMES.length === 10, `10 presets (got ${THEMES.length})`);
check(new Set(THEMES.map((t) => t.id)).size === THEMES.length, "theme ids are unique");
for (const t of THEMES) {
  for (const k of ["name", "bg", "surface", "ink", "muted", "accent", "highlight", "onAccent", "caption", "pill", "endcard", "font", "texture"]) check(t[k] != null, `${t.id}: has ${k}`);
  check(t.font in FONTS, `${t.id}: font ${t.font} exists`);
  const a = audit(t);
  for (const [k, v] of Object.entries(a)) check(v >= AA[k], `${t.id}: ${k} contrast ${v.toFixed(2)} < ${AA[k]}`);
  check(a.caption >= 4.5, `${t.id}: captions ≥ 4.5:1`);
}

// 2. custom palettes: any three colours come out readable
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const randHex = () => "#" + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0");
for (let i = 0; i < 500; i++) {
  const [bg, ink, accent] = [randHex(), randHex(), randHex()];
  const { theme } = customTheme(bg, ink, accent);
  check(passes(theme), `custom ${bg} ${ink} ${accent}: ${JSON.stringify(audit(theme))}`);
}
const same = customTheme("#ffffff", "#ffffff", "#ffffff");
check(same.adjusted && passes(same.theme), "white on white is adjusted until it passes");
const fine = customTheme("#101820", "#f5f5f5", "#ffb000");
check(!fine.adjusted && passes(fine.theme), "a good palette is left alone");

// 3. logo palettes
function logo(colors, n = 64 * 64) { // a fake logo: blocks of the given colours on white paper, some transparent
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const c = i % 5 === 0 ? [255, 255, 255, 255] : i % 7 === 0 ? [0, 0, 0, 0] : [...colors[i % colors.length], 255];
    d.set(c, i * 4);
  }
  return d;
}
const orange = logoColors(logo([[255, 122, 24], [20, 20, 40]]));
check(orange && orange.some((c) => contrast(c.color, "#ff7a18") < 1.2), "finds the orange in an orange-and-navy logo");
check(passes(logoTheme(orange)), "orange-and-navy logo palette passes AA");
for (let i = 0; i < 200; i++) {
  const cols = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => [rnd() * 255, rnd() * 255, rnd() * 255].map(Math.round));
  const t = logoTheme(logoColors(logo(cols)));
  check(t === null || passes(t), `logo ${JSON.stringify(cols)} palette passes AA`);
}
check(logoColors(logo([[255, 255, 255]])) === null, "an all-white logo gives no palette (we keep the chosen theme)");

// 4. fonts are self-hosted, motion sets complete
const site = join(here, "..", "..", "..", "site", "tools", "video-maker");
if (existsSync(site)) {
  for (const [, file] of FONT_FILES) check(existsSync(join(site, "fonts", file)), `font file shipped: ${file}`);
  const page = readFileSync(join(site, "index.html"), "utf8") + readFileSync(join(site, "app.js"), "utf8");
  check(!/fonts\.(googleapis|gstatic)\.com/.test(page), "no Google Fonts calls");
}
check(["snappy", "smooth", "bouncy"].every((k) => k in MOTIONS), "three motion styles");

console.log(failed ? `${failed} failure(s)` : `themes: all checks passed (${THEMES.length} presets, 500 custom, 200 logo palettes)`);
process.exit(failed ? 1 : 0);
