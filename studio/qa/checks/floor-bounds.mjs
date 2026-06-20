// CHECK: no floor/ground surface overruns its zone's walkable bounds. GENERALIZED from the
// pet-shop session: "the floor goes past all the seams. Don't do that! ... the floor should
// stop there." The invisible wall stops the PLAYER; the floor must also END at the wall, not
// bleed past the room/zone edge.
//
// DEFENSIVE: skips until a scene exposes window.__floorOverruns(). EXPECTED PROBE:
// window.__floorOverruns() -> [{zone|label, overrun}] (floors whose extent exceeds the zone
// bounds; []=clean). Add it when interiors/loading-zones with their own floors land.
export const meta = {
  id: 'floor-bounds',
  title: 'No floor/ground overruns its zone bounds (none visible past the wall)',
  touches: ['studio/game.html', 'studio/specs/world.json'],
};

export async function run(page) {
  const r = await page.evaluate('window.__floorOverruns ? window.__floorOverruns() : null');
  if (r === null) return { fails: [], skipped: 'window.__floorOverruns() not present yet' };
  return { fails: r.length ? ['floor overruns zone bounds: ' + r.map(x => x.zone || x.label).join(', ')] : [] };
}
