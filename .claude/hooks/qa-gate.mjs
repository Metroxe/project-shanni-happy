#!/usr/bin/env node
// Stop hook — the hard half of the "QA before done" gate (the reflex in CLAUDE.md is
// the soft half). It refuses to let a turn end while there are PENDING, UN-QA'd changes
// to the world (game.html / world.json / studio/js). It is INSTANT: it never launches a
// browser — it only checks git (are world files dirty?) and the stamp (did the exact
// current content pass `node studio/qa_audit.mjs`?). The audit writes the stamp; this
// hook reads it. So the loop is: edit → stamp stale → this blocks → you run the audit →
// it passes & stamps → this lets you stop.
//
// It FAILS OPEN: any internal error (no git, no node deps, bad stdin) exits 0 so a broken
// gate can never wedge a session. The only deliberate non-zero is exit 2 = block.

import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, worldFiles, worldHash, readStamp } from './qa-lib.mjs';

const ok = () => process.exit(0);

try {
  // --- read the stdin payload (JSON) ---------------------------------------
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { /* tolerate empty/garbage */ }

  // Already blocked once this stop-sequence → don't loop. The reflex + my own
  // follow-through carry it from here. (Documented Stop-hook anti-loop guard.)
  if (payload.stop_hook_active === true) ok();

  const root = findRoot(payload.cwd || dirname(fileURLToPath(import.meta.url)));

  // --- are any WORLD files dirty vs HEAD? (modified, staged, or untracked) --
  const paths = ['studio/game.html', 'studio/specs/world.json', 'studio/js'];
  let dirty = '';
  try {
    dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', ...paths],
      { encoding: 'utf8' }).trim();
  } catch { ok(); }                 // not a git repo / git missing → nothing to enforce
  if (!dirty) ok();                 // world matches HEAD → already shipped/validated upstream

  // --- has the EXACT current content passed the audit? ---------------------
  const stamp = readStamp(root);
  const cur = worldHash(root);
  if (stamp && stamp.hash === cur) ok();   // fresh stamp covers current content → let it end

  // --- pending, un-QA'd world changes → BLOCK ------------------------------
  const files = worldFiles(root).map(f => f.slice(root.length + 1));
  const why = stamp ? 'changed since the last QA pass' : 'never been QA-audited';
  process.stderr.write(
`QA GATE: you have pending world changes that have ${why}, so this turn can't end yet.

Dirty world files:
${dirty.split('\n').map(l => '  ' + l).join('\n')}

Before finishing, run the fast deterministic audit (boots game.html headless; ~seconds):

  node studio/qa_audit.mjs

It checks overlaps / reachability / framing / visibility and, on a clean pass, stamps
the current content so this gate clears. If it FAILS, fix the reported issues and re-run.

If this change touched buildings/props/terrain/geometry, ALSO run the heavy pass before
deploy: \`node studio/qa_shots.mjs\` + the multi-agent visual sweep
(.claude/skills/papercraft-env-qa). (World files watched: ${files.join(', ')}.)
`);
  process.exit(2);
} catch (e) {
  // Never wedge the session on a hook bug.
  process.stderr.write('qa-gate hook: ignoring internal error — ' + (e && e.message || e) + '\n');
  process.exit(0);
}
