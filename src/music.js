// Free Video Maker: music beds, synthesised in the browser (no samples, no licences: they're generated, so they are
// ours to give away as CC0). Each bed is a looping 4-chord progression rendered in an OfflineAudioContext.
// SPDX-License-Identifier: GPL-3.0-or-later

export const BEDS = {
  none: { name: "No music" },
  bright: { name: "Bright", bpm: 104, chords: [[60, 64, 67], [67, 71, 74], [69, 72, 76], [65, 69, 72]], drums: true, pluck: true },
  calm: { name: "Calm", bpm: 76, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], drums: false, pluck: false },
  upbeat: { name: "Upbeat", bpm: 118, chords: [[62, 66, 69], [59, 62, 66], [55, 59, 62], [57, 61, 64]], drums: true, pluck: true },
  warm: { name: "Warm", bpm: 90, chords: [[53, 57, 60], [55, 58, 62], [50, 53, 57], [48, 52, 55]], drums: false, pluck: true },
};

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Render `seconds` of a bed at `rate` Hz, stereo. Returns an AudioBuffer (quiet: peaks around -14 dBFS). */
export async function renderBed(key, seconds, rate = 48000) {
  const b = BEDS[key];
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  if (!b || !b.chords) return ctx.startRendering();
  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(ctx.destination);
  const beat = 60 / b.bpm, bar = beat * 4;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 1400; lp.Q.value = 0.4; lp.connect(master);
  for (let t0 = 0, i = 0; t0 < seconds; t0 += bar, i++) {
    const chord = b.chords[i % b.chords.length];
    chord.forEach((m) => { // pad: two detuned saws per note, slow attack and release
      [-6, 6].forEach((cents) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sawtooth"; o.frequency.value = hz(m); o.detune.value = cents;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.05, t0 + 0.6);
        g.gain.setValueAtTime(0.05, t0 + bar - 0.4);
        g.gain.linearRampToValueAtTime(0, t0 + bar + 0.2);
        o.connect(g).connect(lp); o.start(t0); o.stop(t0 + bar + 0.25);
      });
    });
    const bass = ctx.createOscillator(), bg = ctx.createGain();
    bass.type = "sine"; bass.frequency.value = hz(chord[0] - 12);
    bg.gain.setValueAtTime(0.0001, t0); bg.gain.exponentialRampToValueAtTime(0.35, t0 + 0.05);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + bar);
    bass.connect(bg).connect(master); bass.start(t0); bass.stop(t0 + bar);
    for (let k = 0; k < 8; k++) { // eighth-note pluck arpeggio and light drums
      const t = t0 + k * beat / 2;
      if (t >= seconds) break;
      if (b.pluck) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "triangle"; o.frequency.value = hz(chord[k % 3] + 12);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g).connect(master); o.start(t); o.stop(t + 0.32);
      }
      if (b.drums) {
        if (k % 4 === 0) kick(ctx, master, t);
        hat(ctx, master, t + beat / 4);
      }
    }
  }
  return ctx.startRendering();
}

function kick(ctx, out, t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.26);
}

let noise = null;
function hat(ctx, out, t) {
  if (!noise || noise.sampleRate !== ctx.sampleRate) {
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; f.type = "highpass"; f.frequency.value = 7000;
  g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  s.connect(f).connect(g).connect(out); s.start(t);
}
