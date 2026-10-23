// The optional Designer-themes gate, with the server mocked: a locked theme can't export without a token the server
// accepts, a token for theme A doesn't unlock theme B, and an unlock from the checkout return URL works.
//   node test/paywall.mjs http://127.0.0.1:8765/tools/video-maker/        (exit code 1 on any failure)
// SPDX-License-Identifier: GPL-3.0-or-later
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch { ({ chromium } = createRequire(join(here, "..", "..", "005-woo-ai-readiness", "tests", "qa", "package.json"))("playwright")); }
const url = process.argv[2];
const fake = (id, name, bg) => ({ id, name, font: "inter", texture: "none", bg: { type: "solid", color: bg }, surface: bg,
  ink: "#ffffff", muted: "#dddddd", accent: "#ffcc00", highlight: "#ffcc00", onAccent: "#000000",
  caption: { bg: "rgba(0,0,0,0.85)", ink: "#ffffff" }, pill: "solid", endcard: "center", radius: 10 });
const THEMES = [fake("test-a", "Test A", "#202040"), fake("test-b", "Test B", "#402020")];
const tokenFor = (ids) => Buffer.from(JSON.stringify({ ids })).toString("base64url") + ".sig";

let failed = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) failed++; };
const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext();
await ctx.route("**/v1/vm/**", async (route) => {
  const u = new URL(route.request().url()), body = route.request().postDataJSON?.() || {};
  const j = (o) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
  if (u.pathname.endsWith("/config")) return j({ enabled: true, prices: { single: 2, pack: 5, currency: "USD" }, links: { "test-a": "https://pay.example/a", pack: "https://pay.example/pack" }, themes: THEMES.map(({ id, name }) => ({ id, name })), logo: true });
  if (u.pathname.endsWith("/themes")) return j({ themes: THEMES });
  if (u.pathname.endsWith("/verify")) { // the server's rule: a good signature and the theme in the token
    let ids = []; try { ids = JSON.parse(Buffer.from(body.token.split(".")[0], "base64url")).ids; } catch (e) { /* bad token */ }
    return j({ ok: body.token.endsWith(".sig") && ids.includes(body.theme) });
  }
  if (u.pathname.endsWith("/unlock")) return body.session_id === "cs_test_ok" ? j({ token: tokenFor(["test-a"]), ids: ["test-a"] }) : route.fulfill({ status: 402, body: '{"error":"not paid"}' });
  return route.fulfill({ status: 404, body: "{}" });
});
const page = await ctx.newPage();
const open = async (q = "") => { await page.goto(url + q, { waitUntil: "networkidle" }); await page.waitForSelector('.swatch[data-theme="test-a"]'); };
const exportTry = async () => {
  await page.evaluate(() => { window.__vmLast = null; document.getElementById("exportBtn").click(); });
  await page.waitForTimeout(600);
  return page.evaluate(() => ({ paywall: document.getElementById("paywall").open, started: !!window.__vmLast || /Mixing|Making|Done/.test(document.getElementById("exportStatus").textContent) }));
};

await open();
check(await page.textContent('.swatch[data-theme="midnight-neon"] .badge') === "FREE", "free themes show FREE");
check(/PRO · \$2/.test(await page.textContent('.swatch[data-theme="test-a"] .badge')), "paid themes show PRO · $2 with a lock");
await page.click('.swatch[data-theme="test-a"]');
check(!(await page.isHidden("#lockNote")), "picking a paid theme previews it with a note");
let r = await exportTry();
check(r.paywall && !r.started, "no token: export opens the paywall instead");
check((await page.getAttribute("#pwSingle", "href")) === "https://pay.example/a" && (await page.getAttribute("#pwPack", "href")) === "https://pay.example/pack", "paywall links the single and the pack");
await page.click("#pwClose");

await page.evaluate((t) => localStorage.setItem("vm-unlock", JSON.stringify([t])), tokenFor(["test-a"]).replace(".sig", ".bad"));
await open("?theme=test-a");
r = await exportTry();
check(r.paywall, "a bad signature doesn't unlock");
await page.click("#pwClose");

await page.evaluate(() => localStorage.removeItem("vm-unlock"));
await open("?unlock=cs_test_ok&theme=test-b");
check(/unlocked/i.test(await page.textContent("#unlockMsg")), "checkout return unlocks and says thank you");
check(!/unlock=/.test(page.url()), "the session id is removed from the address bar");
check(await page.textContent('.swatch[data-theme="test-a"] .badge') === "Unlocked", "bought theme shows Unlocked");
await page.click('.swatch[data-theme="test-b"]');
r = await exportTry();
check(r.paywall, "a token for theme A doesn't unlock theme B");
await page.click("#pwClose");
await page.click('.swatch[data-theme="test-a"]');
r = await exportTry();
check(!r.paywall && r.started, "theme A exports with its token");
await page.click('.swatch[data-theme="clean-mono"]');
await page.waitForFunction(() => !document.getElementById("exportBtn").disabled, null, { timeout: 120000 });
r = await exportTry();
check(!r.paywall && r.started, "free themes always export");

console.log(failed ? `${failed} failure(s)` : "paywall: all checks passed");
await browser.close();
process.exit(failed ? 1 : 0);
