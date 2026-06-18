// Dialogue system for project-shanni-happy.
// Data-driven branching dialogue with a bottom box, typewriter reveal, an
// advance-on-button flow, and selectable choice options. UI-only: it owns its
// own DOM and never touches the physics sim. game.html gates movement while a
// conversation is active by checking Dialogue.active.
//
// Dialogue data (per NPC in world.json):
//   dialogue: {
//     start: "g1",
//     nodes: {
//       "g1": { text, speaker?, next?, choices? },
//       ...
//     }
//   }
// A node shows `text` (speaker defaults to the NPC name). When the line is fully
// revealed: if it has `choices` [{label,next}], a menu appears; else `next`
// jumps to that node id; else the conversation ends.

const REVEAL_CPS = 48; // characters per second

export const Dialogue = {
  active: false,
  npc: null,
  nodes: null,
  cur: null,
  full: '',
  shown: 0,
  done: false,
  choiceMode: false,
  sel: 0,
  _spoken: 0,
  // optional hooks (game.html wires these to the audio layer; all UI-only)
  onEnd: null,        // (npc)            conversation ended
  onLine: null,       // (speaker)        a new line began (reset voice pitch)
  onReveal: null,     // (ch, speaker)    a glyph was typed by the typewriter
  onChoiceOpen: null, // ()               a choice menu appeared
  onChoiceMove: null, // ()               selection moved
  onChoicePick: null, // ()               a choice was confirmed
  onAction: null,     // (action, node)   a node with an `action` was reached

  init() {
    this.el = {
      box: document.getElementById('dlg'),
      name: document.getElementById('dlgName'),
      text: document.getElementById('dlgText'),
      choices: document.getElementById('dlgChoices'),
      next: document.getElementById('dlgNext'),
    };
  },

  // startId optionally overrides the tree's default entry node — game.html uses it
  // to pick a state-aware greeting (e.g. quest offer vs. "thanks for the help!").
  start(npc, startId) {
    this.active = true;
    this.npc = npc;
    this.nodes = npc.dialogue.nodes;
    this.el.box.classList.add('on');
    this._goto(startId != null ? startId : npc.dialogue.start);
  },

  _goto(id) {
    const node = id != null ? this.nodes[id] : null;
    if (!node) return this.end();
    this.cur = node;
    // a node may carry a side-effect (e.g. "start:q_hamsters") — fire it as the
    // node is reached, before the line types out. UI-agnostic: game.html acts on it.
    if (node.action && this.onAction) this.onAction(node.action, node);
    this.full = node.text || '';
    this.shown = 0;
    this._spoken = 0;
    this.done = false;
    this.choiceMode = false;
    this.sel = 0;
    this.speaker = node.speaker || this.npc.name;
    if (this.onLine) this.onLine(this.speaker);
    this.el.name.textContent = node.speaker || this.npc.name;
    this.el.name.classList.toggle('player', !!node.speaker && node.speaker !== this.npc.name);
    this.el.choices.innerHTML = '';
    this.el.choices.style.display = 'none';
    this.el.next.style.visibility = 'hidden';
    this._renderText();
  },

  _renderText() {
    this.el.text.textContent = this.full.slice(0, Math.floor(this.shown));
  },

  // typewriter; called each frame with the frame dt (seconds)
  tick(dt) {
    if (!this.active || this.done) return;
    this.shown += REVEAL_CPS * dt;
    if (this.shown >= this.full.length) {
      this.shown = this.full.length;
      this.done = true;
      if (this.cur.choices) this._openChoices();
      else this.el.next.style.visibility = 'visible';
    }
    this._speak();
    this._renderText();
  },

  // fire onReveal for each glyph the typewriter has newly uncovered
  _speak() {
    if (!this.onReveal) { this._spoken = Math.floor(this.shown); return; }
    const upto = Math.floor(this.shown);
    while (this._spoken < upto) {
      this.onReveal(this.full[this._spoken], this.speaker);
      this._spoken++;
    }
  },

  _openChoices() {
    this.choiceMode = true;
    this.sel = 0;
    if (this.onChoiceOpen) this.onChoiceOpen();
    const box = this.el.choices;
    box.innerHTML = '';
    box.style.display = 'flex';
    this.cur.choices.forEach((c, i) => {
      const b = document.createElement('div');
      b.className = 'dlgChoice';
      b.textContent = c.label;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.sel = i; this._confirm(); });
      box.appendChild(b);
    });
    this._highlight();
  },

  _highlight() {
    [...this.el.choices.children].forEach((c, i) =>
      c.classList.toggle('sel', i === this.sel));
  },

  move(dir) {
    if (!this.active || !this.choiceMode) return;
    const n = this.cur.choices.length;
    this.sel = (this.sel + dir + n) % n;
    if (this.onChoiceMove) this.onChoiceMove();
    this._highlight();
  },

  // advance / confirm — the single "next" action
  advance() {
    if (!this.active) return;
    if (this.choiceMode) return this._confirm();
    if (!this.done) {              // skip the typewriter to the end
      this.shown = this.full.length;
      this._spoken = this.full.length; // don't machine-gun blips on skip
      this.done = true;
      this._renderText();
      if (this.cur.choices) this._openChoices();
      else this.el.next.style.visibility = 'visible';
      return;
    }
    if (this.cur.next != null) return this._goto(this.cur.next);
    this.end();
  },

  _confirm() {
    if (this.onChoicePick) this.onChoicePick();
    const c = this.cur.choices[this.sel];
    this._goto(c ? c.next : null);
  },

  end() {
    this.active = false;
    this.choiceMode = false;
    this.el.box.classList.remove('on');
    const npc = this.npc;
    this.npc = null;
    if (this.onEnd) this.onEnd(npc);
  },
};
