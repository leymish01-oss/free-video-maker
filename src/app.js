// Free Video Maker: the page. Everything runs here, on the visitor's device: photos are read locally, the voice runs
// in a worker, the MP4 is encoded with WebCodecs. Nothing is uploaded.
// SPDX-License-Identifier: GPL-3.0-or-later
import { SIZES, drawFrame, drawSwatch, timeline, totalDuration } from "./engine.js";
import { THEMES, THEME_IDS, DEFAULT_THEME, FONTS, MOTIONS, TEXTURES, FONT_FILES, customTheme, logoColors, logoTheme } from "./themes.js";
import { TEMPLATES, buildScenes } from "./templates.js";
import { BEDS, renderBed } from "./music.js";
import { exportMp4, mixAudio, support } from "./export.js";

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

const state = {
  template: "promo", values: {}, photos: [], logo: null, aspect: "9x16",
  theme: DEFAULT_THEME, custom: { bg: "#16181d", ink: "#f7f6f2", accent: "#4cc38a" }, logoLook: null, logoColors: null,
  font: "", motion: "smooth", texture: "", // "" = the theme's own font / texture
  voiceMode: "none", voice: "af_heart", speed: 1, clips: {}, recording: null, bed: "bright", endcard: true,
  captions: true, playing: false, t0: 0,
};
let worker = null, voiceReady = false, pending = new Map(), seq = 0;

// ------------------------------------------------------------------------------------------------------- the form
function renderFields() {
  const t = TEMPLATES[state.template];
  $("blurb").textContent = t.blurb;
  $("fields").innerHTML = "";
  t.fields.forEach((f) => {
    const lab = document.createElement("label");
    lab.textContent = f.label;
    const inp = document.createElement("input");
    inp.type = "text"; inp.maxLength = 90; inp.value = state.values[f.id] ?? f.value; inp.dataset.id = f.id;
    inp.addEventListener("input", () => { state.values[f.id] = inp.value; state.clips = {}; markVoiceStale(); restart(); });
    lab.appendChild(inp);
    $("fields").appendChild(lab);
  });
  $("photosRow").hidden = !t.photos;
  $("photoHint").textContent = t.photos ? `Up to ${t.photos} photo${t.photos > 1 ? "s" : ""}, picked from your device (never uploaded).` : "";
}

function scenes() {
  const raw = buildScenes(state.template, state.values, { endcard: state.endcard, photos: state.photos.length });
  return raw.map((s, i) => { // the voice clip sets each scene's length
    const c = state.voiceMode === "ai" ? state.clips[i] : null;
    return c ? { ...s, dur: Math.max(s.dur * 0.6, c.audio.length / c.rate + LEAD + TAIL) } : s;
  });
}

function theme() {
  if (state.theme === "custom") return customTheme(state.custom.bg, state.custom.ink, state.custom.accent).theme;
  if (state.theme === "logo" && state.logoLook) return state.logoLook;
  return THEMES.find((x) => x.id === state.theme) || THEMES[0];
}
const look = () => { const th = theme(); return { theme: th, font: state.font || th.font, motion: state.motion, texture: state.texture || th.texture }; };
function opts() {
  const [width, height] = SIZES[state.aspect];
  return { width, height, ...look(), assets: { photos: state.photos, logo: state.logo }, captions: state.captions };
}

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
async function playAudio() { // what the export will sound like, mixed live
  const tl = timeline(scenes());
  const bed = state.bed !== "none" ? await renderBed(state.bed, totalDuration(tl)) : null;
  const mix = await mixAudio(tl, { clips: state.voiceMode === "ai" ? state.clips : {}, recording: state.voiceMode === "record" ? state.recording : null, bed, lead: LEAD });
  const ac = new AudioContext();
  const src = ac.createBufferSource(); src.buffer = mix; src.connect(ac.destination);
  src.start(0, Math.max(0, (performance.now() - state.t0) / 1000));
  previewAudio = { ac, src };
}
function stopAudio() { if (previewAudio) { try { previewAudio.src.stop(); previewAudio.ac.close(); } catch (e) { /* already stopped */ } previewAudio = null; } }

// ----------------------------------------------------------------------------------------------------- the voice
function markVoiceStale() { if (state.voiceMode === "ai" && voiceReady) $("voiceStatus").textContent = "Text changed: click Update voice."; }

function startWorker() {
  if (worker) return;
  worker = new Worker(new URL("./voice-worker.js", import.meta.url), { type: "module" });
  const files = new Map();
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "progress") {
      files.set(m.file, [m.loaded, m.total]);
      const [l, t] = [...files.values()].reduce((a, [x, y]) => [a[0] + x, a[1] + (y || 0)], [0, 0]);
      $("voiceStatus").textContent = `Downloading the voice model: ${(l / 1e6).toFixed(0)} of ${(t / 1e6).toFixed(0)} MB (first time only)…`;
    } else if (m.type === "ready") {
      voiceReady = true;
      $("voiceStatus").textContent = `Voice ready (${m.device === "webgpu" ? "graphics card" : "processor"}). Making the lines…`;
      gtagEvent("vm_voice_load", { device: m.device, browser: browser(), ms: Math.round(performance.now() - loadStart) });
      speakAll();
    } else if (m.type === "audio" || m.type === "error") {
      const p = pending.get(m.id); pending.delete(m.id);
      if (p) (m.type === "audio" ? p.res(m) : p.rej(new Error(m.message)));
      else if (m.type === "error") $("voiceStatus").textContent = "The voice couldn't load on this device. Try No voice or Record my own voice.";
    }
  };
}
let loadStart = 0;
function speak(text) {
  const id = ++seq;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ type: "speak", id, text, voice: state.voice, speed: state.speed }); });
}
async function speakAll() {
  const raw = buildScenes(state.template, state.values, { endcard: state.endcard, photos: state.photos.length });
  const clips = {};
  const t0 = performance.now();
  for (let i = 0; i < raw.length; i++) {
    if (!raw[i].line) continue;
    $("voiceStatus").textContent = `Making line ${i + 1} of ${raw.length}…`;
    const m = await speak(raw[i].say || raw[i].line);
    clips[i] = { audio: m.audio, rate: m.rate };
  }
  state.clips = clips;
  $("voiceStatus").textContent = `Voice done in ${((performance.now() - t0) / 1000).toFixed(1)} s. Each line sets its scene's length.`;
  restart();
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
      const buf = await new Blob(chunks).arrayBuffer();
      state.recording = await new AudioContext().decodeAudioData(buf);
      recorder = null; $("recBtn").textContent = "Record again";
      $("voiceStatus").textContent = `Recorded ${state.recording.duration.toFixed(1)} s. It plays under the video from the start.`;
      restart();
    };
    state.playing = true; stopAudio(); state.t0 = performance.now(); // read the captions as the preview plays
    recorder.start();
    $("recBtn").textContent = "Stop recording";
    $("voiceStatus").textContent = "Recording: read each caption as it appears, then click Stop.";
    setTimeout(() => recorder && recorder.state === "recording" && recorder.stop(), totalDuration(timeline(scenes())) * 1000 + 300);
  } catch (e) {
    $("voiceStatus").textContent = "No microphone access, so nothing was recorded.";
  }
}

// ------------------------------------------------------------------------------------------------------- export
async function doExport() {
  const btn = $("exportBtn");
  btn.disabled = true;
  const t0 = performance.now();
  try {
    stopAudio();
    await fontsReady;
    const tl = timeline(scenes());
    const total = totalDuration(tl);
    $("exportStatus").textContent = "Mixing the sound…";
    const bed = state.bed !== "none" ? await renderBed(state.bed, total) : null;
    const audio = (bed || state.voiceMode !== "none") ? await mixAudio(tl, { clips: state.voiceMode === "ai" ? state.clips : {},
      recording: state.voiceMode === "record" ? state.recording : null, bed, lead: LEAD }) : null;
    const { blob, codecs } = await exportMp4(tl, opts(), audio, (p) => { $("exportStatus").textContent = `Making your video: ${Math.round(p * 100)}%`; });
    const secs = (performance.now() - t0) / 1000;
    const url = URL.createObjectURL(blob);
    $("result").hidden = false;
    $("resultVideo").src = url;
    const a = $("download");
    a.href = url; a.download = `video-${state.aspect}-${Date.now()}.mp4`;
    $("exportStatus").textContent = `Done in ${secs.toFixed(1)} s: ${(blob.size / 1e6).toFixed(1)} MB, ${total.toFixed(1)} s, ${codecs.video.toUpperCase()}${codecs.audio ? " + " + codecs.audio.toUpperCase() : ""}.`;
    const lk = look();
    gtagEvent("vm_export_ok", { template: state.template, aspect: state.aspect, voice: state.voiceMode, browser: browser(),
      seconds: Math.round(total), ms: Math.round(secs * 1000), codec: codecs.video,
      theme: state.theme, font: lk.font, motion: lk.motion, texture: lk.texture });
    window.__vmLast = { ms: Math.round(secs * 1000), size: blob.size, seconds: total, codecs, look: { ...lk, theme: lk.theme.id } };
  } catch (e) {
    $("exportStatus").textContent = `Sorry, the export failed on this browser: ${e.message}`;
    gtagEvent("vm_export_fail", { browser: browser(), template: state.template, message: String(e.message).slice(0, 90) });
    window.__vmLast = { error: String(e.message) };
  } finally {
    btn.disabled = false;
  }
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
function save() {
  try { localStorage.setItem(SAVE, JSON.stringify({ theme: state.theme === "logo" ? DEFAULT_THEME : state.theme, custom: state.custom, font: state.font, motion: state.motion, texture: state.texture })); }
  catch (e) { /* private mode: the look just isn't remembered */ }
  const q = new URLSearchParams(location.search);
  ["theme", "font", "motion", "texture", "bg", "ink", "accent"].forEach((k) => q.delete(k));
  if (state.theme !== "logo") q.set("theme", state.theme);
  if (state.theme === "custom") ["bg", "ink", "accent"].forEach((k) => q.set(k, state.custom[k].slice(1)));
  if (state.font) q.set("font", state.font);
  if (state.motion !== "smooth") q.set("motion", state.motion);
  if (state.texture) q.set("texture", state.texture);
  try { history.replaceState(null, "", `${location.pathname}?${q}`); } catch (e) { /* sandboxed */ }
}
function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SAVE) || "{}") || {}; } catch (e) { saved = {}; }
  const q = new URLSearchParams(location.search);
  const pick = (k, ok) => { const v = q.get(k) ?? saved[k]; return v != null && ok(v) ? v : null; };
  const color = (v) => (/^#?[0-9a-f]{6}$/i.test(v || "") ? "#" + v.replace("#", "") : null);
  state.theme = pick("theme", (v) => THEME_IDS.includes(v) || v === "custom") || DEFAULT_THEME;
  if (saved.custom) Object.keys(state.custom).forEach((k) => { state.custom[k] = color(saved.custom[k]) || state.custom[k]; });
  ["bg", "ink", "accent"].forEach((k) => { if (color(q.get(k))) state.custom[k] = color(q.get(k)); });
  state.font = pick("font", (v) => v === "" || v in FONTS) || "";
  state.motion = pick("motion", (v) => v in MOTIONS) || "smooth";
  state.texture = pick("texture", (v) => v === "" || v in TEXTURES) || "";
}
const themeFor = (id) => id === "custom" ? customTheme(state.custom.bg, state.custom.ink, state.custom.accent).theme
  : id === "logo" ? state.logoLook : THEMES.find((x) => x.id === id);
function swatchCard(id, name) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "swatch"; b.dataset.theme = id; b.setAttribute("aria-pressed", "false");
  const c = document.createElement("canvas"); c.width = 180; c.height = 230; c.setAttribute("aria-hidden", "true");
  const label = document.createElement("span"); label.textContent = name;
  b.append(c, label);
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
    state.logoColors = logoColors(x.getImageData(0, 0, 64, 64).data);
    const t = logoTheme(state.logoColors);
    state.logoLook = t ? { ...t, id: "logo", name: "Match my logo" } : null;
  }
  $("logoDots").innerHTML = (state.logoColors || []).slice(0, 3).map((x) => `<i style="background:${x.color}" title="${x.color}"></i>`).join("");
  if (state.theme === "logo" && !state.logoLook) pickTheme(DEFAULT_THEME);
  drawSwatches(); setLive();
}
function initLook() {
  load();
  const row = $("themes");
  THEMES.forEach((t) => row.appendChild(swatchCard(t.id, t.name)));
  row.appendChild(swatchCard("custom", "Custom"));
  row.appendChild(swatchCard("logo", "Match my logo"));
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
  $("copyLook").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); $("copyLook").textContent = "Link copied"; }
    catch (e) { $("copyLook").textContent = "Copy the address bar instead"; }
    setTimeout(() => { $("copyLook").textContent = "Copy a link to this look"; }, 2500);
  });
  pickTheme(state.theme);
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
  $("template").addEventListener("change", (e) => { state.template = e.target.value; state.values = {}; state.clips = {}; state.photos = []; $("photos").value = ""; renderFields(); restart(); });
  $("aspect").addEventListener("change", (e) => { state.aspect = e.target.value; restart(); });
  $("music").addEventListener("change", (e) => { state.bed = e.target.value; restart(); });
  $("endcard").addEventListener("change", (e) => { state.endcard = e.target.checked; state.clips = {}; markVoiceStale(); restart(); });
  $("captions").addEventListener("change", (e) => { state.captions = e.target.checked; });
  $("photos").addEventListener("change", async (e) => {
    const n = TEMPLATES[state.template].photos;
    state.photos = await Promise.all([...e.target.files].slice(0, n).map(readImage)); state.clips = {}; restart();
  });
  $("logo").addEventListener("change", async (e) => {
    state.logo = e.target.files[0] ? await readImage(e.target.files[0]) : null;
    readLogoColors();
    if (state.wantLogoLook && state.logoLook) pickTheme("logo");
  });
  $("voice").addEventListener("change", (e) => { state.voice = e.target.value; markVoiceStale(); });
  $("speed").addEventListener("input", (e) => { state.speed = Number(e.target.value); $("speedVal").textContent = `${state.speed.toFixed(2)}×`; markVoiceStale(); });
  document.querySelectorAll("input[name=voiceMode]").forEach((r) => r.addEventListener("change", () => {
    state.voiceMode = r.value;
    $("aiBox").hidden = r.value !== "ai"; $("recBox").hidden = r.value !== "record";
    $("voiceStatus").textContent = r.value === "ai" ? "The AI voice downloads about 90 MB the first time, then works offline." : "";
    restart();
  }));
  $("voiceBtn").addEventListener("click", () => {
    startWorker();
    if (voiceReady) { speakAll(); return; }
    loadStart = performance.now();
    $("voiceStatus").textContent = "Starting the voice…";
    // default: the 90 MB quantised model on WebAssembly (works everywhere). ?webgpu uses the GPU with the full
    // model (about 310 MB), for testing
    worker.postMessage({ type: "load", device: new URLSearchParams(location.search).has("webgpu") && navigator.gpu ? "webgpu" : "wasm" });
  });
  $("recBtn").addEventListener("click", record);
  $("playBtn").addEventListener("click", () => { state.playing = !state.playing; $("playBtn").textContent = state.playing ? "Pause" : "Play"; restart(); });
  $("exportBtn").addEventListener("click", doExport);
  $("ctaCheck").addEventListener("click", () => gtagEvent("vm_cta_click", { cta: "free_check" }));
  $("ctaFix").addEventListener("click", () => gtagEvent("vm_cta_click", { cta: "gmc_fix" }));
  renderFields();
  initLook();
  restart();
  requestAnimationFrame(frame);
  gtagEvent("vm_open", { browser: browser() });
  support(...SIZES[state.aspect]).then((s) => {
    if (!s.ok) { $("unsupported").hidden = false; $("unsupported").textContent = `${s.why} Try Chrome or Edge on a computer or Android phone; you can still preview here.`; $("exportBtn").disabled = true; }
  });
}
window.__vmStill = (t) => { const tl = timeline(scenes()); drawFrame(ctx, tl, t < 0 ? totalDuration(tl) + t : t, opts()); return canvas.toDataURL("image/png"); }; // a test hook: t < 0 counts from the end
init();
