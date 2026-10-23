// The 6-step flow (type → link → words → look → sound → make), like a person would use it.
//   node test/flow.mjs <page-url> [shots-dir] [--live] [--no-voice] [--only=promo,tip]
// Without --live the server is mocked (works on a local copy). With --live the real server reads real product pages;
// set VM_TEST_TOKEN in the environment (or .env two folders up) so our own runs don't use up the public limit: the
// token is added only to requests to our server, never to any other site.
// Checks: each type fills the right fields; a change of type keeps what you typed; "Type it myself" gives empty fields
// with hints; exactly one video (or preview) is on screen after making; the AI voice is in the MP4; a Designer theme
// makes a stamped preview and a mocked unlock re-makes it clean.
// SPDX-License-Identifier: GPL-3.0-or-later
import { createRequire } from "node:module";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch { ({ chromium } = createRequire(join(here, "..", "..", "005-woo-ai-readiness", "tests", "qa", "package.json"))("playwright")); }
const args = process.argv.slice(2);
const [url, shots] = args.filter((a) => !a.startsWith("--"));
const LIVE = args.includes("--live"), VOICE = !args.includes("--no-voice");
const ONLY = (args.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
if (shots) mkdirSync(shots, { recursive: true });
let TOKEN = process.env.VM_TEST_TOKEN || "";
const envFile = join(here, "..", "..", "..", ".env");
if (!TOKEN && existsSync(envFile)) TOKEN = (readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("VM_TEST_TOKEN=")) || "").slice(14).trim();

const LINKS = { // real public pages (our partner store is mishbio.us)
  shopify: "https://www.allbirds.com/products/mens-tree-runners",
  woo: "https://mishbio.us/product/peptide-ageless-am-pm-cream/",
  shopify2: "https://www.tentree.com/products/w-tencel-pacific-jogger",
  site: "https://www.leymish.com/",
};
const fake = (id, name, bg) => ({ id, name, font: "inter", texture: "none", bg: { type: "solid", color: bg }, surface: bg,
  ink: "#ffffff", muted: "#dddddd", accent: "#ffcc00", highlight: "#ffcc00", onAccent: "#000000",
  caption: { bg: "rgba(0,0,0,0.85)", ink: "#ffffff" }, pill: "solid", endcard: "center", radius: 10 });
const THEMES = [fake("test-a", "Test A", "#202040"), fake("test-b", "Test B", "#402020")];
const tokenFor = (ids) => Buffer.from(JSON.stringify({ ids })).toString("base64url") + ".sig";
const PHOTO = readFileSync(join(here, "fixtures", "product-1.jpg"));
const STRIPE = "https://pay.example.test/";
const MOCK_PAGES = {
  [LINKS.shopify]: { kind: "product", title: "Men's Tree Runner", price: "$100", benefits: ["Breathable eucalyptus fibre", "Machine washable"] },
  [LINKS.woo]: { kind: "product", title: "Peptide Ageless AM/PM Cream", price: "$38", benefits: ["Smooths fine lines", "Hydrating"] },
  [LINKS.shopify2]: { kind: "product", title: "Tencel Pacific Jogger", price: "$88", benefits: [] },
  [LINKS.site]: { kind: "site", title: "LeyMish Labs", siteName: "LeyMish Labs", description: "Merchant Center fixes for online stores", benefits: [] },
};

let failed = 0;
const results = [];
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); results.push([ok, msg]); if (!ok) failed++; };
const browser = await chromium.launch({ channel: "msedge" });

async function context(viewport, { pack = !LIVE } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/v1/vm/**", async (route) => {
    const req = route.request(), u = new URL(req.url()), body = req.postDataJSON?.() || {};
    const j = (o, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(o) });
    if (LIVE && /\/(from-url|img)$/.test(u.pathname)) return route.continue({ headers: { ...req.headers(), ...(TOKEN ? { "x-vm-test": TOKEN } : {}) } });
    if (!pack && LIVE) return route.continue();
    if (u.pathname.endsWith("/config")) return j({ enabled: true, prices: { single: 3, pack: 5, currency: "USD" }, links: { "test-a": STRIPE + "a", "test-b": STRIPE + "b", pack: STRIPE + "pack" }, themes: THEMES.map(({ id, name }) => ({ id, name })) });
    if (u.pathname.endsWith("/themes")) return j({ themes: THEMES });
    if (u.pathname.endsWith("/verify")) {
      let ids = []; try { ids = JSON.parse(Buffer.from(body.token.split(".")[0], "base64url")).ids; } catch (e) { /* bad token */ }
      return j({ ok: body.token.endsWith(".sig") && ids.includes(body.theme) });
    }
    if (u.pathname.endsWith("/unlock")) return body.session_id === "cs_test_ok" ? j({ token: tokenFor(["test-a"]), ids: ["test-a"] }) : j({ error: "not paid" }, 402);
    if (u.pathname.endsWith("/from-url")) {
      const p = MOCK_PAGES[body.url];
      if (!p) return j({ ok: false, code: "blocked", error: "That site blocks automatic visits, so we couldn't read it. You can still type the details in yourself." }, 422);
      return j({ ok: true, source: "jsonld", currency: "USD", images: ["https://shop.example.test/a.jpg", "https://shop.example.test/b.jpg"], logo: null, url: body.url, ...p });
    }
    if (u.pathname.endsWith("/img")) return route.fulfill({ status: 200, contentType: "image/jpeg", headers: { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" }, body: PHOTO });
    if (u.pathname.endsWith("/subscribe")) return j({ ok: true });
    return j({}, 404);
  });
  await ctx.route(STRIPE + "**", (route) => route.fulfill({ status: 302, headers: { Location: url + "?unlock=cs_test_ok" } }));
  return ctx;
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(shots, name + ".png") }); };
const field = (page, id) => page.inputValue(`#fields input[data-id="${id}"]`);
const visibleScreens = (page) => page.evaluate(() => ["preview", "resultVideo"].filter((id) => { const e = document.getElementById(id); return e && !e.hidden && e.offsetParent; }).length);
async function make(page, timeout = 900000) {
  await page.evaluate(() => { window.__vmLast = null; });
  await page.click("#exportBtn");
  await page.waitForFunction(() => window.__vmLast, null, { timeout });
  return page.evaluate(() => window.__vmLast);
}
async function grab(page, links, extra) {
  await page.evaluate(() => { window.__vmFromUrlDone = null; });
  const boxes = await page.$$(".linkInput");
  for (let i = 0; i < links.length; i++) await boxes[i].fill(links[i]);
  if (extra) await extra();
  const t0 = Date.now();
  await page.click("#fromUrlBtn");
  await page.waitForFunction(() => window.__vmFromUrlDone, null, { timeout: 90000 });
  return { ...(await page.evaluate(() => window.__vmFromUrlDone)), secs: ((Date.now() - t0) / 1000).toFixed(1) };
}
const timings = {};

// ---------------------------------------------------------------------------------------- every type, both widths
for (const [vw, vh, tag] of [[1366, 1000, "desktop"], [390, 844, "mobile"]]) {
  const ctx = await context({ width: vw, height: vh });
  const page = await ctx.newPage();
  const open = async () => { await page.goto(url, { waitUntil: "networkidle" }); await page.waitForSelector(".typecard"); };
  const types = ["promo", "blackfriday", "giftguide", "offer", "tip"].filter((t) => !ONLY.length || ONLY.includes(t));
  for (const type of types) {
    await open();
    check(await page.isVisible('.step[data-step="1"]') && (await page.$$(".typecard")).length === 5, `${tag}/${type}: starts at Type with 5 cards`);
    if (type === "promo") { await shot(page, `${tag}-1-type`); check(await page.isVisible("#exampleTag") || tag === "mobile", `${tag}: the sample preview is labelled Example`); }
    await page.click(`.typecard[data-type="${type}"]`);
    if (type === "tip") {
      check(await page.isVisible('.step[data-step="3"]'), `${tag}/tip: the link step is skipped`);
      check((await field(page, "p1")) === "" && (await page.getAttribute('#fields input[data-id="p1"]', "placeholder")).startsWith("e.g."), `${tag}/tip: empty fields with hints`);
      await page.fill('#fields input[data-id="hook"]', "Three ways to *sell more* this week");
      await page.fill('#fields input[data-id="p1"]', "Reply to every review");
      await page.fill('#fields input[data-id="p2"]', "Post one photo a day");
    } else {
      check(await page.isVisible('.step[data-step="2"]'), `${tag}/${type}: link step shown`);
      await shot(page, `${tag}-2-link-${type}`);
      let r;
      if (type === "promo") r = await grab(page, [LINKS.shopify]);
      if (type === "blackfriday") r = await grab(page, [LINKS.woo], async () => { await page.fill("#bfPct", "30"); await page.fill("#bfCode", "BF30"); });
      if (type === "giftguide") { check((await page.$$(".linkInput")).length === 3, `${tag}/giftguide: 3 link boxes`); r = await grab(page, [LINKS.shopify, LINKS.woo, LINKS.shopify2]); }
      if (type === "offer") r = await grab(page, [LINKS.site]);
      timings[`${tag} ${type} extract`] = r.secs + " s";
      check(r.ok, `${tag}/${type}: details read (${r.ok ? `${r.read || 1} link(s), ${r.photos} photo(s), ${r.secs} s` : r.error})`);
      check(await page.isVisible('.step[data-step="3"]'), `${tag}/${type}: moved on to Words`);
      if (type === "promo") check((await field(page, "name")).includes("Tree Runner") && /\$/.test(await field(page, "price")), `${tag}/promo: name and price from the page`);
      if (type === "blackfriday") check((await field(page, "pct")) === "30% off" && /BF30/.test(await field(page, "code")) && /30% off/.test(await field(page, "hook")), `${tag}/blackfriday: discount, code and hook filled`);
      if (type === "giftguide") check((await field(page, "g1")).includes("Tree Runner") && (await field(page, "g2")).includes("Peptide") && (await field(page, "g3")).length > 0, `${tag}/giftguide: three gifts filled`);
      if (type === "offer") check((await field(page, "what")).length > 5 && /LeyMish/i.test(await field(page, "hook")), `${tag}/offer: description and hook from the website`);
    }
    await shot(page, `${tag}-3-words-${type}`);
    if (type === "promo") { // a change of type keeps what you typed
      await page.fill('#fields input[data-id="name"]', "My Test Product");
      await page.click("#changeType"); await page.click('.typecard[data-type="tip"]');
      await page.evaluate(() => window.__vmGo(1)); await page.click('.typecard[data-type="promo"]');
      await page.evaluate(() => window.__vmGo(3));
      check((await field(page, "name")) === "My Test Product", `${tag}/promo: name kept after Promo → Tip → Promo`);
      check((await field(page, "hook")).length > 0, `${tag}/promo: hook still filled`);
    }
    await page.click('.step[data-step="3"] [data-nav="next"]'); await shot(page, `${tag}-4-look-${type}`);
    await page.click('.step[data-step="4"] [data-nav="next"]'); await shot(page, `${tag}-5-sound-${type}`);
    await page.click('.step[data-step="5"] [data-nav="next"]'); await shot(page, `${tag}-6-make-${type}`);
    const t0 = Date.now();
    const last = await make(page, 300000);
    timings[`${tag} ${type} make`] = ((Date.now() - t0) / 1000).toFixed(1) + " s";
    check(!last.error && last.template === type, `${tag}/${type}: video made (${last.error || last.seconds.toFixed(1) + " s"})`);
    check((await visibleScreens(page)) === 1 && await page.isVisible("#resultVideo"), `${tag}/${type}: exactly one video on screen`);
    await shot(page, `${tag}-7-result-${type}`);
  }
  // Type it myself: empty fields with hints, and no example video by mistake
  if (!ONLY.length || ONLY.includes("promo")) {
    await open();
    await page.click('.typecard[data-type="promo"]'); await page.click("#typeMyself");
    check((await field(page, "name")) === "" && (await page.getAttribute('#fields input[data-id="name"]', "placeholder")).startsWith("e.g."), `${tag}: Type it myself → empty fields with hints`);
    await page.evaluate(() => window.__vmGo(6));
    const last = await make(page, 60000);
    check(!!last.error && /details first|Fill in/.test(last.error), `${tag}: no example video made by mistake ("${(last.error || "").slice(0, 60)}")`);
    // a link that can't be read: a clear card with a big way out
    await page.evaluate(() => window.__vmGo(1)); await page.click('.typecard[data-type="promo"]');
    await grab(page, ["https://www.patagonia.com/product/mens-better-sweater-fleece-jacket/25528.html"]);
    check(await page.isVisible("#linkError") && await page.isVisible("#typeInstead"), `${tag}: unreadable link → error card with "Type it myself instead"`);
    await shot(page, `${tag}-2-link-error`);
  }
  await ctx.close();
}

// ------------------------------------------------------------------------------ AI voice and Designer themes (mocked pack)
if (!ONLY.length) {
  const ctx = await context({ width: 1366, height: 1000 }, { pack: true });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" }); await page.waitForSelector('.swatch[data-theme="test-a"]', { state: "attached" });
  await page.click('.typecard[data-type="promo"]');
  await grab(page, [LINKS.woo]);
  if (VOICE) {
    await page.evaluate(() => window.__vmGo(5)); await page.click('[data-sound="ai"]'); await page.selectOption("#music", "none");
    await page.evaluate(() => window.__vmGo(6));
    const t0 = Date.now(); const last = await make(page);
    timings["desktop AI voice make (first load)"] = ((Date.now() - t0) / 1000).toFixed(1) + " s";
    const lv = await page.evaluate(async () => {
      const a = await new AudioContext().decodeAudioData(await (await fetch(document.getElementById("download").href)).arrayBuffer());
      const d = a.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * d[i];
      return { rms: Math.sqrt(s / (d.length / 4)), seconds: a.duration };
    });
    check(!last.error && last.voice === "ai" && lv.rms > 0.01, `AI voice: the MP4 has a voice track with no music (rms ${lv.rms.toFixed(3)}, ${lv.seconds.toFixed(1)} s)`);
    await page.evaluate(() => window.__vmGo(5)); await page.click('[data-sound="none"]'); await page.selectOption("#music", "bright");
  }
  await page.evaluate(() => window.__vmGo(4)); await page.click('.swatch[data-theme="test-a"]'); await page.evaluate(() => window.__vmGo(6));
  let last = await make(page, 300000);
  check(last.stamped === true && await page.isVisible("#proBox") && await page.isHidden("#freeActions") && (await visibleScreens(page)) === 1, "Designer theme: one stamped preview, no download, the US$3 offer");
  await shot(page, "desktop-8-pro-preview");
  const nav = page.waitForURL(/theme=|unlock=/, { timeout: 30000 }).catch(() => {});
  await page.click("#pwSingle"); await nav;
  await page.waitForFunction(() => window.__vmLast && !window.__vmLast.error && window.__vmLast.stamped === false, null, { timeout: 300000 });
  last = await page.evaluate(() => window.__vmLast);
  check(last.stamped === false && last.look.theme === "test-a" && last.template === "promo", "after unlock: re-made clean with the same theme and type");
  check((await visibleScreens(page)) === 1, "after unlock: one video on screen");
  await shot(page, "desktop-9-unlocked");
  await ctx.close();
}

console.log("timings:", JSON.stringify(timings));
console.log(failed ? `${failed} failure(s) of ${results.length}` : `flow: all ${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
