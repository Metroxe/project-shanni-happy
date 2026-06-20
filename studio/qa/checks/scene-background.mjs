// CHECK: every scene / loading zone has an intentional, non-white background. GENERALIZED
// from the pet-shop session: "the background ... should never be pitch white like this."
// Each zone may pick its own colour/skybox, but none may be unset or pure white.
//
// DEFENSIVE: skips until a scene exposes window.__sceneBackgrounds(). EXPECTED PROBE:
// window.__sceneBackgrounds() -> [{scene, isWhiteOrUnset}] (the branch decides what counts
// as white/unset; []=all fine). Add it when there is more than one scene/skybox.
export const meta = {
  id: 'scene-background',
  title: 'Every scene has an intentional, non-white background',
  touches: ['studio/game.html', 'studio/specs/world.json', 'studio/js/sky.js'],
};

export async function run(page) {
  const r = await page.evaluate('window.__sceneBackgrounds ? window.__sceneBackgrounds() : null');
  if (r === null) return { fails: [], skipped: 'window.__sceneBackgrounds() not present yet' };
  const bad = r.filter(s => s.isWhiteOrUnset);
  return { fails: bad.length ? ['pitch-white/unset background: ' + bad.map(s => s.scene).join(', ')] : [] };
}
