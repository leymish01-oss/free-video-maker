// Make the launch reel with the tool itself (P-060 §8): the "Announcement / offer" template, AI voice, 9:16.
//   node test/launch_reel.mjs <page-url> <out.mp4>
// SPDX-License-Identifier: GPL-3.0-or-later
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch { ({ chromium } = createRequire(join(here, "..", "..", "005-woo-ai-readiness", "tests", "qa", "package.json"))("playwright")); }
const [url, out] = process.argv.slice(2);
const FIELDS = {
  hook: "Make a shop video *free*, right in your browser.",
  what: "Motion graphics, captions and music in a minute",
  d1: "No sign-up and no watermark",
  d2: "Your photos never leave your device",
  when: "Try it free",
  url: "leymish.com",
};
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(url, { waitUntil: "load" });
await page.evaluate(() => window.__vmType("offer")); // P-066: the type is chosen first
await page.evaluate(() => window.__vmGo(3));
for (const [id, v] of Object.entries(FIELDS)) await page.fill(`#fields input[data-id="${id}"]`, v);
await page.evaluate(() => { const m = document.getElementById("music"); m.value = "upbeat"; m.dispatchEvent(new Event("change")); });
await page.evaluate(() => { const e = document.getElementById("endcard"); if (e.checked) e.click(); }); // the reel's own last scene already says leymish.com
await page.evaluate(() => document.querySelector('[data-sound="ai"]').click());
await page.evaluate(() => { const v = document.getElementById("voice"); v.value = "af_heart"; v.dispatchEvent(new Event("change")); });
await page.evaluate(() => { window.__vmLast = null; document.getElementById("exportBtn").click(); });
await page.waitForFunction(() => window.__vmLast, null, { timeout: 300000 });
const last = await page.evaluate(() => window.__vmLast);
const b64 = await page.evaluate(async () => {
  const buf = new Uint8Array(await (await fetch(document.getElementById("download").href)).arrayBuffer());
  let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
});
writeFileSync(out, Buffer.from(b64, "base64"));
console.log(JSON.stringify(last));
await browser.close();
