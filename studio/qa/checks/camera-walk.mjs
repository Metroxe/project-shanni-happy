// CHECK: the camera must keep the player ON-SCREEN through a CONTINUOUS walk across zone
// boundaries — not just at static warp cells. The per-cell static()/framing() checks warp to
// each cell (keyframes) and so miss DYNAMIC follow bugs that only happen mid-walk: a zone-
// transition blend that froze the camera eye (it interpolated the eye from a frozen snapshot
// while the look-target tracked live, and re-triggered on boundary churn) left the player to
// walk off-screen → a BLANK screen on the plaza→pet-shop road (Christopher reported it).
//   This drives cameraQA.path (real step()+cameraFrame each frame, sampling shenVisible every
// frame, and self-restoring to spawn) across the routes that cross zone boundaries, and fails
// if the player is ever off-screen during the walk. Generalises the rule: a route the player
// can walk must keep them framed the WHOLE way, both directions.
export const meta = {
  id: 'camera-walk',
  title: 'Camera follows the player through zone transitions (never off-screen mid-walk)',
  touches: ['studio/game.html', 'studio/specs/world.json'],
};

export async function run(page) {
  const fails = [];
  if (await page.evaluate('typeof window.cameraQA?.path') !== 'function') {
    fails.push('cameraQA.path missing — cannot run the continuous-walk camera check');
    return { fails };
  }
  // Zone-crossing routes in town. Each is walked BOTH ways (a one-way sweep misses the reverse
  // blend). plaza↔pet-shop is the route that went blank; add the other long crossings as guards.
  const routes = [
    { name: 'plaza→petshop',  wps: [[-20, -41], [-15.8, -20]] },
    { name: 'petshop→plaza',  wps: [[-15.8, -20], [-20, -41]] },
    { name: 'plaza→park',     wps: [[-20, -41], [0, 14]] },
    { name: 'park→plaza',     wps: [[0, 14], [-20, -41]] },
  ];
  for (const r of routes) {
    const res = await page.evaluate(`window.cameraQA.path(${JSON.stringify(r.wps)})`);
    if (res && res.fails > 0)
      fails.push(`${r.name}: Shen off-screen in ${res.fails} frames of the continuous walk (` +
        JSON.stringify(res.byOcc) + ') — the camera did not follow through a zone transition');
  }
  return { fails };
}
