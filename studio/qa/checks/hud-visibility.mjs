// CHECK: HUD chrome shows only where it should. Per the request: the top-right key-hint is
// GONE entirely; the on-screen touch controls (d-pad, action button, journal button,
// fullscreen) appear ONLY on mobile (touch) and are hidden on desktop; the day/night BAR is
// the new clock and shows on both. Generalized: "touch-only chrome must hide on desktop, and
// the removed hint must never render." Uses window.__forceInputMode to drive both modes.
export const meta = {
  id: 'hud-visibility',
  title: 'Touch chrome is mobile-only; key-hint gone; day bar present',
  touches: ['studio/game.html'],
};

const TOUCH_CHROME = ['dpad', 'acts', 'bMenu'];   // fullscreen (#bFull) is JS+touch-gated separately

export async function run(page) {
  const has = await page.evaluate('!!window.__forceInputMode');
  if (!has) return { fails: [], skipped: 'window.__forceInputMode not present yet' };
  const fails = [];
  const disp = id => page.evaluate(`(()=>{ const e=document.getElementById(${JSON.stringify(id)});
    return e ? getComputedStyle(e).display : 'MISSING'; })()`);

  // the top-right explanation must not exist at all
  if (await page.evaluate(`!!document.getElementById('hint')`)) fails.push('#hint (top-right key explanation) still in the DOM — it should be removed');

  // the day/night bar is the new clock — present + not display:none, on every device
  if (await disp('daybar') === 'MISSING') fails.push('#daybar (Pikmin day/night bar) missing');
  else if (await disp('daybar') === 'none') fails.push('#daybar is hidden (should always show)');
  if (await page.evaluate(`!!document.getElementById('clock')`)) fails.push('old #clock element still present (should be replaced by #daybar)');
  // the current time reads beneath the bar (not sparse hour ticks)
  const t = await page.evaluate(`window.__dayBar ? window.__dayBar().time : null`);
  if (!t || !/\d/.test(t)) fails.push('no current-time label beneath the bar (#daybarTime empty: ' + JSON.stringify(t) + ')');

  // DESKTOP: touch chrome hidden
  await page.evaluate(`window.__forceInputMode('desktop')`);
  for (const id of TOUCH_CHROME) { const d = await disp(id);
    if (d !== 'none') fails.push(`#${id} is visible on desktop (display:${d}) — touch chrome must be mobile-only`); }
  if ((await disp('daybar')) === 'none') fails.push('#daybar hidden on desktop (should show)');

  // MOBILE (touch): the same chrome must come back
  await page.evaluate(`window.__forceInputMode('touch')`);
  for (const id of TOUCH_CHROME) { const d = await disp(id);
    if (d === 'none') fails.push(`#${id} stays hidden on touch — should appear on mobile`); }

  await page.evaluate(`window.__forceInputMode('auto')`);   // restore detection
  return { fails };
}
