// CHECK: the definitive "never the abyss" guard — from EVERY reachable cell, the real zone
// camera's gameplay frame must show city/ground, never sky/void. GENERALIZED from the visual
// sweep repeatedly (mis)reading the open park/plaza as "abyss": __skyLeak's edge-cast couldn't
// settle it because it casts outward from the edges, but a CENTER camera looking in a gap-prone
// direction (e.g. park-center) is what the sweep reacted to. This casts a grid of rays through
// the ACTUAL zone camera at each reachable cell; any ray hitting nothing below `ceiling` (ndc.y)
// is a reachable view looking off the edge. The downward cameras here are clean to ndc.y 0.9
// (no sky in frame at all), so this has comfortable margin and would fire loudly if a backdrop
// ring were removed/shortened enough to flood sky into frame.
//
// EXPECTED PROBE: window.__camAbyss({ceiling,step}) -> { leakCount, leaks:[{x,z,lowestVoidY}], worst }
// Defensive: skips until the probe exists.
export const meta = {
  id: 'camera-abyss',
  title: 'No reachable zone-camera view sees sky/void off the world edge',
  touches: ['studio/game.html', 'studio/specs/world.json'],
};

export async function run(page) {
  const r = await page.evaluate('window.__camAbyss ? window.__camAbyss({ceiling:0.55, step:4}) : null');
  if (r === null) return { fails: [], skipped: 'window.__camAbyss() not present yet' };
  if (!r.leakCount) return { fails: [] };
  const w = r.worst;
  return { fails: [`${r.leakCount}/${r.cells} reachable cells see void in-frame ` +
    `(worst at ${w.x},${w.z} ndc.y=${w.lowestVoidY}; ceiling ${r.ceiling}). Backdrop ring too short/gapped on some heading.`] };
}
