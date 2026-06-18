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
//      collected flower ids, NEVER array indices, so editing world.json
//      (moving / adding / removing flowers) can't silently mis-map progress:
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
export const SAVE_VERSION = 2;   // bumped: scene replaced with the elevated zone-camera city (old x/z would misplace)

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
export function write(S, world, build) {
  const s = store(); if (!s) return;
  const data = {
    v: SAVE_VERSION,
    build: build || 'dev',          // which deploy wrote this — debug only
    t: Date.now(),                  // savedAt (ms); informational
    player: { x: round(S.x), z: round(S.z), facing: S.facing === -1 ? -1 : 1 },
    collected: S.collectibles.filter(c => c.got && c.id != null).map(c => c.id),
    npcs: {},                       // reserved: future conversation state
  };
  try { s.setItem(KEY, JSON.stringify(data)); } catch {}
}

// Load + sanitize → { player:{x,z,facing}, collected:Set<id> } or null.
export function load(world) {
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

  try { return sanitize(raw, world); }
  catch { backup(rawStr); wipe(); return null; }
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

// Trust nothing: clamp to current world bounds, intersect ids with the world
// that exists NOW, default everything missing.
function sanitize(raw, world) {
  const b = (world && world.bounds) || { xmin: -12, xmax: 12, zmin: -12, zmax: 6 };
  const p = raw.player || {};
  const player = {
    x: clampNum(p.x, b.xmin, b.xmax, 0),
    z: clampNum(p.z, b.zmin, b.zmax, 2),
    facing: p.facing === -1 ? -1 : 1,
  };
  const valid = new Set((world.collectibles || []).map(c => c.id).filter(id => id != null));
  const collected = new Set(
    (Array.isArray(raw.collected) ? raw.collected : []).filter(id => valid.has(id)));
  return { player, collected };
}

// Apply a sanitized save onto a fresh sim state (mutates S). Score is RECOMPUTED
// from the merged set — the collected-id set is the single source of truth.
export function apply(S, saved) {
  if (!saved) return S;
  S.x = saved.player.x; S.z = saved.player.z; S.facing = saved.player.facing;
  for (const c of S.collectibles) c.got = saved.collected.has(c.id);
  S.score = S.collectibles.filter(c => c.got).length;
  return S;
}
