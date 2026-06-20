// CHECK: textured faces have adequate, roughly uniform texel density — no blurry, stretched,
// or mismatched maps. GENERALIZED from the textures session: "textures ... very blurry, and
// especially for the buildings, they don't really line up well." The textures branch was
// already designing this exact audit (texels-per-metre per face → "texture density uniform").
//
// DEFENSIVE: skips until window.__textureDensity() exists (the textures branch builds it).
// EXPECTED PROBE: window.__textureDensity() -> { lowDensity:[{label, texelsPerMetre}], ... }
// (faces well below the target density = blurry/stretched; []=uniform). When that branch
// folds in, point this at its probe (rename here if it named it differently).
export const meta = {
  id: 'texture-density',
  title: 'No blurry/stretched textures (uniform texel density per face)',
  touches: ['studio/game.html', 'studio/js'],
};

export async function run(page) {
  const r = await page.evaluate('window.__textureDensity ? window.__textureDensity() : null');
  if (r === null) return { fails: [], skipped: 'window.__textureDensity() not present yet' };
  const low = r.lowDensity || [];
  return { fails: low.length ? ['blurry/low-density faces: ' + low.map(f => f.label).join(', ')] : [] };
}
