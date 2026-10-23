// Free Video Maker: the page. Six steps (type, link, words, look, sound, make) beside one screen that shows the live
// preview, then the progress, then the finished video. Everything runs here, on the visitor's device: photos are read
// locally, the voice runs in a worker, the MP4 is encoded with WebCodecs. Nothing is uploaded.
// SPDX-License-Identifier: GPL-3.0-or-later
import { SIZES, drawFrame, drawSwatch, timeline, totalDuration } from "./engine.js";
import { THEMES, THEME_IDS, DEFAULT_THEME, FONTS, MOTIONS, TEXTURES, FONT_FILES, customTheme, logoColors, logoTheme } from "./themes.js";
import { TEMPLATES, buildScenes } from "./templates.js";
import { BEDS, renderBed } from "./music.js";
import { exportMp4, mixAudio, support } from "./export.js";
import { apiBase, loadPack, canExport, redeem, restore, saveToken, claimedIds } from "./premium.js";
import { readPage, proxied, dataFrom, clip } from "./fromurl.js";

const VOICES = [
  { id: "af_heart", name: "Heart (US, female)" }, { id: "af_bella", name: "Bella (US, female)" },
  { id: "am_michael", name: "Michael (US, male)" }, { id: "am_fenrir", name: "Fenrir (US, male)" },
  { id: "bf_emma", name: "Emma (UK, female)" }, { id: "bm_george", name: "George (UK, male)" },
];
const LEAD = 0.12, TAIL = 0.45; // voice starts just after a scene starts; a little air after it ends
const ORDER = ["promo", "blackfriday", "giftguide", "offer", "tip"];
const TYPE_LINE = { promo: "Show one product", blackfriday: "A % off offer", giftguide: "Up to 3 products", offer: "News for your business", tip: "Share 3 quick tips" };
const TYPE_NAME = { promo: "Product promo", blackfriday: "Black Friday sale", giftguide: "Christmas gift guide", offer: "Announcement / offer", tip: "Tip / explainer" };
// Each type's fields, mapped to shared keys: what you type or what a link gives survives a change of type
const MAP = {
  promo: { hook: "hook.promo", name: "name", price: "price", b1: "point.0", b2: "point.1", b3: "point.2", cta: "cta.promo", url: "url" },
  tip: { hook: "hook.tip", p1: "point.0", p2: "point.1", p3: "point.2", cta: "cta.tip", url: "url" },
  offer: { hook: "hook.offer", what: "what", d1: "point.0", d2: "point.1", when: "when", url: "url" },
  blackfriday: { hook: "hook.blackfriday", pct: "discount", what: "covers", code: "code", until: "until", cta: "cta.blackfriday", url: "url" },
  giftguide: { hook: "hook.giftguide", g1: "gift.0.name", p1: "gift.0.price", g2: "gift.1.name", p2: "gift.1.price", g3: "gift.2.name", p3: "gift.2.price", cta: "cta.giftguide", url: "url" },
};
const ALIAS = { "gift.0.name": "name", "gift.0.price": "price", name: "gift.0.name", price: "gift.0.price" }; // one product ↔ gift 1
const REQUIRED = { promo: ["name"], tip: ["point.0"], offer: ["what"], blackfriday: ["discount"], giftguide: ["gift.0.name"] };
const LINK = { // what the link step asks for, per type
  promo: { boxes: 1, label: "Paste your product link", intro: "We read your product page's public details (name, price, photos) and write the first draft." },
  blackfriday: { boxes: 1, label: "Paste your product (or shop) link", intro: "We read the page's details; you add the discount.", bf: true },
  giftguide: { boxes: 3, label: "Product link", intro: "Add up to 3 product links. We read each one's name, price and photo." },
  offer: { boxes: 1, label: "Paste your website link", intro: "We read your site's name, description and picture." },
  tip: null,
};

const $ = (id) => document.getElementById(id);
const gtagEvent = (name, params = {}) => { try { window.gtag && window.gtag("event", name, params); } catch (e) { /* no analytics */ } };
const browser = () => { const u = navigator.userAgent; return /Edg\//.test(u) ? "edge" : /Firefox\//.test(u) ? "firefox"
  : /Chrome\//.test(u) ? (/Android/.test(u) ? "chrome-android" : "chrome") : /Safari\//.test(u) ? "safari" : "other"; };
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } } };
const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

const state = {
  step: 1, template: "promo", user: {}, auto: {}, photos: [], logo: null, aspect: "9x16",
  theme: DEFAULT_THEME, custom: { bg: "#16181d", ink: "#f7f6f2", accent: "#4cc38a" }, logoLook: null, logoColors: null,
  font: "", motion: "smooth", texture: "", // "" = the theme's own font / texture
  voiceMode: "none", voice: "af_heart", speed: 1, clips: {}, clipsKey: "", recording: null, recordingBlob: null,
  bed: "bright", endcard: true, captions: true, playing: false, t0: 0, fromUrl: null, showingResult: false,
};
let worker = null, voiceReady = null, pending = new Map(), seq = 0, extracts = 0;

// ------------------------------------------------------------------------------------------------- shared words
/** A shared field's text: what the user typed (even if they cleared it), else what a link gave, else "". */
function val(k) {
  if (k in state.user) return state.user[k];
  if (k in state.auto) return state.auto[k];
  const a = ALIAS[k];
  if (a) { if (a in state.user) return state.user[a]; if (a in state.auto) return state.auto[a]; }
  return "";
}
const hasData = () => Object.values(state.user).some((v) => String(v).trim()) || Object.keys(state.auto).length > 0 || state.photos.length > 0;
/** Hooks written from the data, per type (rule-based); the user's own hook always wins (it's in state.user). */
function writeHooks() {
  const name = val("name") || val("gift.0.name"), site = state.auto.site || "";
  const short = clip(String(name).split(/[|–—:]/)[0], 32);
  const pct = String(val("discount")).replace(/\s*off\s*$/i, "").trim();
  const gifts = [0, 1, 2].filter((i) => val(`gift.${i}.name`)).length;
  const set = (k, v) => { if (v) state.auto[k] = v; else delete state.auto[k]; };
  set("hook.promo", short ? (words(short) <= 5 ? `Meet *${short}*.` : `New in store: *${clip(short, 28)}*`) : "");
  set("hook.blackfriday", pct ? `*${pct} off* ${short || "everything"}, this week only.` : short ? `*Black Friday* deal: ${short}.` : "");
  set("hook.giftguide", gifts ? `Our Christmas *gift guide*: ${gifts === 1 ? "a pick" : `${gifts} picks`} they'll love.` : "");
  set("hook.offer", site ? `Say hello to *${site}*.` : short ? `New: *${short}*.` : "");
  if (state.auto.url || val("name")) { // sensible calls to action once there's something real to sell
    state.auto["cta.promo"] = state.auto["cta.promo"] || "Shop now";
    state.auto["cta.blackfriday"] = state.auto["cta.blackfriday"] || "Shop the sale";
    state.auto["cta.giftguide"] = state.auto["cta.giftguide"] || "Shop the gift guide";
  }
}
/** The values a template's scenes are built from: the user's or the link's words, never the example text. */
function values(tpl = state.template) {
  if (!hasData()) return {}; // nothing yet: the template's example, labelled "Example" on screen
  return Object.fromEntries(TEMPLATES[tpl].fields.map((f) => [f.id, val(MAP[tpl][f.id])]));
}

// ------------------------------------------------------------------------------------------------------- the steps
const linkSkipped = () => !LINK[state.template];
function go(n) {
  n = Math.max(1, Math.min(6, n));
  if (n === 2 && linkSkipped()) n = state.step > 2 ? 1 : 3; // a tip needs no link
  state.step = n;
  document.querySelector(".studio").dataset.step = n;
  document.querySelectorAll(".step").forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
  document.querySelectorAll(".stepper button").forEach((b) => {
    const k = Number(b.dataset.go);
    b.toggleAttribute("aria-current", false);
    if (k === n) b.setAttribute("aria-current", "step");
    b.classList.toggle("done", k < n);
    b.disabled = k === 2 && linkSkipped();
  });
  if (n === 2) renderLinkStep();
  if (n === 3) renderFields();
  if (n === 6) summary();
  if (n < 6) showPreview();
  gtagEvent("vm_step", { step: n, type: state.template });
  const sec = document.querySelector(`.step[data-step="${n}"]`);
  if (sec && sec.getBoundingClientRect().top < 0) sec.scrollIntoView({ behavior: "smooth", block: "start" });
}
function summary() {
  const th = theme();
  const sound = { none: `${BEDS[state.bed].name} music`, ai: `AI voice (${VOICES.find((v) => v.id === state.voice).name}) + ${BEDS[state.bed].name.toLowerCase()}`,
    record: `your own voice + ${BEDS[state.bed].name.toLowerCase()}` }[state.voiceMode];
  $("summary").textContent = `${TYPE_NAME[state.template]} · ${th.name || "Custom"}${isLocked(state.theme) ? " (Designer theme: the preview is stamped until you unlock it)" : ""} · ${state.aspect.replace("x", ":")} · ${sound}. About ${estimate()} s to make.`;
}

// ------------------------------------------------------------------------------------------------------- 1. type
function renderTypes() {
  const box = $("typeCards");
  box.innerHTML = "";
  ORDER.forEach((tpl) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "typecard"; b.dataset.type = tpl; b.setAttribute("aria-pressed", String(tpl === state.template));
    const c = document.createElement("canvas"); c.width = 180; c.height = 320; c.setAttribute("aria-hidden", "true");
    const t = document.createElement("b"); t.textContent = TYPE_NAME[tpl];
    const s = document.createElement("span"); s.textContent = TYPE_LINE[tpl];
    b.append(c, t, s);
    b.addEventListener("click", () => pickType(tpl, true));
    box.appendChild(b);
  });
  drawTypeCards();
}
function drawTypeCards() {
  document.querySelectorAll(".typecard").forEach((b) => {
    const c = b.querySelector("canvas"), x = c.getContext("2d"), k = c.width / 1080;
    const tl = timeline(buildScenes(b.dataset.type, {}, { endcard: false }));
    x.setTransform(k, 0, 0, k, 0, 0);
    drawFrame(x, tl, 1.0, { width: 1080, height: 1920, ...look(), assets: { photos: [], logo: null }, captions: false });
    x.setTransform(1, 0, 0, 1, 0, 0);
  });
}
function pickType(tpl, advance) {
  state.template = tpl;
  document.querySelectorAll(".typecard").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === tpl)));
  writeHooks(); restart();
  gtagEvent("vm_type", { type: tpl });
  if (advance) go(LINK[tpl] ? 2 : 3);
}

// ------------------------------------------------------------------------------------------------------- 2. link
function renderLinkStep() {
  const L = LINK[state.template];
  $("linkError").hidden = true;
  if (!L) return;
  $("s2h").textContent = state.template === "giftguide" ? "Paste up to 3 product links" : L.label;
  $("linkIntro").textContent = L.intro;
  $("bfBox").hidden = !L.bf;
  const box = $("linkBoxes"), old = [...box.querySelectorAll("input")].map((i) => i.value);
  box.innerHTML = "";
  for (let i = 0; i < L.boxes; i++) {
    const inp = document.createElement("input");
    inp.type = "url"; inp.inputMode = "url"; inp.className = "linkInput"; inp.value = old[i] || "";
    inp.placeholder = L.boxes > 1 ? `Product ${i + 1} link${i ? " (optional)" : ""}` : L.label;
    inp.setAttribute("aria-label", inp.placeholder);
    if (i === 0) inp.id = "fromUrlInput";
    box.appendChild(inp);
  }
}
function linkError(msg) {
  $("linkError").hidden = false;
  $("linkErrorText").textContent = msg;
  $("linkError").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
async function grab() {
  const links = [...document.querySelectorAll(".linkInput")].map((i) => i.value.trim()).filter(Boolean)
    .map((u) => (/^https?:\/\//i.test(u) ? u : "https://" + u));
  $("linkError").hidden = true;
  if (state.template === "blackfriday") { // the discount and code come from the shop owner, not the page
    const pct = $("bfPct").value.replace(/[^\d.]/g, ""), code = $("bfCode").value.trim();
    if (pct) state.auto.discount = `${pct}% off`; else delete state.auto.discount;
    if (code) state.auto.code = `Use code ${code} at checkout`; else delete state.auto.code;
  }
  if (!links.length) {
    if (state.template === "blackfriday" && state.auto.discount) { writeHooks(); go(3); return; }
    linkError("Paste a link first, or type your details yourself."); return;
  }
  if (extracts + links.length > 10) { linkError("That's 10 links for this visit. Type your details instead, or reload the page later."); return; }
  $("fromUrlBtn").disabled = true;
  const t0 = performance.now();
  const gift = state.template === "giftguide";
  let ok = 0, lastErr = null, kind = null, source = null;
  if (gift) state.photos = [];
  for (let i = 0; i < links.length; i++) {
    $("fromUrlStatus").textContent = links.length > 1 ? `Reading link ${i + 1} of ${links.length}…` : "Reading your page…";
    try {
      extracts++;
      const page = await readPage(API, links[i]);
      const d = dataFrom(page);
      kind = page.kind; source = page.source;
      if (gift) {
        state.auto[`gift.${i}.name`] = d.name || d.site || "";
        if (d.price) state.auto[`gift.${i}.price`] = d.price;
        if (page.images && page.images[0]) { const img = await proxied(API, page.images[0]); if (img) state.photos[i] = img; }
        if (i === 0) state.auto.url = d.url;
      } else {
        Object.assign(state.auto, d);
        const want = TEMPLATES[state.template].photos || 1;
        $("fromUrlStatus").textContent = `Found "${page.title || page.siteName || "your page"}"${page.price ? `, price ${page.price}` : ""}. Loading photos…`;
        state.photos = (await Promise.all((page.images || []).slice(0, Math.max(want, 1)).map((u) => proxied(API, u)))).filter(Boolean).slice(0, Math.max(want, 1));
      }
      if (page.logo && !state.logo) { const logo = await proxied(API, page.logo); if (logo) { state.logo = logo; readLogoColors(); } }
      state.fromUrl = { kind: page.kind, host: d.url };
      ok++;
    } catch (e) {
      lastErr = e;
      gtagEvent("vm_extract", { result: "fail", type: state.template, code: e.code || "", message: String(e.message).slice(0, 80) });
    }
  }
  if (gift) state.photos = state.photos.filter(Boolean);
  $("fromUrlBtn").disabled = false;
  if (!ok) {
    $("fromUrlStatus").textContent = "Use pages you own or have permission to use.";
    linkError(lastErr ? lastErr.message : "We couldn't read that page.");
    window.__vmFromUrlDone = { ok: false, error: String(lastErr && lastErr.message), code: lastErr && lastErr.code };
    return;
  }
  writeHooks(); restart();
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  $("fromUrlStatus").textContent = `Done in ${secs} s: ${gift ? `${ok} of ${links.length} products` : `${state.photos.length} photo${state.photos.length === 1 ? "" : "s"}${val("price") ? `, price ${val("price")}` : ""}`}. Check the words next.`;
  gtagEvent("vm_extract", { result: "ok", type: state.template, source: source || "", kind: kind || "", links: links.length, ok });
  window.__vmFromUrlDone = { ok: true, kind, source, photos: state.photos.length, links: links.length, read: ok, ...(lastErr ? { partial: String(lastErr.message) } : {}) };
  if (lastErr) linkError(`One link couldn't be read (${lastErr.message}). The others are filled in; you can type the missing one.`);
  else go(3);
}

// ------------------------------------------------------------------------------------------------------ 3. words
function renderFields() {
  const t = TEMPLATES[state.template];
  $("typeName").textContent = TYPE_NAME[state.template];
  $("blurb").textContent = t.blurb;
  $("fields").innerHTML = "";
  t.fields.forEach((f) => {
    const key = MAP[state.template][f.id];
    const lab = document.createElement("label");
    lab.textContent = f.label;
    const inp = document.createElement("input");
    inp.type = "text"; inp.maxLength = 90; inp.dataset.id = f.id; inp.dataset.key = key;
    inp.value = val(key);
    inp.placeholder = `e.g. ${String(f.value).replace(/\*/g, "")}`;
    inp.addEventListener("input", () => {
      state.user[key] = inp.value;
      if (/^(name|price|discount|gift\.0\.name)$/.test(key)) writeHooks(); // the auto hook follows the product name
      refreshHookField(); restart();
    });
    lab.appendChild(inp);
    $("fields").appendChild(lab);
  });
  $("photosRow").hidden = !t.photos;
  $("photoHint").textContent = t.photos ? `Up to ${t.photos} photo${t.photos > 1 ? "s" : ""}, picked from your device (never uploaded).${state.photos.length ? ` ${state.photos.length} added.` : ""}` : "";
}
function refreshHookField() { // the hook field shows the newly written hook unless the user typed their own
  const inp = document.querySelector('#fields input[data-id="hook"]');
  if (inp && !(inp.dataset.key in state.user) && document.activeElement !== inp) inp.value = val(inp.dataset.key);
}

function rawScenes() { return buildScenes(state.template, values(), { endcard: state.endcard, photos: state.photos.length }); }
const voiceKey = () => JSON.stringify([rawScenes().map((s) => s.say || s.line || ""), state.voice, state.speed]);
function scenes() {
  const fresh = state.voiceMode === "ai" && state.clipsKey === voiceKey();
  return rawScenes().map((s, i) => { // the voice clip sets each scene's length
    const c = fresh ? state.clips[i] : null;
    return c ? { ...s, dur: Math.max(s.dur * 0.6, c.audio.length / c.rate + LEAD + TAIL) } : s;
  });
}

function theme() {
  if (state.theme === "custom") return customTheme(state.custom.bg, state.custom.ink, state.custom.accent).theme;
  if (state.theme === "logo" && state.logoLook) return state.logoLook;
  return THEMES.find((x) => x.id === state.theme) || PACK.themes.find((x) => x.id === state.theme) || THEMES[0];
}
const look = () => { const th = theme(); return { theme: th, font: state.font || th.font, motion: state.motion, texture: state.texture || th.texture }; };
function opts(extra = {}) {
  const [width, height] = SIZES[state.aspect];
  return { width, height, ...look(), assets: { photos: state.photos, logo: state.logo }, captions: state.captions, ...extra };
}
const estimate = () => Math.round(totalDuration(timeline(scenes())) * 1.4 + 3); // measured: about 1.4× real time on a 4-core laptop

// ---------------------------------------------------------------------------------------- the screen (one video)
const canvas = $("preview"), ctx = canvas.getContext("2d");
let previewAudio = null;
function restart() {
  const o = opts();
  canvas.width = o.width; canvas.height = o.height;
  canvas.classList.toggle("landscape", state.aspect === "16x9");
  $("resultVideo").classList.toggle("landscape", state.aspect === "16x9");
  state.t0 = performance.now();
  stopAudio();
  if (state.playing) playAudio();
}
function showPreview() { // the live preview is back: edit mode
  if (!state.showingResult) return;
  state.showingResult = false;
  const v = $("resultVideo"); v.pause(); v.hidden = true;
  canvas.hidden = false; $("previewRow").hidden = false;
}
function showVideo(url) { // the finished video takes the preview's place: one video on screen
  state.showingResult = true;
  state.playing = false; stopAudio(); $("playBtn").textContent = "▶ Play";
  const v = $("resultVideo");
  try { drawFrame(ctx, timeline(scenes()), 1.2, opts()); v.poster = canvas.toDataURL("image/jpeg", 0.8); } catch (e) { /* no poster */ }
  v.src = url; v.hidden = false;
  canvas.hidden = true; $("previewRow").hidden = true; $("exampleTag").hidden = true;
}
function frame() {
  const tl = timeline(scenes());
  const total = totalDuration(tl);
  let t = state.playing ? (performance.now() - state.t0) / 1000 : 0.8;
  if (t > total) { state.t0 = performance.now(); t = 0; stopAudio(); if (state.playing) playAudio(); }
  if (!state.showingResult) {
    drawFrame(ctx, tl, t, opts());
    $("exampleTag").hidden = hasData();
  }
  $("dur").textContent = `${total.toFixed(1)} s`;
  if (live) drawSwatch(live.ctx, live.theme, (performance.now() / 1000) % 1.6, state.font, state.motion);
  requestAnimationFrame(frame);
}
async function playAudio() { // what the export will sound like, mixed live (the voice only once it's made)
  const tl = timeline(scenes());
  const bed = state.bed !== "none" ? await renderBed(state.bed, totalDuration(tl)) : null;
  const fresh = state.voiceMode === "ai" && state.clipsKey === voiceKey();
  const mix = await mixAudio(tl, { clips: fresh ? state.clips : {}, recording: state.voiceMode === "record" ? state.recording : null, bed, lead: LEAD });
  const ac = new AudioContext();
  const src = ac.createBufferSource(); src.buffer = mix; src.connect(ac.destination);
  src.start(0, Math.max(0, (performance.now() - state.t0) / 1000));
  previewAudio = { ac, src };
}
function stopAudio() { if (previewAudio) { try { previewAudio.src.stop(); previewAudio.ac.close(); } catch (e) { /* already stopped */ } previewAudio = null; } }
async function playBuffer(buf, seconds) {
  const ac = new AudioContext(), src = ac.createBufferSource();
  src.buffer = buf; src.connect(ac.destination); src.start(0, 0, seconds);
  src.onended = () => ac.close();
}

// ----------------------------------------------------------------------------------------------------- the voice
function loadVoice(onStatus) {
  if (voiceReady) return voiceReady;
  worker = new Worker(new URL("./voice-worker.js", import.meta.url), { type: "module" });
  const files = new Map(), t0 = performance.now();
  voiceReady = new Promise((res, rej) => {
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "progress") {
        files.set(m.file, [m.loaded, m.total]);
        const [l, t] = [...files.values()].reduce((a, [x, y]) => [a[0] + x, a[1] + (y || 0)], [0, 0]);
        onStatus(`Downloading the voice (first time only): ${(l / 1e6).toFixed(0)} of ${(t / 1e6).toFixed(0)} MB…`, t ? l / t : 0);
      } else if (m.type === "ready") {
        gtagEvent("vm_voice_load", { device: m.device, browser: browser(), ms: Math.round(performance.now() - t0) });
        res(true);
      } else if (m.type === "audio" || m.type === "error") {
        const p = pending.get(m.id); pending.delete(m.id);
        if (p) (m.type === "audio" ? p.res(m) : p.rej(new Error(m.message)));
        else if (m.type === "error") rej(new Error(m.message || "the voice couldn't load"));
      }
    };
    worker.onerror = (e) => rej(new Error(e.message || "the voice couldn't start"));
  });
  // default: the 90 MB quantised model on WebAssembly (works everywhere). ?webgpu: the GPU with the full model, for testing
  worker.postMessage({ type: "load", device: new URLSearchParams(location.search).has("webgpu") && navigator.gpu ? "webgpu" : "wasm" });
  voiceReady.catch(() => { voiceReady = null; worker = null; });
  return voiceReady;
}
function speak(text) {
  const id = ++seq;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ type: "speak", id, text, voice: state.voice, speed: state.speed }); });
}
/** Makes every line's clip if the words, voice or speed changed. Throws (loudly) if it can't. */
async function ensureVoice(onStatus) {
  const key = voiceKey();
  if (state.clipsKey === key && Object.keys(state.clips).length) return;
  await loadVoice(onStatus);
  const raw = rawScenes(), lines = raw.map((s, i) => [i, s.say || s.line]).filter(([, l]) => l);
  const clips = {};
  for (let k = 0; k < lines.length; k++) {
    const [i, text] = lines[k];
    onStatus(`Making the voice: line ${k + 1} of ${lines.length}…`, k / lines.length);
    const m = await speak(text);
    if (!m.audio || !m.audio.length) throw new Error("the voice came back empty");
    clips[i] = { audio: m.audio, rate: m.rate };
  }
  state.clips = clips; state.clipsKey = key;
}

// -------------------------------------------------------------------------------------------------- record my own
let recorder = null;
async function record() {
  if (recorder) { recorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      state.recordingBlob = new Blob(chunks, { type: recorder.mimeType });
      state.recording = await new AudioContext().decodeAudioData(await state.recordingBlob.arrayBuffer());
      recorder = null; $("recBtn").textContent = "● Record again";
      $("voiceStatus").textContent = `Recorded ${state.recording.duration.toFixed(1)} s. It plays under the video from the start.`;
      restart();
    };
    state.playing = true; $("playBtn").textContent = "❚❚ Pause"; stopAudio(); state.t0 = performance.now(); // read the captions as the preview plays
    recorder.start();
    $("recBtn").textContent = "■ Stop recording";
    $("voiceStatus").textContent = "Recording: read each caption as it appears, then click Stop.";
    setTimeout(() => recorder && recorder.state === "recording" && recorder.stop(), totalDuration(timeline(scenes())) * 1000 + 300);
  } catch (e) {
    $("voiceStatus").textContent = "No microphone access, so nothing was recorded.";
  }
}
function setSound(mode) {
  state.voiceMode = mode;
  document.querySelectorAll("[data-sound]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sound === mode)));
  $("aiBox").hidden = mode !== "ai"; $("recBox").hidden = mode !== "record";
  $("voiceStatus").textContent = "";
  restart();
}

// ------------------------------------------------------------------------------------------------- make the video
function progress(label, p) {
  $("progressBox").hidden = false;
  $("exportStatus").textContent = label;
  if (p != null) $("progressBar").style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
}
function missing() { // what must be filled before a real video is made
  if (!hasData()) return "Add your details first (step 3): the screen is only showing an example.";
  const need = REQUIRED[state.template].filter((k) => !String(val(k)).trim());
  if (!need.length) return null;
  const label = (k) => { const id = Object.keys(MAP[state.template]).find((f) => MAP[state.template][f] === k); return TEMPLATES[state.template].fields.find((f) => f.id === id).label; };
  return `Fill in "${need.map(label).join('", "')}" first (step 3).`;
}
let lastBlobUrl = null;
async function doMake() {
  const btn = $("exportBtn");
  $("makeError").hidden = true;
  const miss = missing();
  if (miss) { $("makeError").hidden = false; $("makeError").textContent = miss; window.__vmLast = { error: miss }; return; }
  btn.disabled = true;
  $("result").hidden = true;
  showPreview();
  const t0 = performance.now();
  const stamped = isLocked(state.theme) && !(await canExport(API, state.theme).catch(() => false));
  try {
    stopAudio(); state.playing = false; $("playBtn").textContent = "▶ Play";
    await fontsReady;
    $("stageLabel").textContent = "Making your video…";
    if (state.voiceMode === "ai") { // the voice is always made before the video when it's chosen; never a silent fallback
      try { await ensureVoice((label, p) => progress(`Step 1 of 3 · ${label}`, (p || 0) * 0.35)); }
      catch (e) { throw new Error(`The AI voice couldn't be made on this device (${e.message}). Choose "Music only" or "My own voice" in step 5, or try Chrome on a computer.`); }
    }
    if (state.voiceMode === "record" && !state.recording) throw new Error('Record your voice first (step 5), or choose "Music only".');
    const tl = timeline(scenes());
    const total = totalDuration(tl);
    progress("Step 2 of 3 · Mixing the sound…", state.voiceMode === "ai" ? 0.36 : 0.05);
    const bed = state.bed !== "none" ? await renderBed(state.bed, total) : null;
    const audio = (bed || state.voiceMode !== "none") ? await mixAudio(tl, { clips: state.voiceMode === "ai" ? state.clips : {},
      recording: state.voiceMode === "record" ? state.recording : null, bed, lead: LEAD }) : null;
    const base = state.voiceMode === "ai" ? 0.38 : 0.08;
    const { blob, codecs } = await exportMp4(tl, opts({ stamp: stamped }), audio, (p) => progress(`Step 3 of 3 · Drawing and encoding: ${Math.round(p * 100)}% (about ${Math.max(1, Math.round((1 - p) * total * 1.4))} s left)`, base + p * (1 - base)));
    const secs = (performance.now() - t0) / 1000;
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    const url = lastBlobUrl = URL.createObjectURL(blob);
    $("progressBox").hidden = true;
    showVideo(url);
    $("doneLine").textContent = `Done in ${secs.toFixed(1)} s: ${total.toFixed(1)} s video, ${(blob.size / 1e6).toFixed(1)} MB, ${codecs.video.toUpperCase()}${codecs.audio ? " + " + codecs.audio.toUpperCase() : ""}.`;
    $("result").hidden = false;
    const a = $("download");
    a.href = url; a.download = `video-${state.template}-${state.aspect}-${Date.now()}.mp4`;
    showResult(stamped);
    document.querySelector(".stage").scrollIntoView({ behavior: "smooth", block: "nearest" });
    const lk = look();
    gtagEvent(stamped ? "vm_preview_pro" : "vm_export_ok", { template: state.template, aspect: state.aspect, voice: state.voiceMode, browser: browser(),
      seconds: Math.round(total), ms: Math.round(secs * 1000), codec: codecs.video, theme: state.theme, font: lk.font, motion: lk.motion, texture: lk.texture });
    window.__vmLast = { ms: Math.round(secs * 1000), size: blob.size, seconds: total, codecs, stamped, voice: state.voiceMode, template: state.template, look: { ...lk, theme: lk.theme.id } };
  } catch (e) {
    $("progressBox").hidden = true;
    $("makeError").hidden = false; $("makeError").textContent = `Sorry: ${e.message}`;
    gtagEvent("vm_export_fail", { browser: browser(), template: state.template, voice: state.voiceMode, message: String(e.message).slice(0, 90) });
    window.__vmLast = { error: String(e.message) };
  } finally {
    btn.disabled = false;
  }
}
function showResult(stamped) {
  $("proBox").hidden = !stamped;
  $("freeActions").hidden = stamped;
  if (stamped) {
    const id = state.theme, single = id !== "logo" && checkoutLink(id), pack = checkoutLink("pack");
    $("proName").textContent = themeName(id);
    $("pwSingle").hidden = !single; $("pwPack").hidden = !pack; $("pwSoon").hidden = PACK.enabled;
    if (single) { $("pwSingle").href = single; $("pwSingle").textContent = `Unlock this theme and download: US$${PACK.prices.single}`; }
    if (pack) { $("pwPack").href = pack; $("pwPack").textContent = `All 8 + Match my logo: US$${PACK.prices.pack}`; }
    gtagEvent("vm_paywall_view", { theme: id, enabled: PACK.enabled });
  }
  $("buyerNote").hidden = stamped || !claimedIds().size; // a thank-you for theme buyers, with the Fix offer
  if (state.fromUrl && state.fromUrl.kind === "product") { // opt-in upsell: the free check, for the same store
    $("urlCheck").hidden = false;
    $("urlCheckLink").href = `/woocommerce/merchant-center-check/?site=${encodeURIComponent(state.fromUrl.host)}&utm_source=video-maker&utm_medium=tool&utm_campaign=vm-from-url`;
  }
  $("tipsForm").hidden = !API;
}

// ------------------------------------------------------------------------------------------- the project, kept safe
// Before a checkout the whole project is saved on this browser, so the clean video can be re-made when Stripe returns.
const PROJECT = "vm-project";
function toDataUrl(img, max = 1280) {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}
async function saveProject() {
  const p = { template: state.template, user: state.user, auto: state.auto, theme: state.theme, custom: state.custom, font: state.font,
    motion: state.motion, texture: state.texture, aspect: state.aspect, bed: state.bed, voiceMode: state.voiceMode, voice: state.voice,
    speed: state.speed, endcard: state.endcard, captions: state.captions, fromUrl: state.fromUrl, saved: Date.now(),
    photos: state.photos.map((i) => toDataUrl(i)), logo: state.logo ? toDataUrl(state.logo, 400) : null, recording: null };
  if (state.recordingBlob && state.recordingBlob.size < 2.5e6) {
    p.recording = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(state.recordingBlob); });
  }
  if (!store.set(PROJECT, p)) { p.photos = []; p.logo = null; p.recording = null; store.set(PROJECT, p); } // too big: keep the words and look
}
async function loadProject() {
  const p = store.get(PROJECT);
  if (!p || Date.now() - (p.saved || 0) > 2 * 864e5) return false;
  const img = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  Object.assign(state, { template: p.template || "promo", user: p.user || {}, auto: p.auto || {}, theme: p.theme, custom: p.custom || state.custom, font: p.font || "",
    motion: p.motion || "smooth", texture: p.texture || "", aspect: p.aspect || "9x16", bed: p.bed || "bright", voice: p.voice || "af_heart",
    speed: p.speed || 1, endcard: p.endcard !== false, captions: p.captions !== false, fromUrl: p.fromUrl || null });
  state.photos = (await Promise.all((p.photos || []).map(img))).filter(Boolean);
  state.logo = p.logo ? await img(p.logo) : null;
  if (p.recording) {
    try { state.recordingBlob = await (await fetch(p.recording)).blob(); state.recording = await new AudioContext().decodeAudioData(await state.recordingBlob.arrayBuffer()); }
    catch (e) { state.recording = null; }
  }
  setSound(p.voiceMode === "record" && !state.recording ? "none" : p.voiceMode || "none");
  $("music").value = state.bed; $("voice").value = state.voice; $("speed").value = state.speed;
  $("endcard").checked = state.endcard; $("captions").checked = state.captions;
  $("font").value = state.font; $("motion").value = state.motion; $("texture").value = state.texture;
  setAspect(state.aspect);
  if (state.logo) readLogoColors();
  pickType(state.template, false);
  restart();
  return true;
}

// ------------------------------------------------------------------------------------------------------ the look
// Fonts are self-hosted next to the page; the canvas waits for them before an export.
const fontsReady = Promise.all(FONT_FILES.map(([family, file, weight]) => {
  try {
    const f = new FontFace(family, `url(./fonts/${file})`, { weight: String(weight) });
    document.fonts.add(f);
    return f.load().catch(() => null);
  } catch (e) { return null; }
})).then(() => { drawSwatches(); drawTypeCards(); });

let live = null; // the swatch that loops: the one under the pointer, else the chosen one
const swatches = new Map();
const SAVE = "vm-look";
function lookUrl() {
  const q = new URLSearchParams();
  if (state.theme !== "logo") q.set("theme", state.theme);
  if (state.theme === "custom") ["bg", "ink", "accent"].forEach((k) => q.set(k, state.custom[k].slice(1)));
  if (state.font) q.set("font", state.font);
  if (state.motion !== "smooth") q.set("motion", state.motion);
  if (state.texture) q.set("texture", state.texture);
  return `${location.origin}${location.pathname}?${q}`;
}
function save() {
  store.set(SAVE, { theme: state.theme === "logo" ? DEFAULT_THEME : state.theme, custom: state.custom, font: state.font, motion: state.motion, texture: state.texture });
}
function load() {
  const saved = store.get(SAVE) || {};
  const q = new URLSearchParams(location.search);
  const preset = new URLSearchParams(document.querySelector('meta[name="vm-preset"]')?.content || "");
  const pick = (k, ok) => { const v = q.get(k) ?? preset.get(k) ?? saved[k]; return v != null && ok(v) ? v : null; };
  const color = (v) => (/^#?[0-9a-f]{6}$/i.test(v || "") ? "#" + v.replace("#", "") : null);
  const wanted = q.get("theme") ?? preset.get("theme") ?? saved.theme;
  state.theme = pick("theme", (v) => THEME_IDS.includes(v) || v === "custom") || DEFAULT_THEME;
  if (wanted && wanted !== state.theme) state.pendingTheme = wanted; // a Designer theme: picked once the pack loads
  if (saved.custom) Object.keys(state.custom).forEach((k) => { state.custom[k] = color(saved.custom[k]) || state.custom[k]; });
  ["bg", "ink", "accent"].forEach((k) => { if (color(q.get(k))) state.custom[k] = color(q.get(k)); });
  state.font = pick("font", (v) => v === "" || v in FONTS) || "";
  state.motion = pick("motion", (v) => v in MOTIONS) || "smooth";
  state.texture = pick("texture", (v) => v === "" || v in TEXTURES) || "";
  const tpl = q.get("template") ?? preset.get("template");
  if (tpl && TEMPLATES[tpl]) state.template = tpl;
}
const themeFor = (id) => id === "custom" ? customTheme(state.custom.bg, state.custom.ink, state.custom.accent).theme
  : id === "logo" ? state.logoLook : THEMES.find((x) => x.id === id) || PACK.themes.find((x) => x.id === id);
function swatchCard(id, name) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "swatch"; b.dataset.theme = id; b.setAttribute("aria-pressed", "false");
  const c = document.createElement("canvas"); c.width = 180; c.height = 230; c.setAttribute("aria-hidden", "true");
  const label = document.createElement("span"); label.textContent = name;
  const badge = document.createElement("em"); badge.className = "badge";
  b.append(c, label, badge);
  b.addEventListener("click", () => pickTheme(id));
  b.addEventListener("pointerenter", () => { const th = themeFor(id); if (th) live = { ctx: c.getContext("2d"), theme: th }; });
  b.addEventListener("pointerleave", () => { drawSwatches(); setLive(); });
  swatches.set(id, { b, c });
  return b;
}
function drawSwatches() {
  swatches.forEach(({ c }, id) => {
    const th = themeFor(id), x = c.getContext("2d");
    if (th) { drawSwatch(x, th, 1.2, state.font, state.motion); return; }
    x.fillStyle = "#1b1e2c"; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#d6daec"; x.font = "600 15px system-ui, sans-serif"; x.textAlign = "center";
    x.fillText("Upload your logo", c.width / 2, c.height / 2 - 8); x.fillText("to use its colours", c.width / 2, c.height / 2 + 14);
    x.textAlign = "left";
  });
}
function setLive() { const s = swatches.get(state.theme), th = themeFor(state.theme); live = s && th ? { ctx: s.c.getContext("2d"), theme: th } : null; }
function pickTheme(id) {
  if (id === "logo" && !state.logoLook) { state.wantLogoLook = true; $("logo").click(); return; }
  state.theme = id;
  swatches.forEach(({ b }, k) => b.setAttribute("aria-pressed", String(k === id)));
  const locked = isLocked(id);
  $("lockNote").hidden = !locked;
  if (locked) {
    $("lockNote").textContent = PACK.enabled
      ? `${themeName(id)} is a Designer theme. Make your video with it: the preview is stamped, and you can unlock it after you've seen it (US$${PACK.prices.single}, or all 8 for US$${PACK.prices.pack}).`
      : `${themeName(id)} is a Designer theme, coming soon. You can preview it; the free themes and Custom colours download free.`;
    gtagEvent("vm_premium_preview", { theme: id });
  }
  $("customBox").hidden = id !== "custom";
  const th = theme();
  $("fontDefault").textContent = `Theme's own (${FONTS[th.font].name})`;
  $("textureDefault").textContent = `Theme's own (${TEXTURES[th.texture]})`;
  customNote();
  drawSwatches(); setLive(); save(); drawTypeCards();
}
function customNote() {
  if (state.theme !== "custom") { $("customNote").textContent = ""; return; }
  const { adjusted } = customTheme(state.custom.bg, state.custom.ink, state.custom.accent);
  $("customNote").textContent = adjusted ? "We nudged the text or accent colour so every caption stays readable (WCAG AA)." : "Every caption passes WCAG AA contrast.";
}
function readLogoColors() {
  state.logoLook = null; state.logoColors = null;
  if (state.logo) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d"); x.drawImage(state.logo, 0, 0, 64, 64);
    try { state.logoColors = logoColors(x.getImageData(0, 0, 64, 64).data); } catch (e) { state.logoColors = null; } // a cross-origin logo
    const t = logoTheme(state.logoColors);
    state.logoLook = t ? { ...t, id: "logo", name: "Match my logo" } : null;
  }
  $("logoDots").innerHTML = (state.logoColors || []).slice(0, 3).map((x) => `<i style="background:${x.color}" title="${x.color}"></i>`).join("");
  if (state.theme === "logo" && !state.logoLook) pickTheme(DEFAULT_THEME);
  drawSwatches(); setLive();
}
function setAspect(a) {
  state.aspect = a;
  document.querySelectorAll("[data-aspect]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.aspect === a)));
  restart();
}
function initLook() {
  load();
  const row = $("themes");
  THEMES.forEach((t) => row.appendChild(swatchCard(t.id, t.name)));
  row.appendChild(swatchCard("custom", "Custom"));
  row.appendChild(swatchCard("logo", "Match my logo"));
  badges();
  Object.entries(FONTS).forEach(([k, f]) => $("font").add(new Option(f.name, k)));
  Object.entries(MOTIONS).forEach(([k, m]) => $("motion").add(new Option(m.name, k)));
  Object.entries(TEXTURES).forEach(([k, n]) => $("texture").add(new Option(n, k)));
  $("font").value = state.font; $("motion").value = state.motion; $("texture").value = state.texture;
  ["bg", "ink", "accent"].forEach((k) => {
    $(`c_${k}`).value = state.custom[k];
    $(`c_${k}`).addEventListener("input", (e) => { state.custom[k] = e.target.value; customNote(); drawSwatches(); setLive(); save(); });
  });
  $("font").addEventListener("change", (e) => { state.font = e.target.value; drawSwatches(); setLive(); save(); });
  $("motion").addEventListener("change", (e) => { state.motion = e.target.value; save(); });
  $("texture").addEventListener("change", (e) => { state.texture = e.target.value; save(); });
  document.querySelectorAll("[data-aspect]").forEach((b) => b.addEventListener("click", () => setAspect(b.dataset.aspect)));
  pickTheme(state.theme);
}

// ------------------------------------------------------------------------------------------- the Designer themes
// Optional paid themes (a separate content pack, not part of this program). Anyone can make a full preview with one;
// it's stamped until the theme is unlocked, then the clean video is re-made.
const API = apiBase();
let PACK = { enabled: false, themes: [], links: {}, prices: { single: 3, pack: 5, currency: "USD" } };
const isPremium = (id) => !!API && PACK.loaded && (id === "logo" || PACK.themes.some((x) => x.id === id));
const isLocked = (id) => isPremium(id) && !claimedIds().has(id);
const themeName = (id) => (id === "logo" ? "Match my logo" : (themeFor(id) || {}).name || id);

function badges() {
  const owned = claimedIds();
  swatches.forEach(({ b }, id) => {
    const el = b.querySelector(".badge");
    if (!isPremium(id)) { el.textContent = PACK.loaded ? "FREE" : ""; el.className = "badge free"; return; }
    el.className = "badge pro";
    el.textContent = owned.has(id) ? "Unlocked" : id === "logo" ? `PRO · in the $${PACK.prices.pack} pack` : PACK.enabled ? `PRO · $${PACK.prices.single}` : "PRO · soon";
    if (!owned.has(id)) el.prepend(Object.assign(document.createElement("span"), { className: "lock", textContent: "🔒 " }));
  });
}
function checkoutLink(item) { return PACK.enabled && PACK.links[item] ? PACK.links[item] : null; }

async function initPack() {
  ["pwSingle", "pwPack", "packBanner"].forEach((k) => $(k).addEventListener("click", async (e) => {
    const item = k === "pwSingle" ? state.theme : "pack";
    const href = checkoutLink(item);
    e.preventDefault();
    if (!href) return;
    await saveProject(); // so the clean video can be re-made when Stripe sends the buyer back
    gtagEvent("vm_checkout_click", { item, after_preview: k !== "packBanner" });
    location.href = href;
  }));
  $("pwRestore").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await restore(API, $("pwEmail").value.trim()); $("pwRestoreMsg").textContent = "If that email bought Designer themes, a restore link is on its way. Check your inbox (and spam)."; }
    catch (err) { $("pwRestoreMsg").textContent = `Sorry, that didn't work: ${err.message}`; }
  });
  $("useFree").addEventListener("click", () => { pickTheme(DEFAULT_THEME); doMake(); });
  const pack = await loadPack(API);
  if (!pack) return; // no server (e.g. a copy of the open-source tool): free themes only
  PACK = { ...PACK, ...pack, loaded: true };
  const row = $("themes"), logoCard = swatches.get("logo").b;
  PACK.themes.forEach((t) => row.insertBefore(swatchCard(t.id, t.name), logoCard));
  $("packRow").hidden = false;
  if (checkoutLink("pack")) $("packBanner").href = checkoutLink("pack");
  $("packBannerText").textContent = PACK.enabled ? `Designer themes: US$${PACK.prices.single} each, or all 8 plus Match my logo for US$${PACK.prices.pack}. One-time; it keeps this tool free.`
    : "Designer themes: 8 more looks plus Match my logo, coming soon. Preview them now; the free themes and Custom colours download free.";
  $("packBanner").textContent = PACK.enabled ? `Get all 8 for US$${PACK.prices.pack}` : "Coming soon";
  drawSwatches(); badges();
  const q = new URLSearchParams(location.search);
  let remake = false;
  if (q.get("restore")) { saveToken(q.get("restore")); thank("restored"); }
  if (q.get("unlock")) {
    try {
      const ids = await redeem(API, q.get("unlock"));
      gtagEvent("vm_unlock_ok", { count: ids.length });
      thank("bought", ids);
      if (await loadProject()) { gtagEvent("vm_unlock_after_preview", { theme: state.theme }); remake = true; }
    } catch (e) { $("unlockMsg").hidden = false; $("unlockMsg").textContent = `We couldn't confirm that payment yet (${e.message}). Refresh in a minute, or use "Already bought?" under the preview.`; }
  }
  if (q.get("restore") || q.get("unlock")) { q.delete("restore"); q.delete("unlock"); try { history.replaceState(null, "", `${location.pathname}?${q}`); } catch (e) { /* sandboxed */ } }
  if (!remake && state.pendingTheme && themeFor(state.pendingTheme)) pickTheme(state.pendingTheme); else pickTheme(state.theme);
  badges();
  if (remake) { store.del(PROJECT); go(6); doMake(); } // the clean video, straight away
}
function thank(kind, ids = []) {
  const n = ids.filter((i) => i !== "logo").length;
  $("unlockMsg").hidden = false;
  $("unlockMsg").textContent = kind === "restored" ? "Your Designer themes are restored on this browser."
    : `Thank you! ${n === 8 ? "All 8 Designer themes and Match my logo are" : n === 1 ? `${themeName(ids[0])} is` : `${n} themes are`} unlocked on this browser. We're re-making your video without the stamp now. Your Stripe receipt is your proof of purchase.`;
  badges();
}

// ---------------------------------------------------------------------------------------------------- wiring
async function readImage(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  return img;
}
function init() {
  VOICES.forEach((v) => $("voice").add(new Option(v.name, v.id)));
  Object.entries(BEDS).forEach(([k, b]) => $("music").add(new Option(b.name, k)));
  $("music").value = state.bed;
  initPack();
  const q = new URLSearchParams(location.search);
  if (q.get("beta") === "myvoice") { // D-voiceclone-1: a hidden test page, not linked anywhere else
    const p = document.createElement("p"); p.className = "note small";
    p.innerHTML = 'Hidden beta: <a href="./beta/myvoice/">clone your own voice on this device</a>. Test only; your own voice only.';
    document.querySelector('.step[data-step="1"]').prepend(p);
  }
  // steps
  document.querySelectorAll(".stepper button").forEach((b) => b.addEventListener("click", () => go(Number(b.dataset.go))));
  document.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => go(state.step + (b.dataset.nav === "next" ? 1 : -1) * (b.dataset.nav === "back" && state.step === 3 && linkSkipped() ? 2 : 1))));
  // 2. the link
  $("fromUrlForm").addEventListener("submit", (e) => { e.preventDefault(); grab(); });
  const typeIt = () => { $("linkError").hidden = true; go(3); };
  $("typeMyself").addEventListener("click", typeIt);
  $("typeInstead").addEventListener("click", typeIt);
  if (!API) { $("fromUrlForm").hidden = true; $("fromUrlStatus").hidden = true; $("noServer").hidden = false; }
  // 3. the words
  $("changeType").addEventListener("click", () => go(1));
  $("photos").addEventListener("change", async (e) => {
    const n = TEMPLATES[state.template].photos;
    state.photos = await Promise.all([...e.target.files].slice(0, n).map(readImage)); renderFields(); restart();
  });
  // 4. the look (and what changes the video's length)
  $("endcard").addEventListener("change", (e) => { state.endcard = e.target.checked; restart(); });
  $("captions").addEventListener("change", (e) => { state.captions = e.target.checked; });
  $("logo").addEventListener("change", async (e) => {
    state.logo = e.target.files[0] ? await readImage(e.target.files[0]) : null;
    readLogoColors();
    if (state.wantLogoLook && state.logoLook) pickTheme("logo");
  });
  // 5. the sound
  document.querySelectorAll("[data-sound]").forEach((b) => b.addEventListener("click", () => setSound(b.dataset.sound)));
  $("music").addEventListener("change", (e) => { state.bed = e.target.value; restart(); });
  $("musicPreview").addEventListener("click", async () => { if (state.bed !== "none") playBuffer(await renderBed(state.bed, 3.2), 3); });
  $("voice").addEventListener("change", (e) => { state.voice = e.target.value; });
  $("speed").addEventListener("input", (e) => { state.speed = Number(e.target.value); $("speedVal").textContent = `${state.speed.toFixed(2)}×`; });
  $("voiceSample").addEventListener("click", async () => {
    const btn = $("voiceSample"); btn.disabled = true;
    try {
      await loadVoice((label) => { $("voiceStatus").textContent = label; });
      $("voiceStatus").textContent = "Making a sample line…";
      const first = rawScenes().find((s) => s.line);
      const m = await speak(first ? (first.say || first.line) : "Here's how your video will sound.");
      const ac = new AudioContext(), buf = ac.createBuffer(1, m.audio.length, m.rate);
      buf.copyToChannel(m.audio, 0); ac.close();
      playBuffer(buf);
      $("voiceStatus").textContent = "That's the AI voice. The whole voiceover is made when you press Make my video.";
    } catch (e) { $("voiceStatus").textContent = `The AI voice couldn't load on this device (${e.message}). Choose Music only or My own voice.`; }
    finally { btn.disabled = false; }
  });
  $("recBtn").addEventListener("click", record);
  // 6. make
  $("exportBtn").addEventListener("click", doMake);
  $("playBtn").addEventListener("click", () => { state.playing = !state.playing; $("playBtn").textContent = state.playing ? "❚❚ Pause" : "▶ Play"; restart(); });
  $("shareLook").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(lookUrl()); $("shareLook").textContent = "Link copied"; }
    catch (e) { $("shareLook").textContent = "Copy failed"; }
    setTimeout(() => { $("shareLook").textContent = "Share this look"; }, 2500);
  });
  $("makeAnother").addEventListener("click", () => { $("result").hidden = true; state.user = {}; state.auto = {}; state.photos = []; state.fromUrl = null; restart(); go(1); });
  $("editAgain").addEventListener("click", () => { $("result").hidden = true; go(3); });
  $("ctaCheck").addEventListener("click", () => gtagEvent("vm_cta_click", { cta: "free_check" }));
  $("ctaFix").addEventListener("click", () => gtagEvent("vm_cta_click", { cta: "gmc_fix" }));
  $("tipsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!$("tipsConsent").checked) { $("tipsMsg").textContent = "Tick the box first, so we know you want the tips."; return; }
    try {
      const r = await fetch(API + "/v1/vm/subscribe", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: $("tipsEmail").value.trim(), consent: true, source: document.querySelector('meta[name="vm-preset"]')?.content ? location.pathname.split("/").filter(Boolean).pop() : "video-maker" }) });
      const j = await r.json().catch(() => ({}));
      $("tipsMsg").textContent = r.ok ? "Check your inbox to confirm (one email)." : `Sorry: ${j.error || "that didn't work"}`;
      if (r.ok) gtagEvent("vm_tips_signup", {});
    } catch (err) { $("tipsMsg").textContent = "Sorry, that didn't work. Please try again later."; }
  });
  if (q.get("subscribed") === "1" || q.get("unsubscribed") === "1") {
    $("unlockMsg").hidden = false;
    $("unlockMsg").textContent = q.get("subscribed") === "1" ? "You're in: 1 short tip a month. Unsubscribe any time from any email." : "You're unsubscribed. No more tips from us.";
  }
  initLook();
  renderTypes();
  restart();
  requestAnimationFrame(frame);
  gtagEvent("vm_open", { browser: browser() });
  const preset = new URLSearchParams(document.querySelector('meta[name="vm-preset"]')?.content || "");
  const from = q.get("from");
  if (from && API) { pickType(q.get("template") && TEMPLATES[q.get("template")] ? q.get("template") : "promo", false); go(2); document.querySelector(".linkInput").value = from; setTimeout(grab, 0); }
  else if (q.get("template") || preset.get("template")) go(LINK[state.template] ? 2 : 3); // a landing page or a shared link: the type is chosen
  else go(1);
  support(...SIZES[state.aspect]).then((s) => {
    if (!s.ok) { $("unsupported").hidden = false; $("unsupported").textContent = `${s.why} Try Chrome or Edge on a computer or Android phone; you can still preview here.`; $("exportBtn").disabled = true; }
  });
}
window.__vmStill = (t, extra = {}) => { const tl = timeline(scenes()); drawFrame(ctx, tl, t < 0 ? totalDuration(tl) + t : t, opts(extra)); return canvas.toDataURL("image/png"); }; // a test hook: t < 0 counts from the end
window.__vmGo = go; // a test hook: jump to a step
window.__vmType = (t) => pickType(t, false); // a test hook: choose a type without moving
init();
