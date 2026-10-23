// Free Video Maker: the AI voice, in a Web Worker so the page stays responsive. kokoro-js (Kokoro-82M, Apache-2.0)
// runs on the visitor's own device: WebGPU when available, WebAssembly otherwise. The model downloads once (about
// 90 MB) and the browser caches it. Nothing is sent anywhere except that download.
// SPDX-License-Identifier: GPL-3.0-or-later
import { KokoroTTS } from "kokoro-js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let tts = null;

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === "load") {
      if (tts) return self.postMessage({ type: "ready", device: m.device });
      let device = m.device === "webgpu" ? "webgpu" : "wasm";
      try {
        tts = await KokoroTTS.from_pretrained(MODEL, {
          dtype: device === "webgpu" ? "fp32" : "q8", device,
          progress_callback: (p) => { if (p.status === "progress") self.postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total }); },
        });
      } catch (e) { // WebGPU present but unusable: fall back to WebAssembly
        if (device !== "webgpu") throw e;
        device = "wasm";
        tts = await KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device,
          progress_callback: (p) => { if (p.status === "progress") self.postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total }); } });
      }
      self.postMessage({ type: "ready", device });
    } else if (m.type === "speak") {
      const t0 = performance.now();
      const out = await tts.generate(m.text, { voice: m.voice, speed: m.speed || 1 });
      const audio = out.audio;
      self.postMessage({ type: "audio", id: m.id, audio, rate: out.sampling_rate, ms: performance.now() - t0 }, [audio.buffer]);
    }
  } catch (e) {
    self.postMessage({ type: "error", id: m.id, message: String(e && e.message || e) });
  }
};
