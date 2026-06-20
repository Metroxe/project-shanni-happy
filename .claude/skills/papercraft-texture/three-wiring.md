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
5. **Texture-at-resolution**: shoot each surface at the **closest reachable** distance (not
   a mid shot) and confirm the **same** grain scale on a tall thin building and a long low
   wall; shoot each sign **straight-on** and confirm the text is legible.

## Density cheat-sheet (1024px tiles)

| surface              | how                                   |
|----------------------|----------------------------------------|
| buildings / plateau  | `worldUV(geo, w, h, d, 0.18)`          |
| stair treads         | `worldUV(geo, w, h, d, 0.18)`          |
| ground plane         | `map.repeat.set(200*0.18, 200*0.18)`   |
| props (bush/tree/lamp/bench/fountain) | `worldUV(geo, w, h, d, 0.18)` so prop grain matches building grain |
| sign board (text)    | no tiling: a dedicated `makeSign()` canvas at ~220 px/m × dpr (cap 2048) on its own plane; MSDF only for long/curved signs |
| keep grain subtler   | lower `--contrast` in `gen_paper.py`, not the density |

**Blending / phase.** Keep `DENSITY` identical on every textured face and use world-space
UVs (`worldUV`, or the Option B triplanar which is phase-correct by construction) so
abutting walls and stair treads share grain **phase** across the seam; never abut two
unrelated maps at different densities. Because every `paperMat` shares ONE tile and every
face is UV'd at the same `DENSITY`, neighbours match by construction and material identity
is only the per-mesh tint, that shared-tile-plus-tint **is** the blend. If a grain step
still shows at a joint after `worldUV`, switch that surface to triplanar (heavier, 3
samples, but bulletproof).

## Foreground: model it, do not paint it

The blur is not only UV + resolution: it is also that `facadeTex(f,wWorld,hWorld)`
(game.html ~line 617) paints the **whole** storefront (wall + sign band + awning + window
grid + door + text) into one **48 px/metre** canvas mapped across a 28m face (`addFacade`,
~line 655). Stop. In the foreground (the reachable L: plaza, both streets, stairs, sunken
park) the wall texture carries only flat paper grain; the structure becomes separate modeled
paper pieces in a `makeFacade()` group: a **sign board** prop, the **awning** box (already
there, at `base+h*0.80`, `off=0.05`), a small row of cream **window-frame** boxes (reuse the
`facadeTex` `cols2`/`rows` math), and a **door** box, each `M(geo,'#'+hex,false,false)` at a
small depth offset off the face like the awning's `off`/`depth` pattern.

Decision rule: **model** a detail when the player can stand within ~one building-width of it
and it has its own outline or depth; **texture** it only when it is flat by nature or lives
in the `buildBackdrop()` / fog ring. Keep each shopfront's kit **small** (sign, awning,
window frames, door): do not model mullions, brick, trim, or per-window variation. Wall,
plateau, stairs, and boards all sample the **one** shared `loadPaper()` set tinted per-mesh
at `worldUV(...,0.18)`, so neighbours match by construction; the modeled pieces float just
off the wall and sit **on top** of it rather than texture-blending with it.

### In-world text = a die-cut sign board, never baked into the wall

Text is its own crisp texture on its **own** board geometry. Add
`makeSign(text, boardW, boardH, {bg,fg,font})` beside `makeBush`/`makeTree`: a thin board
box plus a front-face `CanvasTexture` sized
`cw = Math.min(2048, Math.ceil(boardW*220*devicePixelRatio))`,
`ch = Math.ceil(boardH*220*devicePixelRatio)`, font ~`Math.ceil(ch*0.5)+'px sans-serif'`
centred (shrink-to-fit with margins), `anisotropy=renderer.capabilities.getMaxAnisotropy()`,
`minFilter=LinearMipmapLinearFilter`, `colorSpace=SRGBColorSpace`. `makeFacade()` builds it
from `f.sign`, sizes it to `faceLen` on the sign band (~`base+h*0.90`, over the old sign
strip), offset ~0.05 off the wall so it does not z-fight. The `world.json` `f.sign` strings are unchanged, so no data
migration. **Never call `fillText` into `facadeTex` again**: the text stays sharp because
its canvas is sized to the board span, not the 28m wall. Upgrade to MSDF /
`troika-three-text` only for a long or curved sign.
