// Free Video Maker: export. Draws every frame with the same engine as the preview, mixes voice and music in an
// OfflineAudioContext, and encodes an MP4 on the visitor's device with WebCodecs through Mediabunny (MPL-2.0).
// SPDX-License-Identifier: GPL-3.0-or-later
import {
  Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
  canEncodeVideo, canEncodeAudio, QUALITY_HIGH, QUALITY_MEDIUM,
} from "mediabunny";
import { drawFrame, totalDuration } from "./engine.js";

export const FPS = 30;
const RATE = 48000;

/** What this browser can make: {ok, video, audio, why}. */
export async function support(width, height) {
  if (typeof VideoEncoder === "undefined") return { ok: false, why: "This browser can't encode video yet (no WebCodecs)." };
  for (const video of ["avc", "vp9", "av1"]) {
    if (await canEncodeVideo(video, { width, height, frameRate: FPS, quality: QUALITY_HIGH })) {
      const audio = (await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: RATE, quality: QUALITY_MEDIUM })) ? "aac"
        : (await canEncodeAudio("opus", { numberOfChannels: 2, sampleRate: RATE, quality: QUALITY_MEDIUM })) ? "opus" : null;
      return { ok: true, video, audio };
    }
  }
  return { ok: false, why: "This browser can't encode H.264, VP9 or AV1 video at this size." };
}

/** Mix voice clips (placed at their scene's start + lead), a recording, and a music bed into one stereo buffer. */
export async function mixAudio(tl, { clips = {}, recording = null, bed = null, voiceGain = 1, musicGain = 0.5, lead = 0.12 }) {
  const seconds = totalDuration(tl);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * RATE), RATE);
  const anyVoice = recording || Object.keys(clips).length;
  if (bed) {
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = bed;
    g.gain.value = musicGain * (anyVoice ? 0.55 : 1); // music sits under the voice
    g.gain.setValueAtTime(g.gain.value, Math.max(0, seconds - 1.2));
    g.gain.linearRampToValueAtTime(0, seconds); // fade out at the end
    s.connect(g).connect(ctx.destination); s.start(0);
  }
  tl.forEach((sc, i) => {
    const c = clips[i];
    if (!c) return;
    const buf = ctx.createBuffer(1, c.audio.length, c.rate);
    buf.copyToChannel(c.audio, 0);
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf; g.gain.value = voiceGain;
    s.connect(g).connect(ctx.destination); s.start(sc.start + lead);
  });
  if (recording) {
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = recording; g.gain.value = voiceGain;
    s.connect(g).connect(ctx.destination); s.start(0);
  }
  return ctx.startRendering();
}

/** Render the whole video to an MP4 Blob. onProgress(0..1). */
export async function exportMp4(tl, opts, audioBuffer, onProgress = () => {}) {
  const { width, height } = opts;
  const sup = await support(width, height);
  if (!sup.ok) throw new Error(sup.why);
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d");
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: sup.video, quality: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: FPS });
  let audio = null;
  if (audioBuffer && sup.audio) {
    audio = new AudioBufferSource({ codec: sup.audio, quality: QUALITY_MEDIUM });
    output.addAudioTrack(audio);
  }
  await output.start();
  const seconds = totalDuration(tl);
  const frames = Math.round(seconds * FPS);
  for (let i = 0; i < frames; i++) {
    drawFrame(ctx, tl, i / FPS, opts);
    await video.add(i / FPS, 1 / FPS);
    if (i % 15 === 0) onProgress(i / frames);
  }
  video.close();
  if (audio) { await audio.add(audioBuffer); audio.close(); }
  await output.finalize();
  onProgress(1);
  return { blob: new Blob([output.target.buffer], { type: "video/mp4" }), codecs: sup };
}
