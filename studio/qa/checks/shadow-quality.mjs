// CHECK: the sun's CAST shadow stays SOFT + CLEAN, and one object never has two shadows.
// GENERALIZED from the shadow reports: (1) "always very blurry edges" → too low texel density
// (muddy); (2) "very sharp" then "feels jagged/fuzzy ... want an accurate bleed like real life" →
// must be PCSS (contact-hardening soft shadows: crisp at contact, softening with distance), not
// fuzzy PCF or bleed-y VSM; (3) "weird double shadows on this tree" → a 3D prop that casts a REAL
// shadow must NOT also get a contact-shadow oval. So at the top ('high') quality the cast shadow
// must be SOFT-via-PCSS, CLEAN (healthy texels-per-unit, well above the old muddy ~17), and the
// graphics knobs must stay wired. (The double-shadow geometry —
// no oval under a real-caster — is a visual-sweep item; this guards the renderer config.)
//
// EXPECTED PROBE: window.__shadowInfo() -> {enabled,castShadow,pcss,mapSize,frustumHalf,
// texelsPerUnit,level,gfx}. Boots at the default (fresh ctx → Gfx defaults 'high').
export const meta = {
  id: 'shadow-quality',
  title: 'Sun cast-shadow is soft via PCSS + clean (healthy density); graphics knobs wired',
  touches: ['studio/game.html', 'studio/js/sky.js'],
};

// 'high' = 4096 over the town's ~±53 fixed frustum ≈ 38 texels/unit; floor sits above the old
// muddy ~17 but below 38 so a regression toward muddy trips it. VSM blur softens it on top.
const MIN_TEXELS_PER_UNIT = 28;

export async function run(page) {
  if (await page.evaluate('typeof window.__shadowInfo !== "function"'))
    return { fails: [], skipped: 'window.__shadowInfo() not present yet' };
  // force the top quality (the headless viewport might default to the mobile 'low' tier) so we
  // assert the FULL bar, not a skipped one.
  await page.evaluate('window.__gfx && window.__gfx("shadows","high")');
  const s = await page.evaluate('window.__shadowInfo()');
  const fails = [];
  if (!s.enabled) fails.push('renderer.shadowMap disabled — no cast shadows at all');
  // PCSS (contact-hardening soft shadows) is the mechanism for the smooth, accurate penumbra.
  // If its shader patch silently stopped applying we'd be back to fuzzy/hard PCF.
  if (!s.pcss) fails.push('PCSS not installed — soft shadows fell back to hard/fuzzy PCF (js/pcss.js patch failed?)');
  if (!s.gfx || !('shadows' in s.gfx) || !('fx' in s.gfx) || !('res' in s.gfx))
    fails.push('graphics-menu knobs (__gfx) missing/incomplete: ' + JSON.stringify(s.gfx));
  if (!s.castShadow) fails.push("'high' quality but the sun is not casting a shadow");
  else if (s.texelsPerUnit < MIN_TEXELS_PER_UNIT)
    fails.push(`cast shadow too coarse: ${s.texelsPerUnit} texels/unit (< ${MIN_TEXELS_PER_UNIT}) → muddy`);
  return { fails };
}
