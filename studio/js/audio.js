// Procedural audio for project-shanni-happy — pure Web Audio synthesis.
// No samples, no assets: every sound is built from oscillators + filtered noise
// at play time. Matches the project's "everything programmatic" ethos and the
// calm pastel papercraft aesthetic (soft, warm, gentle — nothing harsh).
//
// Two jobs:
//   1. SFX  — one-shot game sounds (collect, win, hop, land, joy, step, ui).
//   2. Blip — Charlie-Brown muted-brass "wah" voice for dialogue, one little
//             wah per spoken glyph, pitch-walking like talking, falling on
//             sentence ends. Per-speaker timbre (Chrees low/gruff, Shen high).
//
// Browsers block audio until a user gesture, so call Sound.resume() from the
// first key/tap (idempotent). The AudioContext clock is independent of
// requestAnimationFrame, so it plays fine even in the suspended preview tab.

const CFG = {
  sfx: { collect: 0.5, win: 0.5, hop: 0.34, land: 0.42, joy: 0.5, step: 0.09, move: 0.3, talk: 0.42, select: 0.42 },
  blip: 0.17,
};

// Per-speaker voice for the dialogue "wah". base = root freq (Hz), range =
// pitch wander in semitones, mute = lowpass cap (lower = more muffled/brassy).
const VOICES = {
  Chrees:    { base: 132, range: 4, mute: 2100 },  // buff, gruff — low trombone
  Shen:      { base: 320, range: 5, mute: 2900 },  // player — bright, light
  _default:  { base: 210, range: 5, mute: 2600 },
};

const AC = window.AudioContext || window.webkitAudioContext;
const GAIN_CEIL = 0.8; // bus gain when volume = 1
let ctx = null, bus = null, comp = null;

// persisted prefs (volume 0..1, mute) — survive reloads via localStorage
const store = (() => { try { return window.localStorage; } catch (e) { return null; } })();
let volume = (() => { const v = store && store.getItem('shen.vol'); const n = v == null ? 0.7 : +v;
  return Math.max(0, Math.min(1, isFinite(n) ? n : 0.7)); })();
let muted = (store && store.getItem('shen.muted')) === '1';

function applyGain() { if (bus) bus.gain.value = muted ? 0 : volume * GAIN_CEIL; }
function persist() { try { if (store) { store.setItem('shen.vol', String(volume)); store.setItem('shen.muted', muted ? '1' : '0'); } } catch (e) {} }

// gentle master chain: bus gain -> soft lowpass -> limiter -> out. The lowpass
// keeps everything mellow; the compressor tames overlapping sounds.
function ensure() {
  if (ctx) return true;
  if (!AC) return false;
  ctx = new AC();
  bus = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7200; lp.Q.value = 0.4;
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 24; comp.ratio.value = 3.5;
  comp.attack.value = 0.004; comp.release.value = 0.18;
  bus.connect(lp).connect(comp).connect(ctx.destination);
  applyGain();
  return true;
}

const now = () => ctx.currentTime;
const rand = (a, b) => a + Math.random() * (b - a);

// a single enveloped oscillator note
function note({ type = 'sine', f, f2 = null, t0 = 0, dur = 0.18, gain = 0.3,
                atk = 0.006, detune = 0, dest = bus }) {
  const t = now() + t0;
  const o = ctx.createOscillator(); o.type = type; o.detune.value = detune;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.03);
}

// a short filtered-noise burst — the "paper" texture for taps/lands
function noise({ t0 = 0, dur = 0.08, gain = 0.2, freq = 1400, q = 0.8, type = 'lowpass', dest = bus }) {
  const t = now() + t0, len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const n = ctx.createBufferSource(); n.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f).connect(g).connect(dest); n.start(t); n.stop(t + dur + 0.02);
}

// pentatonic-ish frequencies (warm, never dissonant)
const A4 = 440;
const semi = n => A4 * Math.pow(2, n / 12);

const SFX = {
  // bright rising 3-note ping + a sparkle tail
  collect(v) {
    const seq = [3, 7, 10]; // C#5-ish, E5-ish, G5-ish over A4 root region
    seq.forEach((s, i) => note({ type: 'triangle', f: semi(s + 12), t0: i * 0.055, dur: 0.2, gain: v * 0.7 }));
    note({ type: 'sine', f: semi(15 + 12), t0: 0.11, dur: 0.22, gain: v * 0.45 });
  },
  // happy little fanfare for clearing the board
  win(v) {
    const seq = [0, 4, 7, 12, 16];
    seq.forEach((s, i) => {
      note({ type: 'triangle', f: semi(s + 12), t0: i * 0.12, dur: 0.34, gain: v * 0.6 });
      if (i === seq.length - 1) note({ type: 'sine', f: semi(s + 19), t0: i * 0.12, dur: 0.5, gain: v * 0.4 });
    });
  },
  // light upward "whoop"
  hop(v) {
    note({ type: 'triangle', f: semi(2), f2: semi(11), dur: 0.16, gain: v, atk: 0.004 });
  },
  // soft paper-thud on landing
  land(v) {
    note({ type: 'sine', f: semi(-10), f2: semi(-17), dur: 0.12, gain: v * 0.8 });
    noise({ dur: 0.07, gain: v * 0.5, freq: 900 });
  },
  // joyful launch — rising whee + sparkle
  joy(v) {
    note({ type: 'triangle', f: semi(0), f2: semi(14), dur: 0.34, gain: v });
    note({ type: 'sine', f: semi(19), t0: 0.16, dur: 0.3, gain: v * 0.5 });
  },
  // very soft paper footstep (slight random pitch so it never machine-guns)
  step(v) {
    note({ type: 'sine', f: semi(-14 + rand(-1.5, 1.5)), dur: 0.07, gain: v });
    noise({ dur: 0.04, gain: v * 0.6, freq: 1100, q: 0.6 });
  },
  // ui tick for choice navigation
  move(v) { note({ type: 'triangle', f: semi(10), dur: 0.06, gain: v }); },
  // soft chime when a dialogue opens
  talk(v) { note({ type: 'sine', f: semi(7), f2: semi(12), dur: 0.18, gain: v }); },
  // confirm a choice
  select(v) {
    note({ type: 'triangle', f: semi(7), dur: 0.09, gain: v });
    note({ type: 'triangle', f: semi(12), t0: 0.06, dur: 0.12, gain: v * 0.8 });
  },
};

// ---- dialogue "wah" voice ----
let lastBlip = 0, pitchWalk = 0;

function wah(f0, dur, fall, mute) {
  const t = now();
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  // slight pitch slur: up within a word, down at a sentence end ("wah-waaah")
  o.frequency.setValueAtTime(f0 * (fall ? 1.0 : 0.93), t);
  o.frequency.exponentialRampToValueAtTime(fall ? f0 * 0.6 : f0, t + dur);
  // the "wah": a bandpass formant that sweeps up then back down
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 4.5;
  bp.frequency.setValueAtTime(f0 * 2.2, t);
  bp.frequency.linearRampToValueAtTime(f0 * 5.0, t + dur * 0.4);
  bp.frequency.linearRampToValueAtTime(f0 * 1.7, t + dur);
  // lowpass = the mute (kills brightness -> Harmon-mute brass colour)
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = mute;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(CFG.blip, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(bp).connect(lp).connect(g).connect(bus);
  o.start(t); o.stop(t + dur + 0.03);
}

export const Sound = {
  get muted() { return muted; },
  get ready() { return !!ctx && ctx.state === 'running'; },

  // call from the first user gesture; idempotent
  resume() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
  },

  get volume() { return volume; },
  setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (volume > 0) muted = false;   // dragging the slider up unmutes
    applyGain(); persist();
    return volume;
  },
  setMuted(m) { muted = !!m; applyGain(); persist(); return muted; },
  toggle() { muted = !muted; applyGain(); persist(); return muted; },

  sfx(name, mul = 1) {
    if (muted || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const fn = SFX[name]; if (!fn) return;
    fn((CFG.sfx[name] ?? 0.3) * mul);
  },

  // one wah per spoken glyph; speaker picks the voice. Spaces = a breath
  // (silence). Throttled so it reads as "wah-wah-wah", not a buzz. Sentence
  // punctuation always sounds and falls in pitch.
  blip(ch, speaker) {
    if (muted || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (!ch || /\s/.test(ch)) return;          // breath on whitespace
    const end = /[.!?]/.test(ch);
    const t = now();
    if (!end && t - lastBlip < 0.085) return;  // cadence throttle
    lastBlip = t;
    const v = VOICES[speaker] || VOICES._default;
    pitchWalk += rand(-1.4, 1.4);
    pitchWalk = Math.max(-v.range, Math.min(v.range, pitchWalk));
    let s = pitchWalk + (/[aeiou]/i.test(ch) ? 1.5 : 0); // vowels lift a touch
    if (end) s -= 2;
    const f0 = v.base * Math.pow(2, s / 12);
    wah(f0, end ? 0.3 : 0.14, end, v.mute);
  },

  // reset the pitch walk so each new line starts neutral
  newLine() { pitchWalk = 0; },
};
