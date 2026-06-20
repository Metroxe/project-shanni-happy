// FAST deterministic QA audit — the gate's enforcement core (the entry point the Stop
// hook and CLAUDE.md name). It is now a THIN RUNNER over an auto-discovered registry:
// it boots game.html ONCE (shared harness) and runs every check module in studio/qa/checks/.
//
//   node studio/qa_audit.mjs        # exit 0 = clean (+ stamp written), 1 = issues
//
// WHY a registry: many sessions/branches add QA over time. If every new check edited this
// one file, they'd all merge-conflict. Instead, a check is a self-contained file in
// studio/qa/checks/*.mjs exporting { meta:{id,title,touches}, run(page,ctx)->{fails:[]} }.
// Adding a check = adding a file (zero central edit, zero conflict). See studio/qa/README.md.
//
// This is the DETERMINISTIC tier (geometry / reachability / framing / boot — code that
// never forgets). The VISUAL tier (screenshots, seriously looked at by sub-agents) is
// qa_shots.mjs + the /papercraft-env-qa sweep; that is NOT a substitute — for any visual
// change, capture and actually review screenshots. On a clean pass this stamps
// .claude/.qa-stamp (the world-file hash) which clears the Stop hook.

import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withGamePage } from './qa/harness.mjs';
import { findRoot, worldHash, writeStamp } from '../.claude/hooks/qa-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));   // studio/
const ROOT = findRoot(HERE);                            // worktree root (for the stamp)
const CHECK_DIR = join(HERE, 'qa', 'checks');

// auto-discover every check module, in stable (sorted) order
const checks = [];
for (const f of readdirSync(CHECK_DIR).sort()) {
  if (!f.endsWith('.mjs')) continue;
  const mod = await import(pathToFileURL(join(CHECK_DIR, f)).href);
  if (typeof mod.run === 'function') checks.push({ file: f, meta: mod.meta || { id: f }, run: mod.run });
}

const results = await withGamePage(async (page, ctx) => {
  const out = [];
  for (const c of checks) {
    try {
      const r = await c.run(page, ctx);
      out.push({ id: c.meta.id, title: c.meta.title, fails: (r && r.fails) || [], skipped: (r && r.skipped) || null });
    } catch (e) {
      out.push({ id: c.meta.id, title: c.meta.title, fails: ['check threw: ' + (e && e.message || e)] });
    }
  }
  return out;
});

const failed = results.filter(r => r.fails.length);
for (const r of results) {
  const mark = r.fails.length ? '✗' : (r.skipped ? '⊘' : '✓');   // ⊘ = defensive check, feature not on this branch yet
  console.log(`  ${mark} ${r.id} — ${r.title}` + (r.skipped ? ` (skipped: ${r.skipped})` : '') +
    r.fails.map(f => `\n      • ${f}`).join(''));
}

if (failed.length) {
  console.error(`\n❌ QA AUDIT FAILED — ${failed.length}/${results.length} check(s) failed: ` +
    failed.map(r => r.id).join(', ') +
    `\nFix these, then re-run \`node studio/qa_audit.mjs\`. (No stamp written — the gate stays closed.)`);
  process.exit(1);
}

const stamp = writeStamp(ROOT, worldHash(ROOT), { at: new Date().toISOString(), by: 'qa_audit.mjs' });
console.log(`\n✓ QA audit clean — ${results.length} checks (${results.map(r => r.id).join(', ')}).`);
console.log(`  stamped ${stamp.hash.slice(0, 12)}… → .claude/.qa-stamp`);
