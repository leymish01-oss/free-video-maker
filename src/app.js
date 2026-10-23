// Free Video Maker: the page. Five steps (link, words, look, sound, make) beside a live preview. Everything runs here,
// on the visitor's device: photos are read locally, the voice runs in a worker, the MP4 is encoded with WebCodecs.
// Nothing is uploaded.
// SPDX-License-Identifier: GPL-3.0-or-later
import { SIZES, drawFrame, drawSwatch, timeline, totalDuration } from "./engine.js";
import { THEMES, THEME_IDS, DEFAULT_THEME, FONTS, MOTIONS, TEXTURES, FONT_FILES, customTheme, logoColors, logoTheme } from "./themes.js";
import { TEMPLATES, buildScenes } from "./templates.js";
import { BEDS, renderBed } from "./music.js";
import { exportMp4, mixAudio, support } from "./export.js";
import { apiBase, loadPack, canExport, redeem, restore, saveToken, claimedIds } from "./premium.js";
import { readPage, proxied, fieldsFor } from "./fromurl.js";

const VOICES = [
  { id: "af_heart", name: "Heart (US, female)" }, { id: "af_bella", name: "Bella (US, female)" },
  { id: "am_michael", name: "Michael (US, male)" }, { id: "am_fenrir", name: "Fenrir (US, male)" },
  { id: "bf_emma", name: "Emma (UK, female)" }, { id: "bm_george", name: "George (UK, male)" },
];
const LEAD = 0.12, TAIL = 0.45; // voice starts just after a scene starts; a little air after it ends

const $ = (id) => document.getElementById(id);
const gtagEvent = (name, params = {}) => { try { window.gtag && window.gtag("event", name, params); } catch (e) { /* no analytics */ } };
const browser = () => { const u = navigator.userAgent; return /Edg\//.test(u) ? "edge" : /Firefox\//.test(u) ? "firefox"
  : /Chrome\//.test(u) ? (/Android/.test(u) ? "chrome-android" : "chrome") : /Safari\//.test(u) ? "safari" : "other"; };
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } } };

const state = {
  step: 1, template: "promo", values: {}, photos: [], logo: null, aspect: "9x16",
  theme: DEFAULT_THEME, custom: { bg: "#16181d", ink: "#f7f6f2", accent: "#4cc38a" }, logoLook: null, logoColors: null,
  font: "", motion: "smooth", texture: "", // "" = the theme's own font / texture
  voiceMode: "none", voice: "af_heart", speed: 1, clips: {}, clipsKey: "", recording: null, recordingBlob: null,
  bed: "bright", endcard: true, captions: true, playing: false, t0: 0, fromUrl: null,
};
let worker = null, voiceReady = null, pending = new Map(), seq = 0;

// ------------------------------------------------------------------------------------------------------- the steps
function go(n) {
  n = Math.max(1, Math.min(5, n));
  state.step = n;
  document.querySelector(".studio").dataset.step = n;
  document.querySelectorAll(".step").forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
  document.querySelectorAll(".stepper button").forEach((b) => {
    const k = Number(b.dataset.go);
    b.toggleAttribute("aria-current", false);
    if (k === n) b.setAttribute("aria-current", "step");
    b.classList.toggle("done", k < n);
  });
  if (n === 5) summary();
  gtagEvent("vm_step", { step: n });
  const sec = document.querySelector(`.step[data-step="${n}"]`);
  if (sec && sec.getBoundingClientRect().top < 0) sec.scrollIntoView({ behavior: "smooth", block: "start" });
}
function summary() {
  const t = TEMPLATES[state.template], th = theme();
  const sound = { none: `${BEDS[state.bed].name} music`, ai: `AI voice (${VOICES.find((v) => v.id === state.voice).name}) + ${BEDS[state.bed].name.toLowerCase()}`,
    record: `your own voice + ${BEDS[state.bed].name.toLowerCase()}` }[state.voiceMode];
  const locked = isLocked(state.theme);
  $("summary").textContent = `${t.name} · ${th.name || "Custom"}${locked ? " (Designer theme: the preview is stamped until you unlock it)" : ""} · ${state.aspect.replace("x", ":")} · ${sound}. About ${estimate()} s to make.`;
}

// ------------------------------------------------------------------------------------------------------- the words
function renderFields() {
  const t = TEMPLATES[state.template];
  $("template").value = state.template;
  $("blurb").textContent = t.blurb;
  $("fields").innerHTML = "";
  t.fields.forEach((f) => {
    const lab = document.createElement("label");
    lab.textContent = f.label;
    const inp = document.createElement("input");
    inp.type = "text"; inp.maxLength = 90; inp.value = state.values[f.id] ?? f.value; inp.dataset.id = f.id;
    inp.addEventListener("input", () => { state.values[f.id] = inp.value; restart(); });
    lab.appendChild(inp);
    $("fields").appendChild(lab);
  });
  $("photosRow").hidden = !t.photos;
  $("photoHint").textContent = t.photos ? `Up to ${t.photos} photo${t.photos > 1 ? "s" : ""}, picked from your device (never uploaded).${state.photos.length ? ` ${state.photos.length} added.` : ""}` : "";
}

function rawScenes() { return buildScenes(state.template, state.values, { endcard: state.endcard, photos: state.photos.length }); }
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

// ---------------------------------------------------------------------------------------------------- the preview
const canvas = $("preview"), ctx = canvas.getContext("2d");
let previewAudio = null;
function restart() {
  const o = opts();
  canvas.width = o.width; canvas.height = o.height;
  canvas.classList.toggle("landscape", state.aspect === "16x9");
  state.t0 = performance.now();
  stopAudio();
  if (state.playing) playAudio();
}
function frame() {
  const tl = timeline(scenes());
  const total = totalDuration(tl);
  let t = state.playing ? (performance.now() - state.t0) / 1000 : 0.8;
  if (t > total) { state.t0 = performance.now(); t = 0; stopAudio(); if (state.playing) playAudio(); }
  drawFrame(ctx, tl, t, opts());
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
let lastBlobUrl = null;
async function doMake() {
  const btn = $("exportBtn");
  btn.disabled = true;
  $("result").hidden = true;
  const t0 = performance.now();
  const stamped = isLocked(state.theme) && !(await canExport(API, state.theme).catch(() => false));
  try {
    stopAudio(); state.playing = false; $("playBtn").textContent = "▶ Play";
    await fontsReady;
    if (state.voiceMode === "ai") { // the voice is always made before the video when it's chosen; never a silent fallback
      try { await ensureVoice((label, p) => progress(`Step 1 of 3 · ${label}`, (p || 0) * 0.35)); }
      catch (e) { throw new Error(`The AI voice couldn't be made on this device (${e.message}). Choose "Music only" or "My own voice" in step 4, or try Chrome on a computer.`); }
    }
    if (state.voiceMode === "record" && !state.recording) throw new Error('Record your voice first (step 4), or choose "Music only".');
    const tl = timeline(scenes());
    const total = totalDuration(tl);
    progress(`Step 2 of 3 · Mixing the sound…`, state.voiceMode === "ai" ? 0.36 : 0.05);
    const bed = state.bed !== "none" ? await renderBed(state.bed, total) : null;
    const audio = (bed || state.voiceMode !== "none") ? await mixAudio(tl, { clips: state.voiceMode === "ai" ? state.clips : {},
      recording: state.voiceMode === "record" ? state.recording : null, bed, lead: LEAD }) : null;
    const base = state.voiceMode === "ai" ? 0.38 : 0.08;
    const { blob, codecs } = await exportMp4(tl, opts({ stamp: stamped }), audio, (p) => progress(`Step 3 of 3 · Drawing and encoding: ${Math.round(p * 100)}% (about ${Math.max(1, Math.round((1 - p) * total * 1.4))} s left)`, base + p * (1 - base)));
    const secs = (performance.now() - t0) / 1000;
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    const url = lastBlobUrl = URL.createObjectURL(blob);
    progress(`Done in ${secs.toFixed(1)} s: ${(blob.size / 1e6).toFixed(1)} MB, ${total.toFixed(1)} s, ${codecs.video.toUpperCase()}${codecs.audio ? " + " + codecs.audio.toUpperCase() : ""}.`, 1);
    $("result").hidden = false;
    $("resultVideo").src = url;
    const a = $("download");
    a.href = url; a.download = `video-${state.aspect}-${Date.now()}.mp4`;
    showResult(stamped);
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
    const lk = look();
    gtagEvent(stamped ? "vm_preview_pro" : "vm_export_ok", { template: state.template, aspect: state.aspect, voice: state.voiceMode, browser: browser(),
      seconds: Math.round(total), ms: Math.round(secs * 1000), codec: codecs.video, theme: state.theme, font: lk.font, motion: lk.motion, texture: lk.texture });
    window.__vmLast = { ms: Math.round(secs * 1000), size: blob.size, seconds: total, codecs, stamped, voice: state.voiceMode, look: { ...lk, theme: lk.theme.id } };
  } catch (e) {
    progress(`Sorry: ${e.message}`, 0);
    $("exportStatus").classList.add("err");
    gtagEvent("vm_export_fail", { browser: browser(), template: state.template, voice: state.voiceMode, message: String(e.message).slice(0, 90) });
    window.__vmLast = { error: String(e.message) };
  } finally {
    btn.disabled = false;
    setTimeout(() => $("exportStatus").classList.remove("err"), 15000);
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
  const p = { template: state.template, values: state.values, theme: state.theme, custom: state.custom, font: state.font,
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
  Object.assign(state, { template: p.template, values: p.values || {}, theme: p.theme, custom: p.custom || state.custom, font: p.font || "",
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
  renderFields(); restart();
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
})).then(() => drawSwatches());

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
  drawSwatches(); setLive(); save();
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
  if (remake) { store.del(PROJECT); go(5); doMake(); } // the clean video, straight away
}
function thank(kind, ids = []) {
  const n = ids.filter((i) => i !== "logo").length;
  $("unlockMsg").hidden = false;
  $("unlockMsg").textContent = kind === "restored" ? "Your Designer themes are restored on this browser."
    : `Thank you! ${n === 8 ? "All 8 Designer themes and Match my logo are" : n === 1 ? `${themeName(ids[0])} is` : `${n} themes are`} unlocked on this browser. We're re-making your video without the stamp now. Your Stripe receipt is your proof of purchase.`;
  badges();
}

// ------------------------------------------------------------------------------------------- video from a link
function abButton() { // A/B: "✨ Grab my details" vs "Auto-fill from my link", fixed per browser
  let v = store.get("vm-ab-grab");
  if (v !== "grab" && v !== "autofill") { v = Math.random() < 0.5 ? "grab" : "autofill"; store.set("vm-ab-grab", v); }
  $("fromUrlBtn").textContent = v === "grab" ? "✨ Grab my details" : "Auto-fill from my link";
  return v;
}
let abVariant = "grab";
async function fromUrl(url) {
  url = String(url || "").trim();
  if (!url) { $("fromUrlStatus").textContent = "Paste a link first, or choose \"No link? Type it myself\"."; return; }
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  $("fromUrlBtn").disabled = true;
  $("fromUrlStatus").textContent = "Reading your page…";
  try {
    const page = await readPage(API, url);
    const { template, values } = fieldsFor(page);
    state.template = template; state.values = values;
    const want = TEMPLATES[template].photos;
    $("fromUrlStatus").textContent = `Found "${page.title || page.siteName || "your page"}"${page.price ? `, price ${page.price}` : ""}. Loading photos…`;
    state.photos = (await Promise.all((page.images || []).slice(0, Math.max(want, 1)).map((u) => proxied(API, u)))).filter(Boolean).slice(0, want);
    if (page.logo) { const logo = await proxied(API, page.logo); if (logo) { state.logo = logo; readLogoColors(); } }
    const host = new URL(page.url || url).hostname.replace(/^www\./, "");
    state.fromUrl = { kind: page.kind, host };
    renderFields(); restart();
    $("fromUrlStatus").textContent = `Found ${state.photos.length} photo${state.photos.length === 1 ? "" : "s"}${page.price ? `, price ${page.price}` : ""} on ${host}. Check the words next.`;
    gtagEvent("vm_extract", { result: "ok", source: page.source || "", kind: page.kind, button: abVariant });
    gtagEvent("vm_from_url", { result: "ok", source: page.source || "", kind: page.kind });
    window.__vmFromUrlDone = { ok: true, kind: page.kind, source: page.source, photos: state.photos.length };
    go(2);
  } catch (e) {
    $("fromUrlStatus").textContent = `We couldn't read that page (${e.message}). You can type your details instead.`;
    gtagEvent("vm_extract", { result: "fail", button: abVariant, message: String(e.message).slice(0, 80) });
    gtagEvent("vm_from_url", { result: "fail", message: String(e.message).slice(0, 80) });
    window.__vmFromUrlDone = { ok: false, error: String(e.message) };
  } finally {
    $("fromUrlBtn").disabled = false;
  }
}

// ---------------------------------------------------------------------------------------------------- wiring
async function readImage(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  return img;
}
function init() {
  Object.entries(TEMPLATES).forEach(([k, t]) => $("template").add(new Option(t.name, k)));
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
  document.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => go(state.step + (b.dataset.nav === "next" ? 1 : -1))));
  // 1. the link
  abVariant = abButton();
  $("fromUrlForm").addEventListener("submit", (e) => { e.preventDefault(); fromUrl($("fromUrlInput").value); });
  $("typeMyself").addEventListener("click", () => { state.values = {}; state.photos = []; renderFields(); restart(); go(2); });
  if (!API) { $("fromUrlForm").hidden = true; $("fromUrlStatus").hidden = true; $("noServer").hidden = false; }
  // 2. the words
  $("template").addEventListener("change", (e) => { state.template = e.target.value; state.values = {}; state.photos = []; $("photos").value = ""; renderFields(); restart(); });
  $("photos").addEventListener("change", async (e) => {
    const n = TEMPLATES[state.template].photos;
    state.photos = await Promise.all([...e.target.files].slice(0, n).map(readImage)); renderFields(); restart();
  });
  // 3. the look (and what changes the video's length)
  $("endcard").addEventListener("change", (e) => { state.endcard = e.target.checked; restart(); });
  $("captions").addEventListener("change", (e) => { state.captions = e.target.checked; });
  $("logo").addEventListener("change", async (e) => {
    state.logo = e.target.files[0] ? await readImage(e.target.files[0]) : null;
    readLogoColors();
    if (state.wantLogoLook && state.logoLook) pickTheme("logo");
  });
  // 4. the sound
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
  // 5. make
  $("exportBtn").addEventListener("click", doMake);
  $("playBtn").addEventListener("click", () => { state.playing = !state.playing; $("playBtn").textContent = state.playing ? "❚❚ Pause" : "▶ Play"; restart(); });
  $("shareLook").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(lookUrl()); $("shareLook").textContent = "Link copied"; }
    catch (e) { $("shareLook").textContent = "Copy failed"; }
    setTimeout(() => { $("shareLook").textContent = "Share this look"; }, 2500);
  });
  $("makeAnother").addEventListener("click", () => { $("result").hidden = true; $("progressBox").hidden = true; go(1); });
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
  renderFields();
  initLook();
  restart();
  requestAnimationFrame(frame);
  gtagEvent("vm_open", { browser: browser() });
  go(1);
  const from = q.get("from");
  if (from && API) { $("fromUrlInput").value = from; setTimeout(() => fromUrl(from), 0); }
  support(...SIZES[state.aspect]).then((s) => {
    if (!s.ok) { $("unsupported").hidden = false; $("unsupported").textContent = `${s.why} Try Chrome or Edge on a computer or Android phone; you can still preview here.`; $("exportBtn").disabled = true; }
  });
}
window.__vmStill = (t, extra = {}) => { const tl = timeline(scenes()); drawFrame(ctx, tl, t < 0 ? totalDuration(tl) + t : t, opts(extra)); return canvas.toDataURL("image/png"); }; // a test hook: t < 0 counts from the end
window.__vmGo = go; // a test hook: jump to a step
init();
