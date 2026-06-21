// CHECK: the Day/Night world-state machine gates the world correctly. Generalized from
// the day/night build: "NIGHT = 21:00..07:00 (NOT Sky.clock().isDay 06:00..18:00); shops
// close at night; the overworld swaps to the night music track." Verifies the pure logic
// at forced clock hours — boundary inclusivity, shop gating, and music selection — so it
// can never silently regress (e.g. someone reusing isDay, or a shop staying open at night).
//
// DEFENSIVE: skips until window.__forceTime / __dnState exist (other branches/scenes).
// PROBES: window.__forceTime(h) snaps the clock to wall-hour h (no curtain) + returns
// {h24,state}; window.__dnState() -> {state,night,h24,track,portals:[{id,open,hours}],npcs}.
export const meta = {
  id: 'day-night',
  title: 'Day/Night state gates shops + music (night = 21:00–07:00)',
  touches: ['studio/game.html', 'studio/specs/world.json'],
};

export async function run(page) {
  const has = await page.evaluate('!!(window.__forceTime && window.__dnState && window.sky)');
  if (!has) return { fails: [], skipped: 'window.__forceTime/__dnState not present yet' };

  const fails = [];
  const orig = await page.evaluate('window.sky.phase');      // restore at the end (don't perturb later checks)
  const at = h => page.evaluate(`(()=>{ window.__forceTime(${h}); return window.__dnState(); })()`);
  const portal = (st, id) => (st.portals || []).find(p => p.id === id);

  // --- state derivation + boundary inclusivity (NIGHT = 21:00 up to 07:00) ---
  const expect = { 0: 'NIGHT', 2: 'NIGHT', 6: 'NIGHT', 7: 'DAY', 12: 'DAY', 20: 'DAY', 21: 'NIGHT', 23: 'NIGHT' };
  for (const [h, want] of Object.entries(expect)) {
    const st = await at(+h);
    if (st.state !== want) fails.push(`state at ${h}:00 = ${st.state}, expected ${want}`);
  }

  // --- shop gating: pet shop + gym are day-only (closed at night) ---
  const shops = ['to_petshop', 'to_gym'];
  const night = await at(23);
  for (const id of shops) {
    const p = portal(night, id);
    if (!p) { fails.push(`portal ${id} missing from town`); continue; }
    if (p.open) fails.push(`${id} is OPEN at 23:00 (should be closed at night; hours=${p.hours})`);
  }
  const day = await at(12);
  for (const id of shops) {
    const p = portal(day, id);
    if (p && !p.open) fails.push(`${id} is CLOSED at 12:00 (should be open by day)`);
  }

  // --- music selection: overworld night vs day track ---
  if (!/night\.ogg$/.test(night.track)) fails.push(`night overworld track = ${night.track} (expected …night.ogg)`);
  if (!/calm\.ogg$/.test(day.track))    fails.push(`day overworld track = ${day.track} (expected …calm.ogg)`);

  // --- a wrap-aware [open,close] schedule (sanity on the schedule evaluator) ---
  // (no town portal uses an array schedule, so probe the helper indirectly via __dnState's
  // own night flag, which is the same boundary the array form would key off.)
  const b = await at(3);
  if (!b.night) fails.push('isNight() false at 03:00 (night window broken)');

  await page.evaluate(`window.sky.setTime(${orig})`);        // restore the clock
  return { fails };
}
