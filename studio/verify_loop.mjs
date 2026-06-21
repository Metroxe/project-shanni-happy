// Verify a committed music loop is SEAMLESS *as the browser decodes it* (the only
// decode that matters — see CLAUDE.md "music MUST loop seamlessly"). make_loop.py
// guarantees the WAV wrap is gapless by construction, but the OGG/Vorbis + resample
// path is decoder-dependent: a brighter/busier clip can re-introduce an audible seam
// at the loop point even though the source was clean. So we decode the actual .ogg in
// a real browser AudioContext (via the shared QA harness) and prove the wrap is small.
//
// Metric (per CLAUDE.md): decode → channel samples x[0..N-1]. The loop wraps x[N-1]→x[0],
// so the discontinuity is |x[0]-x[N-1]|. Compare it to the clip's OWN distribution of
// adjacent-sample deltas |x[i+1]-x[i]| (p99.9). A seamless loop's wrap sits WELL UNDER
// that p99.9 (ratio ≪ 1); a real seam pokes above it (shop seed 2 was 1.78×, seed 0 0.01×).
//
//   node studio/verify_loop.mjs out/music/gym.ogg [out/music/shop.ogg ...]
//
// Exit 0 if every clip's wrap/p999 ratio is under THRESH, else 1. With several inputs it
// also prints the ranking so you can pick the cleanest-looping seed.
import { withGamePage } from './qa/harness.mjs';

const THRESH = 0.5;            // wrap must be < half the p99.9 adjacent delta to call it clean
const paths = process.argv.slice(2);
if (!paths.length) { console.error('usage: node studio/verify_loop.mjs <a.ogg> [b.ogg ...]'); process.exit(2); }

const rows = await withGamePage(async (page) => {
  return await page.evaluate(async (urls) => {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const out = [];
    for (const u of urls) {
      try {
        const buf = await (await fetch('/' + u.replace(/^\/+/, ''), { cache: 'no-store' })).arrayBuffer();
        const audio = await ac.decodeAudioData(buf);
        const x = audio.getChannelData(0);     // mono loop
        const N = x.length;
        let maxd = 0, sum = 0; const deltas = new Float64Array(N - 1);
        for (let i = 0; i < N - 1; i++) { const d = Math.abs(x[i + 1] - x[i]); deltas[i] = d; if (d > maxd) maxd = d; sum += d; }
        deltas.sort();
        const p = q => deltas[Math.min(deltas.length - 1, Math.floor(q * deltas.length))];
        const p999 = p(0.999), p99 = p(0.99);
        const wrap = Math.abs(x[0] - x[N - 1]);
        out.push({ url: u, N, dur: +(N / audio.sampleRate).toFixed(2), sr: audio.sampleRate,
                   wrap: +wrap.toExponential(3), p99: +p99.toExponential(3), p999: +p999.toExponential(3),
                   maxDelta: +maxd.toExponential(3), meanDelta: +(sum / (N - 1)).toExponential(3),
                   ratio: +(wrap / (p999 || 1e-12)).toFixed(3) });
      } catch (e) { out.push({ url: u, error: String(e && e.message || e) }); }
    }
    return out;
  }, paths);
}, { start: false, launchArgs: ['--autoplay-policy=no-user-gesture-required'] });

let fail = false;
const ok = rows.filter(r => !r.error).sort((a, b) => a.ratio - b.ratio);
for (const r of rows) {
  if (r.error) { console.log(`✗ ${r.url}  DECODE ERROR: ${r.error}`); fail = true; continue; }
  const pass = r.ratio < THRESH;
  if (!pass) fail = true;
  console.log(`${pass ? '✓' : '✗'} ${r.url}  dur=${r.dur}s  wrap=${r.wrap}  p99.9=${r.p999}  ` +
              `wrap/p999=${r.ratio}×  (max adj Δ=${r.maxDelta})  ${pass ? 'seamless' : 'SEAM @ loop point'}`);
}
if (ok.length > 1) {
  console.log('\nranking (cleanest loop first): ' + ok.map(r => `${r.url.split('/').pop()}=${r.ratio}×`).join('  '));
}
console.log(fail ? '\n❌ loop seam check FAILED' : '\n✓ all loops seamless (wrap well under the clip\'s own p99.9 adjacent delta)');
process.exit(fail ? 1 : 0);
