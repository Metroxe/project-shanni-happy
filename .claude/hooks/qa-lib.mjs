// Shared helpers for the QA gate. Imported by BOTH the deterministic audit
// (studio/qa_audit.mjs) and the Stop hook (.claude/hooks/qa-gate.mjs) so the two
// agree, byte-for-byte, on (a) which files count as "the world" and (b) how their
// content is hashed. If these ever drifted the hook could block forever (audit
// writes hash A, hook recomputes hash B, never matches) — so they live here, once.
//
// The stamp (.claude/.qa-stamp, git-ignored) records the world-file hash that last
// PASSED the deterministic audit. The hook compares the current world hash to the
// stamp: equal ⇒ the exact current content already passed ⇒ let the turn end.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The set of files whose content can change what the deterministic audit sees:
// the renderer (game.html), the world data (world.json), and every gameplay/render
// module under js/ (a sim/collision change moves colliders; a boot error in any of
// them fails smoke). A change to ANY of these invalidates a prior QA pass.
export function worldFiles(root) {
  const out = [];
  const push = p => { if (existsSync(p) && statSync(p).isFile()) out.push(p); };
  push(join(root, 'studio', 'game.html'));
  push(join(root, 'studio', 'specs', 'world.json'));
  const jsDir = join(root, 'studio', 'js');
  if (existsSync(jsDir)) {
    for (const f of readdirSync(jsDir).sort())
      if (f.endsWith('.js')) push(join(jsDir, f));
  }
  return out.sort();
}

// sha256 over `relpath\0content` for each world file, in sorted order. Path is
// included so a rename is also a change. Returns a hex digest (or 'none' if the
// world somehow has no files — fail-open, the hook treats that as "nothing to gate").
export function worldHash(root) {
  const files = worldFiles(root);
  if (!files.length) return 'none';
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f.slice(root.length));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex');
}

export function stampPath(root) { return join(root, '.claude', '.qa-stamp'); }

export function readStamp(root) {
  try { return JSON.parse(readFileSync(stampPath(root), 'utf8')); }
  catch { return null; }
}

// Called by the audit ONLY on a fully-clean pass. `at` is passed in (the scripts
// have a clock; this module deliberately doesn't reach for one).
export function writeStamp(root, hash, extra = {}) {
  const blob = { hash, ...extra };
  writeFileSync(stampPath(root), JSON.stringify(blob, null, 2));
  return blob;
}

// Walk up from a starting dir to the repo/worktree root (the dir that has studio/).
export function findRoot(start) {
  let d = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, 'studio', 'game.html'))) return d;
    const up = resolve(d, '..');
    if (up === d) break;
    d = up;
  }
  return resolve(start);
}
