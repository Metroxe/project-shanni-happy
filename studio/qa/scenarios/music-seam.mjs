// VERIFY a music loop is GAPLESS in the BROWSER (the real decode path), per CLAUDE.md:
// "decode the OGG in an OfflineAudioContext and check the wrap discontinuity |x[0]-x[N-1]|
// sits within the clip's own adjacent-sample-delta distribution (well under its max)." The
// vorbis+resample wrap is decoder-dependent, so we pick the candidate with the LOWEST
// browser wrap/p99.9 ratio — NOT just make_loop's "calmest" score.
//
//   node studio/qa/scenarios/music-seam.mjs out/music/cand/night-s0.ogg out/music/cand/night-s1.ogg …
// Prints a wrap/p999 ratio per file (lower = cleaner). A ratio ≲ 1 is a gapless loop.
import { withGamePage } from '../harness.mjs';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: music-seam.mjs <ogg> [<ogg> …] (paths relative to studio/)'); process.exit(2); }

const results = await withGamePage(async (page, ctx) => {
  const out = [];
  for (const f of files) {
    const r = await page.evaluate(async (url) => {
      try {
        const buf = await (await fetch('/' + url.replace(/^\/+/, ''))).arrayBuffer();
        const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const off = new AC(1, 1024, 44100);
        const audio = await off.decodeAudioData(buf);
        const d = audio.getChannelData(0), N = d.length;
        const wrap = Math.abs(d[0] - d[N - 1]);
        const deltas = new Float64Array(N - 1);
        for (let i = 0; i < N - 1; i++) deltas[i] = Math.abs(d[i + 1] - d[i]);
        deltas.sort();
        const q = p => deltas[Math.min(N - 2, Math.floor(p * (N - 1)))];
        const p999 = q(0.999), max = deltas[N - 2] || 1e-9;
        return { url, ok: true, secs: +(N / audio.sampleRate).toFixed(1), wrap, p999, max,
                 ratio999: +(wrap / (p999 || 1e-9)).toFixed(3), ratioMax: +(wrap / max).toFixed(3) };
      } catch (e) { return { url, ok: false, err: String(e && e.message || e) }; }
    }, f);
    out.push(r);
  }
  if (ctx.pageErrors.length) out.push({ pageErrors: ctx.pageErrors });
  return out;
}, { start: false });

let best = null;
for (const r of results) {
  if (r.pageErrors) { console.log('page errors:', r.pageErrors.join(' | ')); continue; }
  if (!r.ok) { console.log(`✗ ${r.url} — decode failed: ${r.err}`); continue; }
  const verdict = r.ratio999 <= 1.2 ? '✓ gapless' : (r.ratio999 <= 2 ? '~ marginal' : '✗ audible seam');
  console.log(`${verdict}  ${r.url}  ${r.secs}s  wrap/p999=${r.ratio999}  wrap/max=${r.ratioMax}`);
  if (best === null || r.ratio999 < best.ratio999) best = r;
}
if (best) console.log(`\n→ cleanest loop: ${best.url}  (wrap/p999=${best.ratio999})`);
