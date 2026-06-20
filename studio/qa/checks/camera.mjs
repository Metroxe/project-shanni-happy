// CHECK: the camera obeys the framing law from every reachable cell — Shen is visible
// (never hidden/off-screen/under the camera) AND never too small / top-down. Mirrors the
// 0-failure gates in /zone-camera, run deterministically (no screenshot) on a coarse grid
// to stay fast. The screenshot side of camera QA lives in the visual sweep.
export const meta = {
  id: 'camera',
  title: 'Shen visible + well-framed (not tiny, not top-down) everywhere',
  touches: ['studio/game.html', 'studio/specs/world.json'],
};

export async function run(page) {
  const fails = [];
  const framing = await page.evaluate('window.cameraQA.framing(0.7)');
  if (framing.fails) fails.push(`FRAMING fails=${framing.fails} (minSize=${framing.minSize}, ` +
    `maxPitch=${framing.maxPitch}°) byReason=${JSON.stringify(framing.byReason)} byZone=${JSON.stringify(framing.byZone)}`);

  const vis = await page.evaluate('window.cameraQA.static(0.7)');
  if (vis.fails) fails.push(`VISIBILITY fails=${vis.fails} byReason=${JSON.stringify(vis.byReason)} (Shen hidden/off-screen somewhere)`);
  return { fails };
}
