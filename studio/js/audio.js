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
  sfx: { collect: 0.5, win: 0.5, hop: 0.34, land: 0.42, joy: 0.5, step: 0.09, move: 0.3, talk: 0.42, select: 0.42,
         squeak: 0.34, quest: 0.42, questStep: 0.44, questDone: 0.5, book: 0.4, bookClose: 0.36, flip: 0.3 },
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
const GAIN_CEIL = 0.8; // master bus gain when volume = 1
const clamp01 = v => Math.max(0, Math.min(1, v));
let ctx = null, bus = null, comp = null, sfxGain = null, musicGain = null;

// background-music state: one looping AudioBufferSourceNode through its sub-bus.
let musicBuf = null, musicSrc = null, musicURL = null, musicLoading = null;
let musicStarted = false, lastMusicVol = 0.42;   // remembers level across an off→on toggle

// THREE independent levels, each on its own localStorage key so they survive
// reloads separately (none of these live in the save blob):
//   master "volume" (shen.vol) + mute (shen.muted)  scale EVERYTHING (master bus),
//   "effects"        (shen.sfxvol)                   scales the SFX + voice sub-bus,
//   "music"          (shen.musicvol)                 scales the music sub-bus (0 = off).
// Defaults reproduce the prior single-volume behaviour exactly (sfx full, music 0.42).
const store = (() => { try { return window.localStorage; } catch (e) { return null; } })();
const readNum = (k, d) => { const v = store && store.getItem(k); const n = v == null ? d : +v;
  return clamp01(isFinite(n) ? n : d); };
let volume   = readNum('shen.vol', 0.7);
let muted    = (store && store.getItem('shen.muted')) === '1';
let sfxVol   = readNum('shen.sfxvol', 1.0);     // effects at full by default
let musicVol = readNum('shen.musicvol', 0.42);  // music gently under the SFX
if (musicVol > 0) lastMusicVol = musicVol;

function applyGain() { if (bus) bus.gain.value = muted ? 0 : volume * GAIN_CEIL; }
function applySfx()  { if (sfxGain) sfxGain.gain.value = sfxVol; }
function persist()      { try { if (store) { store.setItem('shen.vol', String(volume)); store.setItem('shen.muted', muted ? '1' : '0'); } } catch (e) {} }
function persistSfx()   { try { if (store) store.setItem('shen.sfxvol', String(sfxVol)); } catch (e) {} }
function persistMusic() { try { if (store) store.setItem('shen.musicvol', String(musicVol)); } catch (e) {} }

// gentle master chain: bus gain -> soft lowpass -> limiter -> out. The lowpass
// keeps everything mellow; the compressor tames overlapping sounds. TWO sub-buses
// feed INTO bus — sfxGain (SFX + dialogue voice) and musicGain (the loop) — so the
// master volume + mute scale both for free, while each sub-bus gain sets its own
// independent level ("effects" / "music" sliders).
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
  sfxGain = ctx.createGain(); sfxGain.gain.value = sfxVol; sfxGain.connect(bus);
  musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(bus);
  applyGain();
  return true;
}

// fade the music sub-bus to a target level (short ramp = no click on toggle)
function rampMusic(to, dur = 0.6) {
  if (!musicGain) return;
  const t = ctx.currentTime;
  musicGain.gain.cancelScheduledValues(t);
  musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), t);
  musicGain.gain.linearRampToValueAtTime(to, t + dur);
}

// (re)start the looping source from the decoded buffer. AudioBufferSourceNode is
// single-use, so each (re)start makes a fresh node. loop=true → gapless repeat.
function playMusic(fadeIn) {
  if (!musicBuf || !musicGain) return;
  if (musicSrc) { try { musicSrc.stop(); } catch (e) {} musicSrc.disconnect(); musicSrc = null; }
  musicSrc = ctx.createBufferSource();
  musicSrc.buffer = musicBuf; musicSrc.loop = true;
  musicSrc.connect(musicGain);
  musicSrc.start();
  if (fadeIn) { musicGain.gain.setValueAtTime(0.0001, ctx.currentTime); rampMusic(musicVol, 1.4); }
  else musicGain.gain.value = musicVol;
}

const now = () => ctx.currentTime;
const rand = (a, b) => a + Math.random() * (b - a);

// a single enveloped oscillator note
function note({ type = 'sine', f, f2 = null, t0 = 0, dur = 0.18, gain = 0.3,
                atk = 0.006, detune = 0, dest = sfxGain }) {
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
function noise({ t0 = 0, dur = 0.08, gain = 0.2, freq = 1400, q = 0.8, type = 'lowpass', dest = sfxGain }) {
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
  // tiny "eep" — a found hamster (two quick bright chirps, soft)
  squeak(v) {
    note({ type: 'triangle', f: semi(19), f2: semi(26), dur: 0.10, gain: v * 0.8, atk: 0.005 });
    note({ type: 'sine', f: semi(24), f2: semi(31), t0: 0.06, dur: 0.12, gain: v * 0.5 });
  },
  // accepting a new quest — a warm rounded ascending arpeggio
  quest(v) {
    [0, 4, 7].forEach((s, i) => note({ type: 'sine', f: semi(s + 7), t0: i * 0.08, dur: 0.3, gain: v * 0.5 }));
    note({ type: 'triangle', f: semi(19), t0: 0.16, dur: 0.34, gain: v * 0.4 });
  },
  // a task within a quest ticked off — bright little rise, sub-celebration
  questStep(v) {
    [0, 5, 9].forEach((s, i) => note({ type: 'triangle', f: semi(s + 12), t0: i * 0.06, dur: 0.2, gain: v * 0.55 }));
  },
  // a whole quest finished — a gentle warm fanfare (softer than `win`)
  questDone(v) {
    const seq = [0, 4, 7, 11, 14];
    seq.forEach((s, i) => {
      note({ type: 'triangle', f: semi(s + 7), t0: i * 0.1, dur: 0.3, gain: v * 0.5 });
      if (i === seq.length - 1) note({ type: 'sine', f: semi(s + 14), t0: i * 0.1, dur: 0.5, gain: v * 0.35 });
    });
  },
  // opening the journal — a soft paper "whff" + low warm note
  book(v) {
    noise({ dur: 0.16, gain: v * 0.45, freq: 520, q: 0.5 });
    note({ type: 'sine', f: semi(-5), f2: semi(0), dur: 0.2, gain: v * 0.35 });
  },
  // closing the journal — softer thunk, falling
  bookClose(v) {
    noise({ dur: 0.14, gain: v * 0.4, freq: 420, q: 0.5 });
    note({ type: 'sine', f: semi(0), f2: semi(-7), dur: 0.18, gain: v * 0.32 });
  },
  // turning a page (tab switch) — a quick paper swish (bright → soft)
  flip(v) {
    noise({ dur: 0.11, gain: v * 0.4, freq: 2600, q: 0.7, type: 'bandpass' });
    noise({ t0: 0.025, dur: 0.10, gain: v * 0.3, freq: 1500, q: 0.6 });
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
  o.connect(bp).connect(lp).connect(g).connect(sfxGain);
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

  // master "volume" — scales the whole mix (both sub-buses)
  get volume() { return volume; },
  setVolume(v) {
    volume = clamp01(v);
    if (volume > 0) muted = false;   // dragging the master up unmutes
    applyGain(); persist();
    return volume;
  },
  setMuted(m) { muted = !!m; applyGain(); persist(); return muted; },
  toggle() { muted = !muted; applyGain(); persist(); return muted; },

  // "effects" — SFX + dialogue-voice sub-bus level, independent of music
  get sfxVolume() { return sfxVol; },
  setSfxVolume(v) {
    sfxVol = clamp01(v);
    ensure(); applySfx(); persistSfx();
    return sfxVol;
  },

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

  // ---- background music ----
  get musicVolume() { return musicVol; },
  get musicOn() { return musicVol > 0; },        // derived: "on" == audible
  get musicPlaying() { return !!musicSrc; },

  // read-only live gains, for verify-in-preview (see CLAUDE.md "Verify in preview")
  get levels() { return { ctx: ctx && ctx.state, bus: bus ? bus.gain.value : null,
    sfx: sfxGain ? sfxGain.gain.value : null, music: musicGain ? musicGain.gain.value : null }; },

  // Begin the looping background track. Call AFTER a user gesture (the title
  // Start/Continue press) — never autoplay. Fetch+decode happens once; the
  // buffer is cached so a later level-up is instant. Decode failure (e.g. a
  // browser that can't read OGG) degrades to "no music", never a crash.
  startMusic(url) {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (url) musicURL = url;
    musicStarted = true;
    loadMusicBuffer().then(buf => { if (buf && musicVol > 0 && musicStarted) playMusic(true); });
  },

  stopMusic() { stopMusicNode(0.5); },

  // "music" — the loop's own level. 0 stops the source entirely (off); raising
  // from 0 starts it. Independent of the effects level + master.
  setMusicVolume(v) {
    musicVol = clamp01(v);
    if (musicVol > 0) lastMusicVol = musicVol;
    persistMusic();
    if (!ensure()) return musicVol;
    if (ctx.state === 'suspended') ctx.resume();
    if (musicVol <= 0) stopMusicNode(0.4);                          // off
    else if (musicSrc) rampMusic(musicVol, 0.25);                   // already playing → re-level
    else if (musicStarted) loadMusicBuffer().then(buf => { if (buf && musicVol > 0) playMusic(true); }); // was off → start
    return musicVol;
  },
  // convenience on/off that remembers the last audible level
  toggleMusic() { return this.setMusicVolume(musicVol > 0 ? 0 : (lastMusicVol || 0.42)); },
  setMusicOn(on) { return this.setMusicVolume(on ? (musicVol > 0 ? musicVol : (lastMusicVol || 0.42)) : 0); },
};

// fetch + decode the loop ONCE; cached. Returns the buffer (or null on failure).
function loadMusicBuffer() {
  if (musicBuf) return Promise.resolve(musicBuf);
  if (musicLoading) return musicLoading;
  if (!musicURL || !ctx) return Promise.resolve(null);
  musicLoading = fetch(musicURL)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(ab => ctx.decodeAudioData(ab))
    .then(buf => { musicBuf = buf; musicLoading = null; return buf; })
    .catch(e => { musicLoading = null; console.warn('[music] load failed:', (e && e.message) || e); return null; });
  return musicLoading;
}

// fade out + stop the current source (clock-accurate, no click); safe if none.
function stopMusicNode(fade = 0.5) {
  if (!musicSrc || !ctx) return;
  const s = musicSrc; musicSrc = null;
  rampMusic(0.0001, fade);
  try { s.stop(ctx.currentTime + fade + 0.05); } catch (e) {}
  s.onended = () => { try { s.disconnect(); } catch (e) {} };
}
