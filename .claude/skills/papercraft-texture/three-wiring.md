# Wiring baked textures into the Three.js scene — the actual blurry/stretched fix

The textures looking "blurry and stretched" is **80% a UV problem, 20% a resolution
problem.** Baking crisp maps (`gen_paper.py`) only fixes the 20%. The 80% is here.

## Root cause (measured)

In `studio/game.html`, `paperTex()` makes a **256px** canvas and every `paperMat()`
uses a **fixed** `t.repeat.set(1.6, 1.6)`. `BoxGeometry` UVs run 0..1 per face. So a
framing-wall building (`w:5, d:28, h:14`) maps 1.6 tiles of a 256px image across a
**28m × 14m** face → ~one texel every few cm (blurry), and because the face is 2× wider
than tall, the grain is **stretched ~2× horizontally** (1.6 reps / 28m ≠ 1.6 reps / 14m).
Two independent bugs: **too few texels per metre**, and **texel density that varies by
face**.

The fix is to make **texels-per-metre constant** everywhere, and feed it crisp tiles.

## Step 1 — load the baked maps once (crisp sampling)

```js
const maxAniso = renderer.capabilities.getMaxAnisotropy();   // 8–16, not the old 4
function loadPaper(prefix){
  const set = {};
  for (const [k, srgb] of [['map',true],['bumpMap',false],['normalMap',false]]){
    const suffix = {map:'color', bumpMap:'bump', normalMap:'normal'}[k];
    const t = new THREE.TextureLoader().load(`${prefix}_${suffix}.png`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;   // mipmaps kill shimmer at distance
    set[k] = t;
  }
  return set;                                       // share across materials; tint per-mesh
}
```

The colour map is near-neutral on purpose — keep tinting the **material** (`color`) the
per-building pastel hex from `world.json`; the texture multiplies it. One shared map set,
many tints = cheap.

## Step 2 — uniform texel density (the stretch fix)

Pick a density (tiles-per-metre) ONCE so every surface samples at the same rate. With a
1024px tile, **`DENSITY = 0.18` reps/m** (≈ one tile per 5.5m) is a good papercraft start.

### Option A — rewrite BoxGeometry UVs to world space (recommended drop-in)

Exact for boxes, no shader, no per-face stretch. Call right after you build the geometry:

```js
// scale each of the 6 box faces' UVs by its real-world size × DENSITY.
function worldUV(geo, w, h, d, density){
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  // BoxGeometry face order: +X,-X,+Y,-Y,+Z,-Z, 4 verts each. Map each face to the
  // two world axes it spans so density is identical on every face.
  const span = [[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];   // (u-extent, v-extent) per face
  for (let f = 0; f < 6; f++){
    const [su, sv] = span[f];
    for (let i = 0; i < 4; i++){
      const vi = f*4 + i;
      uv.setXY(vi, uv.getX(vi)*su*density, uv.getY(vi)*sv*density);
    }
  }
  uv.needsUpdate = true;
}
// in buildTerrain(), replace `new THREE.BoxGeometry(...)` usage:
const geo = new THREE.BoxGeometry(bd.w, top-bottom, bd.d);
worldUV(geo, bd.w, top-bottom, bd.d, DENSITY);
const m = M(geo, '#'+bd.color, false, true);     // M() already adds the cream edge
```

Do the same for the plateau and the stair treads (they're boxes too). The ground plane
(`200×200`) currently has **no** texture — give it the same map with `repeat.set(200*DENSITY, 200*DENSITY)`.

### Option B — triplanar via `onBeforeCompile` (advanced, zero UV seams)

Projects the texture from the three world axes and blends by the surface normal — uniform
density on *any* geometry, no UV layout at all. Heavier (3 samples) but bulletproof. Use
if you add non-box shapes. Sketch:

```js
function triplanar(mat, density){
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDensity = { value: density };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n vWPos = (modelMatrix*vec4(transformed,1.0)).xyz; vWN = normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDensity; varying vec3 vWPos; varying vec3 vWN;')
      .replace('#include <map_fragment>', `
        vec3 bw = pow(abs(vWN), vec3(4.0)); bw /= (bw.x+bw.y+bw.z);
        vec2 uvX = vWPos.zy*uDensity, uvY = vWPos.xz*uDensity, uvZ = vWPos.xy*uDensity;
        vec4 tx = texture2D(map, uvX), ty = texture2D(map, uvY), tz = texture2D(map, uvZ);
        vec4 sampledDiffuseColor = tx*bw.x + ty*bw.y + tz*bw.z;
        diffuseColor *= sampledDiffuseColor; `);
  };
  mat.customProgramCacheKey = () => 'triplanar'+density;
}
```

## Step 3 — verify (don't trust the eye on a background tab)

1. Serve the worktree, `preview_screenshot` a wall close-up at gameplay distance.
2. Crisp grain, no smear, **same** grain scale on a tall thin building and a long wall.
3. Walk a round-trip past several buildings: no tile "swimming" or seam lines.
4. `smoke` green, camera QA 0 fails (textures don't move geometry, but re-run anyway).

## Density cheat-sheet (1024px tiles)

| surface              | how                                   |
|----------------------|----------------------------------------|
| buildings / plateau  | `worldUV(geo, w, h, d, 0.18)`          |
| stair treads         | `worldUV(geo, w, h, d, 0.18)`          |
| ground plane         | `map.repeat.set(200*0.18, 200*0.18)`   |
| keep grain subtler   | lower `--contrast` in `gen_paper.py`, not the density |
