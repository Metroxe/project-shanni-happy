// CHECK: the billboard CONTACT-shadow oval (under Shen / NPCs / pickups) fades to ~transparent
// at its rim — it is NOT a hard-edged solid disc. GENERALIZED from "subtle folds / weird shadows
// on the left and right of Shen on the stairs": the oval is a single FLAT horizontal quad at the
// player's foot height, but stairs (and any uneven ground) step the surface beneath her. A
// hard-edged disc gets sliced by the step edges — occluded behind the higher tread, floating over
// the lower one — so it bands across the steps and its wide left/right extremities poke out beside
// her hips. The class: a contact-shadow oval must dissolve at its rim so it can never show a hard
// clip on stepped/uneven ground. (The pre-regression oval was a soft radial gradient → no
// artifact; the shadow rework briefly made it a solid core + thin rim → the folds came back.)
//
// Pure read of the live shadow material's canvas (no screenshot): a defined core, monotonically
// non-increasing outward, reaching ~0 at the rim. A solid-disc regression FAILS here.
// EXPECTED PROBE: window.__contactShadowProfile() -> {center, mid, edge, rim} alphas 0..1.
export const meta = {
  id: 'contact-shadow-soft',
  title: 'Contact-shadow oval fades to transparent at its rim (no hard edge → no stair "fold")',
  touches: ['studio/game.html'],
};

export async function run(page) {
  const p = await page.evaluate('window.__contactShadowProfile ? window.__contactShadowProfile() : null');
  if (p === null) return { fails: ['window.__contactShadowProfile() unavailable (shadow mesh / probe missing)'] };
  const fails = [];
  // 1) a real, grounded core (not invisible)
  if (p.center < 0.20) fails.push(`contact shadow core too faint (center alpha ${p.center} < 0.20)`);
  // 2) the rim must dissolve — this is the artifact guard
  if (p.rim > 0.06) fails.push(`contact shadow has a HARD rim (rim alpha ${p.rim} > 0.06) — will band/poke on stairs`);
  if (p.edge > 0.30) fails.push(`contact shadow edge too solid (edge alpha ${p.edge} > 0.30) — fade starts too late`);
  // 3) monotonic fade outward (core ≥ mid ≥ edge ≥ rim), small slack for blur noise
  if (!(p.center + 0.02 >= p.mid && p.mid + 0.02 >= p.edge && p.edge + 0.02 >= p.rim))
    fails.push(`contact shadow alpha not fading outward: center=${p.center} mid=${p.mid} edge=${p.edge} rim=${p.rim}`);
  return { fails };
}
