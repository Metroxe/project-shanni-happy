// CHECK: no interior surface/prop overlaps or z-fights another. GENERALIZED from two
// defects Christopher flagged in the pet-shop session: "the door, when you're inside, has
// the wall texture over top of it" and "the fish tank overlaps with the shelf". The
// town-level __overlaps() only audits building/stair FOOTPRINTS; interiors need their own.
//
// DEFENSIVE: skips until the loading-zones/pet-shop branch exposes window.__interiorOverlaps()
// — so it's inert (green) on a branch with no interiors, and activates automatically once
// they land. EXPECTED PROBE: window.__interiorOverlaps() -> [{a, b}] (labels of overlapping
// interior pieces; []=clean). Add it next to __overlaps in game.html when interiors exist.
export const meta = {
  id: 'interior-overlap',
  title: 'No interior wall/door/prop overlap or z-fight',
  touches: ['studio/game.html', 'studio/specs/world.json'],
};

export async function run(page) {
  const r = await page.evaluate('window.__interiorOverlaps ? window.__interiorOverlaps() : null');
  if (r === null) return { fails: [], skipped: 'window.__interiorOverlaps() not present yet' };
  return { fails: r.length ? ['interior overlap/z-fight: ' + r.map(o => `${o.a}×${o.b}`).join(', ')] : [] };
}
