// End-to-end check: open the built page, make videos the way a visitor would, save the MP4s, report timings.
//   node test/e2e.mjs http://localhost:8765/tools/video-maker/ <out-dir> [--voice] [--channel msedge] [--cpu-only]
//     [--themes a,b,c]  one theme per sample (default: sunset-pop, clean-mono, midnight-neon)
// Uses the Playwright copy the repo's QA suite already installs. SPDX-License-Identifier: GPL-3.0-or-later
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Playwright: this project's own (npm i -D playwright), else the copy a parent repo already has
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch { ({ chromium } = createRequire(join(here, "..", "..", "005-woo-ai-readiness", "tests", "qa", "package.json"))("playwright")); }
const [url, outDir] = process.argv.slice(2);
const voice = process.argv.includes("--voice");
const cpuOnly = process.argv.includes("--cpu-only");
const channel = process.argv.includes("--channel") ? process.argv[process.argv.indexOf("--channel") + 1] : "msedge";
mkdirSync(outDir, { recursive: true });

const args = cpuOnly ? ["--disable-gpu", "--disable-features=Vulkan,WebGPU"] : ["--enable-unsafe-webgpu"];
const browser = await chromium.launch({ channel, args });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const log = [];
page.on("console", (m) => { if (m.type() === "error") log.push(m.text()); });
await page.goto(url + (process.argv.includes("--webgpu") ? "?webgpu" : ""), { waitUntil: "load" });

async function exportNow(name) {
  await page.evaluate(() => { window.__vmLast = null; document.getElementById("exportBtn").click(); });
  await page.waitForFunction(() => window.__vmLast, null, { timeout: 900000 }); // with an AI voice, the first download is inside
  const last = await page.evaluate(() => window.__vmLast);
  if (last.error) throw new Error(`${name}: ${last.error}`);
  const b64 = await page.evaluate(async () => {
    const blob = await fetch(document.getElementById("download").href).then((r) => r.blob());
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  writeFileSync(join(outDir, `${name}.mp4`), Buffer.from(b64, "base64"));
  return last;
}

const results = {};
const themes = (process.argv.includes("--themes") ? process.argv[process.argv.indexOf("--themes") + 1] : "sunset-pop,clean-mono,midnight-neon").split(",");
const look = (i) => page.evaluate((id) => document.querySelector(`.swatch[data-theme="${id}"]`).click(), themes[i % themes.length]); // P-065: in a hidden step
// 1. Product promo with photos and music, no voice
const pics = ["product-1.jpg", "product-2.jpg", "product-3.jpg"].map((f) => join(here, "fixtures", f));
await page.setInputFiles("#photos", pics);
await look(0);
await page.waitForTimeout(500);
results.promo_music = await exportNow("promo-9x16-music");
// 2. The same in 16:9
await page.evaluate(() => document.querySelector('[data-aspect="16x9"]').click());
await look(1);
await page.waitForTimeout(300);
results.promo_16x9 = await exportNow("promo-16x9-music");
await page.evaluate(() => document.querySelector('[data-aspect="9x16"]').click());
if (voice) { // 3. AI voice (downloads the model the first time) then export
  await look(2);
  await page.evaluate(() => document.querySelector('[data-sound="ai"]').click()); // the voice is made inside Make my video (P-065)
  const t0 = Date.now();
  results.promo_voice = await exportNow("promo-9x16-voice"); // voice (incl. the first download) + frames + encode
  results.voice = { ms_total_incl_download_and_export: Date.now() - t0 };
}
results.console_errors = log.filter((e) => !/403|ERR_|favicon/.test(e)).slice(0, 5);
results.gpu = await page.evaluate(() => !!navigator.gpu);
console.log(JSON.stringify(results, null, 1));
await browser.close();
