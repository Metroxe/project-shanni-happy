// CHECK: the player stands ON the stair tread tops, never sunk below them. GENERALIZED from
// "going down the stairs there is a lot of clipping": the stairs are drawn as STEPPED boxes
// but groundHeight used a SMOOTH RAMP, so in the lower half her feet sat below the tread tops
// and the step she'd just left clipped across her legs. The class: a billboard's grounding
// height must match the VISIBLE surface beneath her — never below it (sink = clip).
//
// The probe derives each step's tread top straight from the STAIRS spec (the same H - i*dy
// the builder draws) and compares it to groundHeight, so it is independent of how groundHeight
// is implemented: a ramp regression FAILS this, the stepped grounding PASSES. Pure geometry,
// no screenshot. EXPECTED PROBE: window.__stairGrounding() -> [{x,z,gh,treadTop,sunk}] of any
// sample sunk below its tread top ([] = clean). Defensive: skips a scene with no stairs.
export const meta = {
  id: 'stair-grounding',
  title: 'Player stands on the stair treads (never sunk below them → no clip)',
  touches: ['studio/game.html', 'studio/specs/world.json'],
};

export async function run(page) {
  const r = await page.evaluate('window.__stairGrounding ? window.__stairGrounding() : null');
  if (r === null) return { fails: [], skipped: 'no stairs in this scene' };
  if (!r.length) return { fails: [] };
  return { fails: ['feet SUNK below tread tops (steps clip her legs): ' +
    r.slice(0, 6).map(s => `(${s.x},${s.z}) gh=${s.gh}<top=${s.treadTop} by ${s.sunk}`).join(', ') +
    (r.length > 6 ? ` …+${r.length - 6} more` : '')] };
}
