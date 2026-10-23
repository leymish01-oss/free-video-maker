// The 5-step flow end to end, with the server mocked: link → extract → words → look → sound (AI voice) → make (the MP4
// has a voice track); a voice that can't load fails loudly, never a silent music-only video; a Designer theme makes a
// stamped preview, then a mocked unlock re-makes it clean with the project restored; a token for theme A doesn't unlock
// theme B; "Type it myself" on a phone-width screen. Step screenshots go to <shots-dir> when given.
//   node test/flow.mjs http://127.0.0.1:8765/tools/video-maker/ [shots-dir] [--no-voice]
// SPDX-License-Identifier: GPL-3.0-or-later
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch { ({ chromium } = createRequire(join(here, "..", "..", "005-woo-ai-readiness", "tests", "qa", "package.json"))("playwright")); }
const [url, shots] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const withVoice = !process.argv.includes("--no-voice");
if (shots) mkdirSync(shots, { recursive: true });

const fake = (id, name, bg) => ({ id, name, font: "inter", texture: "none", bg: { type: "solid", color: bg }, surface: bg,
  ink: "#ffffff", muted: "#dddddd", accent: "#ffcc00", highlight: "#ffcc00", onAccent: "#000000",
  caption: { bg: "rgba(0,0,0,0.85)", ink: "#ffffff" }, pill: "solid", endcard: "center", radius: 10 });
const THEMES = [fake("test-a", "Test A", "#202040"), fake("test-b", "Test B", "#402020")];
const tokenFor = (ids) => Buffer.from(JSON.stringify({ ids })).toString("base64url") + ".sig";
const PHOTO = readFileSync(join(here, "fixtures", "product-1.jpg"));
const STRIPE = "https://pay.example.test/";

let failed = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) failed++; };
const browser = await chromium.launch({ channel: "msedge" });

async function context(viewport, { noVoiceModel = false } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/v1/vm/**", async (route) => {
    const u = new URL(route.request().url()), body = route.request().postDataJSON?.() || {};
    const j = (o, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(o) });
    if (u.pathname.endsWith("/config")) return j({ enabled: true, prices: { single: 3, pack: 5, currency: "USD" }, links: { "test-a": STRIPE + "a", "test-b": STRIPE + "b", pack: STRIPE + "pack" }, themes: THEMES.map(({ id, name }) => ({ id, name })) });
    if (u.pathname.endsWith("/themes")) return j({ themes: THEMES });
    if (u.pathname.endsWith("/verify")) {
      let ids = []; try { ids = JSON.parse(Buffer.from(body.token.split(".")[0], "base64url")).ids; } catch (e) { /* bad token */ }
      return j({ ok: body.token.endsWith(".sig") && ids.includes(body.theme) });
    }
    if (u.pathname.endsWith("/unlock")) return body.session_id === "cs_test_ok" ? j({ token: tokenFor(["test-a"]), ids: ["test-a"] }) : j({ error: "not paid" }, 402);
    if (u.pathname.endsWith("/from-url")) return j({ ok: true, kind: "product", source: "jsonld", title: "Test Ceramic Mug", price: "$24", currency: "USD",
      images: ["https://shop.example.test/a.jpg", "https://shop.example.test/b.jpg"], benefits: ["Holds 350 ml", "Dishwasher safe", "Made in Adelaide"],
      logo: null, siteName: "Test Shop", description: "A mug", url: "https://shop.example.test/products/mug" });
    if (u.pathname.endsWith("/img")) return route.fulfill({ status: 200, contentType: "image/jpeg", headers: { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" }, body: PHOTO });
    if (u.pathname.endsWith("/subscribe")) return j({ ok: true, message: "Check your inbox to confirm." });
    return j({}, 404);
  });
  await ctx.route(STRIPE + "**", (route) => route.fulfill({ status: 302, headers: { Location: url + "?unlock=cs_test_ok" } }));
  if (noVoiceModel) await ctx.route(/huggingface\.co|hf\.co/, (route) => route.abort());
  return ctx;
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(shots, name + ".png") }); };
const make = async (page, timeout = 900000) => {
  await page.evaluate(() => { window.__vmLast = null; });
  await page.click("#exportBtn");
  await page.waitForFunction(() => window.__vmLast, null, { timeout });
  return page.evaluate(() => window.__vmLast);
};
const audioLevel = (page) => page.evaluate(async () => { // RMS and length of the exported MP4's sound
  const buf = await (await fetch(document.getElementById("download").href || document.getElementById("resultVideo").src)).arrayBuffer();
  const a = await new AudioContext().decodeAudioData(buf);
  const d = a.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * d[i];
  return { rms: Math.sqrt(s / (d.length / 4)), seconds: a.duration };
});
const timings = {};
const timed = async (k, fn) => { const t0 = Date.now(); const r = await fn(); timings[k] = ((Date.now() - t0) / 1000).toFixed(1) + " s"; return r; };

// ---------------------------------------------------------------------------------------- A. desktop, the whole path
{
  const ctx = await context({ width: 1366, height: 1000 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('.swatch[data-theme="test-a"]', { state: "attached" });
  check(await page.isVisible('.step[data-step="1"]') && !(await page.isVisible('.step[data-step="3"]')), "starts at step 1 (the link), not the themes");
  check(/Grab my details|Auto-fill from my link/.test(await page.textContent("#fromUrlBtn")), "the link button says Grab my details / Auto-fill (A/B), not Make my video");
  await shot(page, "1-link-desktop");
  await page.fill("#fromUrlInput", "https://shop.example.test/products/mug");
  await timed("1 extract", async () => { await page.click("#fromUrlBtn"); await page.waitForFunction(() => window.__vmFromUrlDone, null, { timeout: 30000 }); });
  check(await page.isVisible('.step[data-step="2"]'), "after extracting, it moves to step 2 (words)");
  check((await page.inputValue('#fields input[data-id="name"]')) === "Test Ceramic Mug" && (await page.inputValue('#fields input[data-id="price"]')) === "$24", "name and price filled from the page");
  check((await page.inputValue('#fields input[data-id="b1"]')) === "Holds 350 ml", "point 1 filled from the page");
  await shot(page, "2-words-desktop");
  await page.click('.step[data-step="2"] [data-nav="next"]');
  check(await page.isHidden("#customBox"), "colour pickers stay hidden for a preset theme");
  await page.click('.swatch[data-theme="custom"]');
  check(await page.isVisible("#customBox"), "colour pickers appear only for Custom");
  await page.click('.swatch[data-theme="sunset-pop"]');
  check(await page.isHidden("details.more .grid3") || !(await page.evaluate(() => document.querySelector("details.more").open)), "style options are tucked away");
  await shot(page, "3-look-desktop");
  await page.click('.step[data-step="3"] [data-nav="next"]');
  await page.click('[data-sound="ai"]');
  await page.selectOption("#music", "none"); // so the test hears only the voice
  check(await page.isVisible("#voiceSample") && (await page.$("#voiceBtn")) === null, "AI voice: a sample button, no separate Add voice button");
  await shot(page, "4-sound-desktop");
  await page.click('.step[data-step="4"] [data-nav="next"]');
  await shot(page, "5-make-desktop");
  if (withVoice) {
    const last = await timed("5 make (AI voice, first load)", () => make(page));
    check(!last.error && last.voice === "ai" && !last.stamped, `AI voice export ok (${last.error || last.seconds?.toFixed(1) + " s"})`);
    const lv = await audioLevel(page);
    check(lv.rms > 0.01 && lv.seconds > 5, `the MP4 has a voice track with no music chosen (rms ${lv.rms.toFixed(3)}, ${lv.seconds.toFixed(1)} s)`);
    await shot(page, "6-result-desktop");
  }
  await ctx.close();
}

// -------------------------------------------------------------------- B. the voice can't load: fail loudly, no video
{
  const ctx = await context({ width: 1366, height: 1000 }, { noVoiceModel: true });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.click("#typeMyself");
  await page.evaluate(() => window.__vmGo(4));
  await page.click('[data-sound="ai"]');
  await page.evaluate(() => window.__vmGo(5));
  const last = await make(page, 120000);
  check(!!last.error && /AI voice couldn't be made/.test(last.error) && await page.isHidden("#result"), "no voice model → a clear error and no music-only video");
  await ctx.close();
}

// ------------------------------------------------- C. Designer theme: stamped preview → unlock → clean, project kept
{
  const ctx = await context({ width: 1366, height: 1000 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('.swatch[data-theme="test-a"]', { state: "attached" });
  await page.fill("#fromUrlInput", "https://shop.example.test/products/mug");
  await page.click("#fromUrlBtn"); await page.waitForFunction(() => window.__vmFromUrlDone);
  await page.evaluate(() => window.__vmGo(3));
  await page.click('.swatch[data-theme="test-a"]');
  check(/PRO · \$3/.test(await page.textContent('.swatch[data-theme="test-a"] .badge')) && (await page.textContent('.swatch[data-theme="midnight-neon"] .badge')) === "FREE", "badges: FREE and 🔒 PRO · $3");
  await page.evaluate(() => window.__vmGo(5));
  let last = await timed("5 make (Designer preview, music)", () => make(page, 300000));
  check(last.stamped === true && await page.isVisible("#proBox") && await page.isHidden("#freeActions"), "Designer theme → stamped preview, no download, unlock offer shown");
  check(/US\$3/.test(await page.textContent("#pwSingle")) && /keep the video maker free/.test(await page.textContent("#proBox")), "the offer shows US$3 and the penny line");
  await shot(page, "7-pro-preview-desktop");
  const nav = page.waitForURL(/unlock=cs_test_ok|theme=/, { timeout: 30000 }).catch(() => {});
  await page.click("#pwSingle"); // saves the project, goes to (mocked) Stripe, which sends us back with ?unlock=
  await nav;
  await page.waitForFunction(() => window.__vmLast && !window.__vmLast.error && window.__vmLast.stamped === false, null, { timeout: 300000 });
  last = await page.evaluate(() => window.__vmLast);
  check(last.stamped === false && await page.isVisible("#freeActions"), "after unlock the video is re-made clean and downloadable");
  check(last.look.theme === "test-a" && (await page.evaluate(() => document.querySelector('#fields input[data-id="name"]').value)) === "Test Ceramic Mug", "the project came back: same theme and words");
  check(!/unlock=/.test(page.url()), "the session id left the address bar");
  await shot(page, "8-unlocked-desktop");
  await page.evaluate(() => window.__vmGo(3)); await page.click('.swatch[data-theme="test-b"]'); await page.evaluate(() => window.__vmGo(5));
  last = await make(page, 300000);
  check(last.stamped === true, "a token for theme A doesn't unlock theme B");
  await ctx.close();
}

// --------------------------------------------------------------------------------- D. phone width, type it myself
{
  const ctx = await context({ width: 390, height: 844 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await shot(page, "1-link-mobile");
  await page.click("#typeMyself");
  check(await page.isVisible('.step[data-step="2"]') && (await page.inputValue('#fields input[data-id="name"]')) !== "", "Type it myself → step 2 with example words");
  await shot(page, "2-words-mobile");
  await page.click('.step[data-step="2"] [data-nav="next"]'); await shot(page, "3-look-mobile");
  await page.click('.step[data-step="3"] [data-nav="next"]'); await shot(page, "4-sound-mobile");
  await page.click('.step[data-step="4"] [data-nav="next"]'); await shot(page, "5-make-mobile");
  const box = await page.locator("#preview").boundingBox(), stepBox = await page.locator('.step[data-step="5"]').boundingBox();
  check(box.y < stepBox.y, "on a phone the preview sits above the steps (from step 2; step 1 shows the link box first)");
  const last = await timed("5 make (phone width, music)", () => make(page, 300000));
  check(!last.error && !last.stamped, "free theme on a phone: video made, not stamped");
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "no sideways scrolling on a phone");
  await shot(page, "6-result-mobile");
  await ctx.close();
}

console.log("timings:", JSON.stringify(timings));
console.log(failed ? `${failed} failure(s)` : "flow: all checks passed");
await browser.close();
process.exit(failed ? 1 : 0);
