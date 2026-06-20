// CHECK: world geometry is sound — no overlapping building/stair footprints (z-fight +
// clipping) and no landmark walled off by a stray collider. This is the canonical
// "overlapping polygons in general" guard: it runs on EVERY change, not against one
// example. Add new geometry invariants here (or a sibling file in this dir).
export const meta = {
  id: 'geometry',
  title: 'No footprint overlaps; every landmark reachable',
  touches: ['studio/game.html', 'studio/specs/world.json', 'studio/js/sim.js'],
};

// must-reach landmarks (zone centres + key waypoints). Extend when you add an area.
const LANDMARKS = [
  { name:'plaza', x:-20, z:-44 }, { name:'vroad', x:-20, z:-20 }, { name:'corner', x:-19, z:-3 },
  { name:'hroad', x:9, z:-3 }, { name:'hroadE', x:26, z:-3 }, { name:'stairsBot', x:9.5, z:11 },
  { name:'park', x:0, z:16 }, { name:'parkW', x:-26, z:15 }, { name:'parkE', x:26, z:15 },
];

export async function run(page) {
  const fails = [];
  const overlaps = await page.evaluate('window.__overlaps()');
  if (overlaps.length) fails.push('footprint OVERLAPS (z-fight/clip): ' +
    overlaps.map(o => `${o.a}×${o.b}(${o.overlapX}×${o.overlapZ})`).join(', '));

  const reach = await page.evaluate(`window.cameraQA.reach(${JSON.stringify(LANDMARKS)}, 0.5)`);
  if (reach.unreachable.length) fails.push('UNREACHABLE (a collider walls a route): ' +
    reach.unreachable.map(t => t.name).join(', '));
  return { fails };
}
