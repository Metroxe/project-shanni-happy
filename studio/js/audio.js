// Procedural audio for project-shanni-happy — pure Web Audio synthesis.
// No samples, no assets: every sound is built from oscillators + filtered noise
// at play time. Matches the project's "everything programmatic" ethos and the
// calm pastel papercraft aesthetic (soft, warm, gentle — nothing harsh).
//
// Two jobs:
//   1. SFX  — one-shot game sounds (hop, land, step, squeak, quest, ui).
//   2. Blip — Charlie-Brown muted-brass "wah" voice for dialogue, one little
//             wah per spoken glyph, pitch-walking like talking, falling on
//             sentence ends. Per-speaker timbre (Chrees low/gruff, Shen high).
//
// Browsers block audio until a user gesture, so call Sound.resume() from the
// first key/tap (idempotent). The AudioContext clock is independent of
// requestAnimationFrame, so it plays fine even in the suspended preview tab.

const CFG = {
  sfx: { hop: 0.34, land: 0.42, step: 0.09, stepSoft: 0.08, move: 0.3, talk: 0.42, select: 0.42,
         squeak: 0.34, quest: 0.42, questStep: 0.44, questDone: 0.5, book: 0.4, bookClose: 0.36, flip: 0.3,
         fs: 0.4, lift: 0.18, door: 0.4, chirp: 0.26, bubble: 0.12, clink: 0.16 },
  blip: 0.17,
  water: 0.14,   // ambient fountain trickle ceiling (faded in by player proximity — a spatial world sound)
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

// background music: one looping AudioBufferSourceNode through the music sub-bus, plus
// a PER-URL decoded-buffer cache so each scene/room can carry its OWN track. Switching
// tracks crossfades; switching back to an already-decoded track is instant + gapless;
// re-asking for the track that's already looping is a no-op (no restart, no seam).
// musicURL = the DESIRED track (the active scene's); musicPlayingURL = the track the
// live source is actually looping. Keeping them separate is what makes the switch
// correct: we only no-op when the PLAYING track already matches, and we never stop the
// old track without starting the new one.
let musicSrc = null, musicURL = null, musicPlayingURL = null;
const musicBufs = {}, musicLoads = {};            // url -> AudioBuffer / pending load
let musicStarted = false, lastMusicVol = 0.42;   // remembers level across an off→on toggle
let lastSfxVol = 1.0;                             // ditto for effects (off→on restores this)

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
if (sfxVol > 0) lastSfxVol = sfxVol;

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
function playMusic(buf, fadeIn, url) {
  if (!buf || !musicGain) return;
  if (musicSrc) { try { musicSrc.stop(); } catch (e) {} musicSrc.disconnect(); musicSrc = null; }
  musicSrc = ctx.createBufferSource();
  musicSrc.buffer = buf; musicSrc.loop = true;
  musicSrc.connect(musicGain);
  musicSrc.start();
  musicPlayingURL = url || musicURL;
  if (fadeIn) { musicGain.gain.setValueAtTime(0.0001, ctx.currentTime); rampMusic(musicVol, 1.0); }
  else musicGain.gain.value = musicVol;
}

const now = () => ctx.currentTime;
const rand = (a, b) => a + Math.random() * (b - a);

// ambient fountain water: one looping filtered-noise babble on the SFX sub-bus, its
// level driven each frame by the player's distance to the fountain (a spatial world
// sound — full when near, silent when far). Created lazily on the first audible call.
let waterSrc = null, waterAmp = null, waterLfo = null, waterLfoGain = null;
function startWater() {
  if (!ctx || waterSrc) return;
  const len = Math.ceil(ctx.sampleRate * 2.2), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0;                                  // light low-pass on white noise → soft "brook"
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 920; bp.Q.value = 0.7;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
  const amp = ctx.createGain(); amp.gain.value = 0;          // base level (proximity)
  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.7;  // slow babble
  const lfoG = ctx.createGain(); lfoG.gain.value = 0;        // wobble depth (set with level)
  lfo.connect(lfoG).connect(amp.gain);
  src.connect(bp).connect(lp).connect(amp).connect(sfxGain);
  src.start(); lfo.start();
  waterSrc = src; waterAmp = amp; waterLfo = lfo; waterLfoGain = lfoG;
}

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
  // light upward "whoop"
  hop(v) {
    note({ type: 'triangle', f: semi(2), f2: semi(11), dur: 0.16, gain: v, atk: 0.004 });
  },
  // soft paper-thud on landing
  land(v) {
    note({ type: 'sine', f: semi(-10), f2: semi(-17), dur: 0.12, gain: v * 0.8 });
    noise({ dur: 0.07, gain: v * 0.5, freq: 900 });
  },
  // very soft paper footstep (slight random pitch so it never machine-guns)
  step(v) {
    note({ type: 'sine', f: semi(-14 + rand(-1.5, 1.5)), dur: 0.07, gain: v });
    noise({ dur: 0.04, gain: v * 0.6, freq: 1100, q: 0.6 });
  },
  // muffled footstep for soft ground (park grass) — duller, less click
  stepSoft(v) {
    note({ type: 'sine', f: semi(-17 + rand(-1.2, 1.2)), dur: 0.08, gain: v * 0.9 });
    noise({ dur: 0.05, gain: v * 0.5, freq: 620, q: 0.5 });
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
  // fullscreen toggle: a soft airy paper "whoosh" opening up + a gentle rise
  fs(v) {
    noise({ dur: 0.2, gain: v * 0.34, freq: 900, q: 0.5, type: 'bandpass' });
    note({ type: 'triangle', f: semi(0), f2: semi(12), dur: 0.24, gain: v * 0.4, atk: 0.008 });
  },
  // soft effort "hnf" for a weight rep — a low woody note that lifts + a breathy
  // puff. Fires on the up-swing of a pose loop; kept gentle since it repeats each rep.
  lift(v) {
    note({ type: 'sine', f: semi(-12), f2: semi(-6), dur: 0.17, gain: v * 0.7, atk: 0.02 });
    noise({ dur: 0.12, gain: v * 0.4, freq: 600, q: 0.6 });
  },
  // a shop door: a little brass bell jingle (two-three bright dings) + a soft wood
  // latch. Played when stepping through a loading-zone door (player-driven, full).
  door(v) {
    [19, 24, 28].forEach((s, i) => note({ type: 'sine', f: semi(s), t0: i * 0.05, dur: 0.26, gain: v * 0.45, atk: 0.003 }));
    note({ type: 'triangle', f: semi(22), t0: 0.02, dur: 0.2, gain: v * 0.25 });
    noise({ t0: 0.015, dur: 0.07, gain: v * 0.4, freq: 480, q: 0.6 });   // wood thunk
  },
  // a tiny bird tweet — a quick bright up-slur. Spatial: gated by the player's
  // proximity to the birdcage in the pet shop (mul passed through Sound.sfx).
  chirp(v) {
    note({ type: 'triangle', f: semi(28), f2: semi(34), dur: 0.07, gain: v * 0.7, atk: 0.004 });
    note({ type: 'sine',     f: semi(33), f2: semi(38), t0: 0.06, dur: 0.08, gain: v * 0.45 });
  },
  // a single soft AQUARIUM bubble — a low rounded "bloop" that rises + pops, with a
  // little random pitch so a stream never machine-guns. Deliberately gentle + far
  // quieter than the fountain's water rush: a tank is not a fountain. Spatial: fired
  // by the scene's `ambients` loop, gated by proximity (mul passed through).
  bubble(v) {
    const f = 150 + rand(-25, 70);
    note({ type: 'sine', f: f * 0.85, f2: f * 2.0, dur: 0.10, gain: v, atk: 0.004 });
    if (Math.random() < 0.4) note({ type: 'sine', f: f * 1.3, f2: f * 2.6, t0: 0.05, dur: 0.07, gain: v * 0.5 });
  },
  // a soft metallic weight "tink" — the ambient settle of dumbbells/plates in a working gym.
  // Gentle + a little random pitch so it never rings the same twice. Spatial: fired by the
  // gym's `ambients` loop near the free-weight area, gated by player proximity (mul passed in).
  clink(v) {
    const f = 620 + rand(-50, 90);
    note({ type: 'triangle', f, dur: 0.09, gain: v * 0.7, atk: 0.002 });
    note({ type: 'sine', f: f * 1.5, t0: 0.02, dur: 0.07, gain: v * 0.4, atk: 0.002 });
    noise({ dur: 0.05, gain: v * 0.22, freq: 3000, q: 1.2, type: 'bandpass' });
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
  get sfxOn() { return sfxVol > 0; },            // derived: "on" == audible (RuneScape-style toggle)
  setSfxVolume(v) {
    sfxVol = clamp01(v);
    if (sfxVol > 0) lastSfxVol = sfxVol;
    ensure(); applySfx(); persistSfx();
    return sfxVol;
  },
  // convenience on/off that remembers the last audible level (mirrors music)
  toggleSfx() { return this.setSfxVolume(sfxVol > 0 ? 0 : (lastSfxVol || 1.0)); },
  setSfxOn(on) { return this.setSfxVolume(on ? (sfxVol > 0 ? sfxVol : (lastSfxVol || 1.0)) : 0); },

  sfx(name, mul = 1) {
    if (muted || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const fn = SFX[name]; if (!fn) return;
    fn((CFG.sfx[name] ?? 0.3) * mul);
  },

  // ambient fountain water level (0..1), set every frame from player proximity
  // (game.html draws it via proxGain). Routes through the SFX sub-bus → effects + master sliders cover it.
  setWaterLevel(v) {
    v = clamp01(v);
    if (v > 0 && !waterSrc) { if (!ensure()) return v; if (ctx.state === 'suspended') ctx.resume(); startWater(); }
    if (!waterAmp) return v;
    const t = ctx.currentTime, lvl = v * (CFG.water || 0.14);
    waterAmp.gain.cancelScheduledValues(t);
    waterAmp.gain.setValueAtTime(Math.max(0.00001, waterAmp.gain.value), t);
    waterAmp.gain.linearRampToValueAtTime(lvl, t + 0.2);
    if (waterLfoGain) waterLfoGain.gain.setTargetAtTime(lvl * 0.4, t, 0.2);
    return v;
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
  get musicTrack() { return musicSrc ? musicPlayingURL : null; },   // the URL actually looping now (debug/QA)

  // read-only live gains, for verify-in-preview (see CLAUDE.md "Verify in preview")
  get levels() { return { ctx: ctx && ctx.state, bus: bus ? bus.gain.value : null,
    sfx: sfxGain ? sfxGain.gain.value : null, music: musicGain ? musicGain.gain.value : null }; },

  // Begin the looping background track. Call AFTER a user gesture (the title
  // Start/Continue press) — never browser-autoplay. Fetch+decode happens once;
  // the buffer is cached so a later level-up is instant. Decode failure (e.g. a
  // browser that can't read OGG) degrades to "no music", never a crash.
  //   autoplay=false → "arm" only: set the URL + preload, but don't start the
  //   loop. The music slider (setMusicVolume) still starts it on demand. Used in
  //   dev so the track stays silent until you ask for it; prod passes true.
  // Set the active scene's track + start/switch to it. If that track is ALREADY the one
  // looping → no-op (no restart, no seam). If music is currently audible (a source is
  // playing) OR the caller asks to autoplay, switch to the new track (the old source is
  // replaced as the new one fades in — never stopped-without-start). If music is off and
  // autoplay is false, just ARM the url so turning music on later plays THIS scene's track.
  startMusic(url, autoplay = true) {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (url) musicURL = url;
    musicStarted = true;
    const want = musicURL;
    if (musicSrc && musicPlayingURL === want) return;            // already looping the right track
    const shouldPlay = musicVol > 0 && (musicSrc != null || autoplay);
    if (!shouldPlay) return;                                     // armed only — turning music on will start `want`
    loadMusicBuffer(want).then(buf => {
      if (buf && musicVol > 0 && musicStarted && musicURL === want) playMusic(buf, true, want);  // replaces the old source
    });
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
    else if (musicStarted) { const want = musicURL; loadMusicBuffer(want).then(buf => { if (buf && musicVol > 0 && musicURL === want) playMusic(buf, true, want); }); } // was off → start the active scene's track
    return musicVol;
  },
  // convenience on/off that remembers the last audible level
  toggleMusic() { return this.setMusicVolume(musicVol > 0 ? 0 : (lastMusicVol || 0.42)); },
  setMusicOn(on) { return this.setMusicVolume(on ? (musicVol > 0 ? musicVol : (lastMusicVol || 0.42)) : 0); },

  // Dev builds boot QUIET: default both effects and music OFF so working on the game
  // locally isn't noisy. Only overrides a level the user hasn't explicitly chosen (no
  // stored key) — a manual slider change persists and is still respected on the next
  // dev load. Deliberately does NOT persist its own 0, so the stored state stays clean
  // and a real deploy (isDev=false) is never touched. Call once at boot, after BUILD
  // resolves. lastMusicVol is left at its default so toggling music on still works.
  quietInDev(isDev) {
    if (!isDev || !store) return;
    if (store.getItem('shen.sfxvol')   == null) { sfxVol = 0; applySfx(); }  // applySfx no-ops until the bus exists; ensure() then reads sfxVol=0
    if (store.getItem('shen.musicvol') == null) { musicVol = 0; }            // music isn't playing yet → just keep it off
  },
};

// fetch + decode a track ONCE per URL; cached in musicBufs. Returns the buffer (or
// null on failure — a missing/undecodable track degrades to "no music", never a crash).
function loadMusicBuffer(url) {
  url = url || musicURL;
  if (!url || !ctx) return Promise.resolve(null);
  if (musicBufs[url]) return Promise.resolve(musicBufs[url]);
  if (musicLoads[url]) return musicLoads[url];
  musicLoads[url] = fetch(url)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(ab => ctx.decodeAudioData(ab))
    .then(buf => { musicBufs[url] = buf; delete musicLoads[url]; return buf; })
    .catch(e => { delete musicLoads[url]; console.warn('[music] load failed (' + url + '):', (e && e.message) || e); return null; });
  return musicLoads[url];
}

// fade out + stop the current source (clock-accurate, no click); safe if none.
function stopMusicNode(fade = 0.5) {
  if (!musicSrc || !ctx) return;
  const s = musicSrc; musicSrc = null; musicPlayingURL = null;
  rampMusic(0.0001, fade);
  try { s.stop(ctx.currentTime + fade + 0.05); } catch (e) {}
  s.onended = () => { try { s.disconnect(); } catch (e) {} };
}
