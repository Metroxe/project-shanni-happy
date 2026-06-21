// Cutscene engine for project-shanni-happy.
// A tiny, UI- and scene-agnostic BEAT TIMELINE — the Paper-Mario "the world plays
// itself while you watch" director. Same ethos as dialogue.js / quests.js: pure-ish
// sequencing here, with ALL the visuals supplied by the caller as plain closures, so
// the scene-specific staging (which mesh is the table, how the camera frames Adrian)
// lives in game.html next to the other builders, and this module just keeps time.
//
// A cutscene is an array of BEATS. A beat is a small object of lifecycle callbacks
// plus a completion rule — pick exactly one:
//   { dur, ease?, start?, update?(u,dt), end? }   timed: runs for `dur` seconds, then
//                                                  auto-advances (update gets eased u 0..1)
//   { hold:true, start?, update?, end? }           waits for the player to press Next
//   { until:()=>bool, dur?, start?, update?, end? } waits until the predicate is true
//                                                   (e.g. a dialogue line has closed)
//   { start?, end? }                               instant: fires and falls straight through
// `start` fires once on entry, `end` once on exit; `update(u,dt)` every frame while the
// beat is active (u is the eased 0..1 progress for timed beats, dt the frame seconds).
// Author concurrency by having one beat's update drive several things at once (the
// camera dollies WHILE Shen walks WHILE the hamsters scatter) — no separate "group"
// primitive needed.
//
// Camera: the engine owns nothing visual EXCEPT a plain `cam` handoff object
// { pos:[x,y,z], tgt:[x,y,z], fov } that cam-beats write each frame; game.html reads
// Cutscene.cam and points the real camera at it while a cutscene is active. Between
// beats / during a hold the last value persists, so the shot holds steady.

export const Cutscene = {
  active: false,
  label: null,
  cam: { pos: [0, 4, 7], tgt: [0, 1, -3], fov: 46 },
  // who/what the current beat is meant to FRAME ('shen'|'adrian'|'two'|'table'|'hamsters'|
  // 'wide'|null). game.html records this each frame and the QA asserts the subject is
  // actually on-screen — that's how "the camera zoomed in on someone who isn't there" gets
  // caught automatically forever (a beat that frames empty space fails the framing trace).
  subject: null,
  onEnd: null,                 // () fired once when the timeline finishes (or is skipped)
  _beats: null, _i: -1, _t: 0, _hold: false,

  // begin a timeline. opts.onEnd overrides the persistent onEnd for this run.
  play(beats, opts = {}) {
    this._beats = beats || [];
    this._i = -1; this._t = 0; this._hold = false;
    this.active = true; this.subject = null;
    this.label = opts.label || null;
    if (opts.onEnd) this.onEnd = opts.onEnd;
    this._next();                                  // enter the first beat
  },

  _cur() { return this._beats ? this._beats[this._i] : null; },

  // exit the current beat (run its update(1)+end) and enter the next; auto-fall-through
  // instant beats so a run of pure side-effect beats resolves in one tick.
  _next() {
    const c = this._cur();
    if (c) { if (c.update) c.update(1, 0); if (c.end) c.end(); }
    this._i++; this._t = 0; this._hold = false;
    if (!this._beats || this._i >= this._beats.length) return this._finish();
    const b = this._cur();
    if (b.subject != null) this.subject = b.subject;   // sticky: side-effect beats keep the last framed subject
    if (b.start) b.start();
    const timed = b.dur > 0;
    if (!timed && !b.hold && !b.until) return this._next();   // instant beat
  },

  // advance the clock; called every frame from the game loop while active.
  step(dt) {
    if (!this.active) return;
    const b = this._cur();
    if (!b) return this._finish();
    if (b.dur > 0) {
      this._t += dt;
      const u = Math.min(1, this._t / b.dur);
      const e = b.ease ? b.ease(u) : u;
      if (b.update) b.update(e, dt);
      // a timed beat MAY also carry `until` as an EARLY-OUT — finish the moment the predicate is
      // true (e.g. the last hamster clears the door), with `dur` as a safety cap. Without `until`,
      // dur alone drives it.
      if (b.until && b.until()) return this._next();
      if (u < 1) return;                            // still animating this beat
    }
    if (b.until) { if (b.until()) this._next(); return; }      // wait on a predicate
    if (b.hold) { this._hold = true; return; }                // wait on the player
    this._next();                                             // timed/auto: advance
  },

  // the player pressed Next. Only resolves a HOLD beat — `until` beats (e.g. dialogue)
  // resolve themselves when their predicate flips, so a stray Next there is ignored.
  next() {
    if (this.active && this._hold) { this._next(); return true; }
    return false;
  },

  // run the whole remaining timeline instantly to its end STATE (for QA / debug skip):
  // every remaining beat's start→update(1)→end fires in order, so all side effects land
  // (table tipped, hamsters gone, quest started) and any open dialogue is closed by the
  // beats' own end() hooks. Then onEnd runs as normal.
  skip() {
    if (!this.active) return;
    let guard = 0;
    while (this.active && guard++ < 2000) {
      const b = this._cur();
      if (!b) { this._finish(); break; }
      if (b.update) b.update(1, 0);
      if (b.end) b.end();
      this._i++; this._t = 0; this._hold = false;
      if (!this._beats || this._i >= this._beats.length) { this._finish(); break; }
      const nb = this._cur();
      if (nb.start) nb.start();
    }
  },

  _finish() {
    this.active = false; this._beats = null; this._i = -1; this._hold = false;
    const cb = this.onEnd; this.onEnd = null;       // one-shot; play() re-arms per run
    if (cb) cb();
  },

  // tiny status surface for the debug console + QA probes
  status() {
    return { active: this.active, label: this.label, beat: this._i,
      total: this._beats ? this._beats.length : 0, holding: this._hold };
  },
};
