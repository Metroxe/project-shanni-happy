// Quest engine for project-shanni-happy.
// Data-driven, goal-based, auto-advancing. UI-agnostic (owns no DOM — the journal
// in game.html reads it), and persistence-agnostic (serialize()/restore via init).
// Same ethos as dialogue.js + save.js: pure-ish state, defensive, derive-don't-store.
//
// Quest def (world.json `quests[]`):
//   { id, name, giver?, summary?, steps:[ { desc, goal? } ] }
// A step's `goal` decides how it auto-completes (no goal === 'manual'):
//   { type:'collect', kind?, ids?, count? }  collected pickups matching kind/ids reach count
//   { type:'talk',   npc }                   you talk to npc (fed via note({type:'talk',npc}))
//   { type:'reach',  x, z, r? }              you reach within r of (x,z) (note({type:'reach',x,z}))
//   { type:'manual' }                        advances only via Quests.advance(id) (dialogue/script)
//
// State is COMPACT + persisted:  state[id] = { status:'active'|'done', step:int }.
// Collect-goal progress is DERIVED from the live collected set on every eval (via the
// ctx provider), so it survives a reload with no stored counters — if you collected the
// flowers while the quest was away, re-eval on init walks the step forward to match.
//
// Quests not in `state` are "unstarted" and don't appear in the journal until started.

export const Quests = {
  defs: {},          // id -> def
  order: [],         // def ids in declaration order (stable listing)
  state: {},         // id -> { status, step }
  ctx: {},           // { collectedIds:()=>Set<id>, kindOf:(id)=>kind }
  // hooks (game.html wires these to audio + journal toasts; all side-effect only)
  onStart: null,     // (def)              a quest became active
  onAdvance: null,   // (def, step)        a non-final step completed
  onComplete: null,  // (def)              a quest finished

  // defs: array from world.json; saved: serialize() blob (or null); ctx: providers
  init(defs, saved, ctx) {
    this.defs = {}; this.order = [];
    (defs || []).forEach(d => { if (d && d.id) { this.defs[d.id] = d; this.order.push(d.id); } });
    this.ctx = ctx || {};
    this.state = {};
    if (saved && typeof saved === 'object') {
      for (const id of this.order) {
        const s = saved[id];
        if (s && (s.status === 'active' || s.status === 'done')) {
          const total = this.defs[id].steps.length;
          this.state[id] = { status: s.status, step: clampStep(s.step, total) };
          if (s.status === 'done') this.state[id].step = total;
        }
      }
    }
    // progress may have moved while we were away (e.g. flowers already collected):
    // re-evaluate every active quest against the world as it is NOW. No hooks fire
    // here — this is a silent catch-up, not live gameplay.
    for (const id of this.order)
      if (this.state[id] && this.state[id].status === 'active') this._eval(id, null, true);
    return this;
  },

  started(id) { return !!this.state[id]; },
  status(id) { return this.state[id] ? this.state[id].status : 'unstarted'; },

  // current active step's goal (or null) — lets the dialogue layer detect "is this
  // the step where I return to NPC X?" without reaching into step internals.
  currentGoal(id) {
    const st = this.state[id], d = this.defs[id];
    if (!st || st.status !== 'active' || !d) return null;
    const step = d.steps[st.step];
    return step ? (step.goal || { type: 'manual' }) : null;
  },

  // count of collected pickups satisfying a collect goal (derived, never stored)
  collectCount(goal) {
    const got = this.ctx.collectedIds ? this.ctx.collectedIds() : new Set();
    if (goal.ids) return goal.ids.filter(i => got.has(i)).length;
    const kindOf = this.ctx.kindOf || (() => null);
    let n = 0; for (const id of got) if (!goal.kind || kindOf(id) === goal.kind) n++;
    return n;
  },
  collectTarget(goal) { return goal.ids ? goal.ids.length : (goal.count || 1); },

  start(id) {
    const d = this.defs[id];
    if (!d || this.state[id]) return false;          // unknown or already known
    this.state[id] = { status: 'active', step: 0 };
    if (this.onStart) this.onStart(d);
    this._eval(id, null);                            // first step may already be met
    return true;
  },

  // advance the current step; finishing the last step completes the quest.
  advance(id) {
    const st = this.state[id], d = this.defs[id];
    if (!st || st.status !== 'active' || !d) return false;
    st.step++;
    if (st.step >= d.steps.length) {
      st.step = d.steps.length; st.status = 'done';
      if (this.onComplete) this.onComplete(d);
    } else if (this.onAdvance) this.onAdvance(d, st.step);
    return true;
  },

  // force-complete (used by an explicit dialogue action)
  complete(id) {
    const st = this.state[id], d = this.defs[id];
    if (!d) return false;
    if (!st) this.state[id] = { status: 'active', step: 0 };
    const s = this.state[id];
    if (s.status === 'done') return false;
    s.status = 'done'; s.step = d.steps.length;
    if (this.onComplete) this.onComplete(d);
    return true;
  },

  // feed a world event; advances any active quest whose current goal it satisfies.
  // returns true if anything changed (for a journal refresh / badge).
  note(evt) {
    let changed = false;
    for (const id of this.order) {
      const st = this.state[id];
      if (st && st.status === 'active' && this._eval(id, evt)) changed = true;
    }
    return changed;
  },

  // evaluate the current step's goal against the world (+ this event); advance while
  // satisfied. `silent` suppresses onAdvance/onComplete (used by init catch-up).
  _eval(id, evt, silent) {
    const st = this.state[id], d = this.defs[id];
    let advanced = false, guard = 0;
    while (st.status === 'active' && guard++ < 64) {
      const step = d.steps[st.step];
      if (!step) break;
      if (!this._goalMet(step.goal, evt)) break;
      if (silent) {
        st.step++;
        if (st.step >= d.steps.length) { st.step = d.steps.length; st.status = 'done'; }
      } else {
        this.advance(id);
      }
      advanced = true;
      // a collect/reach goal is world-state based and can chain (e.g. two collect
      // steps already done); a talk/manual goal needs its own fresh event, so the
      // NEXT step won't auto-fire off this same `evt` unless it's also world-state.
      evt = null;
    }
    return advanced;
  },

  _goalMet(goal, evt) {
    if (!goal || goal.type === 'manual') return false;   // manual: never auto-meets
    if (goal.type === 'collect') return this.collectCount(goal) >= this.collectTarget(goal);
    if (goal.type === 'talk') return !!(evt && evt.type === 'talk' && evt.npc === goal.npc);
    if (goal.type === 'reach') {
      if (!evt || evt.type !== 'reach') return false;
      const r = goal.r || 1.2, dx = evt.x - goal.x, dz = evt.z - goal.z;
      return dx * dx + dz * dz <= r * r;
    }
    return false;
  },

  // ---- views for the journal UI ----
  list() { return this.order.filter(id => this.state[id]).map(id => this._view(id)); },

  _view(id) {
    const d = this.defs[id], st = this.state[id];
    const steps = d.steps.map((s, i) => {
      const done = st.status === 'done' || i < st.step;
      const active = st.status === 'active' && i === st.step;
      let prog = null;
      if (active && s.goal && s.goal.type === 'collect')
        prog = { have: this.collectCount(s.goal), need: this.collectTarget(s.goal) };
      return { desc: s.desc, done, active, prog };
    });
    return {
      id, name: d.name, giver: d.giver || null, summary: d.summary || '',
      status: st.status, step: st.step, total: d.steps.length, steps,
      current: st.status === 'active' ? steps[st.step] : null,
    };
  },

  // persisted blob — minimal { status, step } per known quest
  serialize() {
    const out = {};
    for (const id of this.order) {
      const st = this.state[id];
      if (st) out[id] = { status: st.status, step: st.step };
    }
    return out;
  },
};

function clampStep(v, total) {
  v = Number.isFinite(v) ? Math.floor(v) : 0;
  return Math.max(0, Math.min(total, v));
}
