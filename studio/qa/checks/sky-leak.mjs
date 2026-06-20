// CHECK: the world is ringed by a continuous, tall backdrop — no outward sightline from a
// play-edge hits sky/void. GENERALIZED from the visual sweep's "SKY-GAP / over-rooftop abyss"
// finding (the inner backdrop ring topped at only 24 and the 2nd ring was gapped+short at
// 10-19, so blue sky leaked BETWEEN its blocks just above the first ring — a real measured
// leak, RGB ~145,173,215, at park-S). The class is the CLAUDE.md cardinal rule "never the
// abyss: no reachable spot may see off the edge of the world."
//
// From 8 perimeter points (4 edge-mids + 4 corners) it marches OUTWARD — the direction a
// player standing at that edge faces toward the boundary — and requires a backdrop/filler
// block within `maxDist` whose top is >= `minTop`. A gap (no backstop) or a too-short backstop
// is a leak. This mirrors what a player NEAR each edge actually sees (the cross-map flat
// freecam angle is handled by fog at distance, not in scope here). Geometric + cheap.
//
// EXPECTED PROBE: window.__skyLeak() -> { leaks:[{dir,why,nearestAt,maxTop}], probes:[...] }
// (leaks empty = continuous tall ring). Defensive: skips until the probe exists.
export const meta = {
  id: 'sky-leak',
  title: 'World ringed by a tall continuous backdrop (no off-edge sky/void)',
  touches: ['studio/game.html', 'studio/specs/world.json'],
};

export async function run(page) {
  const r = await page.evaluate('window.__skyLeak ? window.__skyLeak() : null');
  if (r === null) return { fails: [], skipped: 'window.__skyLeak() not present yet' };
  const leaks = r.leaks || [];
  if (!leaks.length) return { fails: [] };
  return { fails: leaks.map(l =>
    `SKY-LEAK ${l.dir}: ${l.why} (nearestBackstop=${l.nearestAt ?? 'none'}u, top=${l.maxTop ?? 'none'}, ` +
    `need <=${r.maxDist}u & >=${r.minTop} tall)`) };
}
