// CHECK: the cutscene system is wired and the first-visit hamster gating holds. Runs on
// the default audit boot (a FRESH New Game → town, quest unstarted), so it asserts the
// invariants that must be true before any cutscene plays:
//   - the Cutscene engine is present + idle (no cutscene in town),
//   - the pet shop declares its first-visit cutscene id,
//   - the town hamsters are GATED OFF until the roundup quest begins (they "escape" in the
//     pet-shop cutscene) — defs say 5, but none are gated-in or built while unstarted.
// This locks the rule "hamsters don't show up before the cutscene" as a deterministic gate.
export const meta = {
  id: 'cutscene',
  title: 'Cutscene engine wired + town hamsters gated on the quest',
  touches: ['studio/game.html', 'studio/js/cutscene.js', 'studio/specs/petshop.json'],
};

export async function run(page, ctx) {
  const fails = [];
  const probe = await page.evaluate('typeof window.__cutscene==="function" ? window.__cutscene() : null');
  if (!probe) { fails.push('window.__cutscene() probe missing (engine not wired)'); return { fails }; }

  if (!probe.hasEngine) fails.push('Cutscene engine not imported (Cutscene.play missing)');
  if (probe.active) fails.push('a cutscene is active on the town boot (should be idle)');
  if (probe.petshopCutscene !== 'cs_petshop_intro')
    fails.push('petshop spec missing cutscene id (got ' + JSON.stringify(probe.petshopCutscene) + ')');

  // gating: town declares 5 hamsters, but none exist until q_hamsters is active
  if (probe.questStarted) fails.push('q_hamsters already started on a fresh boot (expected unstarted)');
  if (probe.townHamsterDefs !== 5) fails.push('town should declare 5 hamster collectibles (got ' + probe.townHamsterDefs + ')');
  if (probe.townHamstersGated !== 0)
    fails.push('town hamsters not gated off pre-quest (gated-in ' + probe.townHamstersGated + ', expected 0)');
  if (probe.liveHamsters !== 0)
    fails.push('hamster pickups built in town before the quest (' + probe.liveHamsters + ', expected 0)');

  // teardown guard: no cutscene-spawned prop (userData.csProp) may exist outside a cutscene
  const props = await page.evaluate('typeof window.__csProps==="function" ? window.__csProps() : null');
  if (!props) fails.push('window.__csProps() teardown probe missing');
  else if (props.lingering && props.lingering.length)
    fails.push('cutscene props present on the town boot (should be none): ' + JSON.stringify(props.lingering));

  return { fails };
}
