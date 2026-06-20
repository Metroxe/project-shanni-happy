// Persistence for project-shanni-happy. Owns localStorage I/O, schema
// versioning, and DEFENSIVE loading — a stale or corrupt save degrades to a
// clean start, never a broken world or a crash.
//
// Two independent safety layers (see CLAUDE.md "Save system" + the deploy skill):
//   1. SAVE_VERSION — the compatibility gate WE control, by hand, in this file.
//      It is NOT the release/build version: build.json (git sha) is a debug label
//      and NEVER decides whether a save loads. Bump SAVE_VERSION only when a change
//      genuinely breaks old saves (see migrate() for what bumping does). Most
//      updates don't need a bump — the defensive load below absorbs them.
//   2. Stable collectible ids — guard CONTENT. Progress is stored as a SET of
//      collected pickup ids, NEVER array indices, so editing world.json
//      (moving / adding / removing collectibles) can't silently mis-map progress:
//      a removed id drops out, a new id defaults to uncollected, a moved id
//      stays collected.
// Under both, sanitize() clamps & defaults every field and the whole load path
// is wrapped in try/catch. Worst case is "fresh start".
//
// NEVER renumber or reuse a collectible id once shipped — that is exactly what
// the id scheme exists to prevent. Add new ids; don't recycle old ones.

const KEY = 'shanni-happy:save';
const BACKUP_KEY = 'shanni-happy:save:backup';
// The save-compatibility version. WE bump this — not the deploy. See migrate()
// and the "Bump rule" in CLAUDE.md before changing it.
export const SAVE_VERSION = 3;   // bumped: world rebuilt as the L-shaped city (new coords/bounds/spawn would misplace old x/z)

const clampNum = (v, lo, hi, d) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const round = v => Math.round(v * 1000) / 1000;

// localStorage can throw (private mode, disabled, quota) — never let it bubble.
function store() {
  try { return window.localStorage; } catch { return null; }
}

export function hasSave() {
  const s = store(); if (!s) return false;
  try { return !!s.getItem(KEY); } catch { return false; }
}

export function wipe() {
  const s = store(); if (!s) return;
  try { s.removeItem(KEY); } catch {}
}

function backup(rawStr) {
  const s = store(); if (!s) return;
  try { s.setItem(BACKUP_KEY, rawStr); } catch {}
}

// Serialize live sim state → on-disk blob. Only durable fields; transient
// physics/animation is intentionally dropped (recomputed fresh on load).
// `extra` carries owned-elsewhere durable state (a plain object passed through):
//   extra.quests    — quest progress from the Quests engine
//   extra.collected — the GLOBAL collected-id set (array). With loading zones the
//                     live S.collectibles only holds the ACTIVE scene's pickups, so
//                     collected hamsters from another scene must come from here, not
//                     from S, or they'd be dropped the moment you change rooms.
//   extra.scene     — id of the scene the player is currently in (which world spec
//                     their x/z belong to). Absent on old saves → town (default).
export function write(S, world, build, extra) {
  const s = store(); if (!s) return;
  const collected = (extra && Array.isArray(extra.collected))
    ? extra.collected.filter(id => id != null)
    : S.collectibles.filter(c => c.got && c.id != null).map(c => c.id);
  const data = {
    v: SAVE_VERSION,
    build: build || 'dev',          // which deploy wrote this — debug only
    t: Date.now(),                  // savedAt (ms); informational
    scene: (extra && typeof extra.scene === 'string') ? extra.scene : undefined,
    player: { x: round(S.x), z: round(S.z), facing: S.facing === -1 ? -1 : 1 },
    collected,
    quests: (extra && extra.quests && typeof extra.quests === 'object') ? extra.quests : {},
    npcs: {},                       // reserved: future conversation state
  };
  try { s.setItem(KEY, JSON.stringify(data)); } catch {}
}

// Load + sanitize → { player:{x,z,facing}, collected:Set<id>, quests, scene } or
// null. `scenes` is a map { sceneId: spec } of ALL known scenes (so we can clamp
// the player to the bounds of the scene they were saved in, and validate collected
// ids against the union of every scene's pickups). A plain single world spec is
// also accepted (back-compat) and treated as the only scene.
export function load(scenes) {
  const s = store(); if (!s) return null;
  let rawStr;
  try { rawStr = s.getItem(KEY); } catch { return null; }
  if (!rawStr) return null;

  let raw;
  try { raw = JSON.parse(rawStr); } catch { backup(rawStr); wipe(); return null; }
  if (!raw || typeof raw !== 'object' || typeof raw.v !== 'number') {
    backup(rawStr); wipe(); return null;
  }

  // Save from a NEWER build than this code (e.g. a reverted deploy): we can't
  // know its shape, so don't risk misreading it. Keep it backed up but ignore
  // it — NOT wiped, so rolling the deploy forward again recovers it.
  if (raw.v > SAVE_VERSION) { backup(rawStr); return null; }

  // Older format: try to walk it up to the current version. If no migration
  // brings it all the way to SAVE_VERSION, the bump was a DELIBERATE break — we
  // own that decision (see migrate / CLAUDE.md), so discard and start fresh.
  if (raw.v < SAVE_VERSION) {
    raw = migrate(raw);
    if (!raw || raw.v !== SAVE_VERSION) { backup(rawStr); wipe(); return null; }
  }

  try { return sanitize(raw, normScenes(scenes)); }
  catch { backup(rawStr); wipe(); return null; }
}

// Normalize the `scenes` arg into a { id: spec } map. Accepts either an actual
// map, or a single world spec (back-compat) → wrapped as { town: spec }.
function normScenes(scenes) {
  if (scenes && typeof scenes === 'object' && (scenes.bounds || scenes.collectibles || scenes.spawn)) {
    return { town: scenes };               // looks like a single world spec
  }
  return (scenes && typeof scenes === 'object') ? scenes : {};
}

// Step an older-schema blob UP to the current version. Return the upgraded blob
// with raw.v === SAVE_VERSION to LOAD it, or leave raw.v short to DISCARD it.
//
//   Bump SAVE_VERSION with NO step here  → old saves are discarded (clean reset).
//   Bump SAVE_VERSION + a step that advances raw.v → old progress is preserved.
//
// Steps chain, so a v1 save walks 1→2→3 up to whatever SAVE_VERSION is now:
//   if (raw.v === 1) { raw.newField = remap(raw.oldField); raw.v = 2; }
//   if (raw.v === 2) { /* 2 → 3 … */                        raw.v = 3; }
function migrate(raw) {
  return raw;
}

// Trust nothing: resolve which scene the save belongs to (default = first known
// scene / town), clamp the player to THAT scene's bounds, intersect collected ids
// with the union of every scene's pickups, default everything missing.
function sanitize(raw, scenes) {
  const ids = Object.keys(scenes);
  const def = ids[0] || 'town';
  const scene = (typeof raw.scene === 'string' && scenes[raw.scene]) ? raw.scene : def;
  const spec = scenes[scene] || {};
  const b = spec.bounds || { xmin: -12, xmax: 12, zmin: -12, zmax: 6 };
  const sp = spec.spawn || {};
  const p = raw.player || {};
  const player = {
    x: clampNum(p.x, b.xmin, b.xmax, Number.isFinite(sp.x) ? sp.x : 0),
    z: clampNum(p.z, b.zmin, b.zmax, Number.isFinite(sp.z) ? sp.z : 2),
    facing: p.facing === -1 ? -1 : 1,
  };
  // valid ids = union across ALL scenes, so a hamster collected in town stays
  // collected even while the save was written from inside the pet shop.
  const valid = new Set();
  for (const id of ids) for (const c of (scenes[id].collectibles || []))
    if (c.id != null) valid.add(c.id);
  const collected = new Set(
    (Array.isArray(raw.collected) ? raw.collected : []).filter(id => valid.has(id)));
  // quest progress is owned by the Quests engine; pass the blob through (it
  // validates/clamps per-quest on its own init). Missing → empty (fresh quests).
  const quests = (raw.quests && typeof raw.quests === 'object' && !Array.isArray(raw.quests)) ? raw.quests : {};
  return { player, collected, quests, scene };
}

// Apply a sanitized save onto a fresh sim state (mutates S). The collected-id
// set is the single source of truth; quest progress is re-derived from it.
export function apply(S, saved) {
  if (!saved) return S;
  S.x = saved.player.x; S.z = saved.player.z; S.facing = saved.player.facing;
  for (const c of S.collectibles) c.got = saved.collected.has(c.id);
  return S;
}
