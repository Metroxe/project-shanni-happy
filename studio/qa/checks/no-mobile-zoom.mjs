// CHECK: the mobile browser must NEVER zoom the game (pinch or double-tap). GENERALIZED
// from "on mobile the screen sometimes zooms" — the class is "any browser zoom gesture on
// the game surface", not one device. Three independent guards must all hold, because each
// covers a gap the others don't:
//   1. viewport meta `user-scalable=no` — the baseline (honoured by Android; ignored by iOS).
//   2. touch-action:none on the full-screen surfaces — touch-action does NOT inherit, so the
//      canvas/body each need it explicitly or the browser pinch-/double-tap-zooms there.
//   3. iOS Safari fires its own `gesture*` events on the document regardless of touch-action,
//      so they must be preventDefault-ed. We prove it by dispatching a synthetic cancelable
//      gesturestart and asserting it came back defaultPrevented.
export const meta = {
  id: 'no-mobile-zoom',
  title: 'Mobile browser zoom (pinch + double-tap) is disabled',
  touches: ['studio/game.html'],
};

export async function run(page) {
  const fails = await page.evaluate(() => {
    const f = [];
    const vp = (document.querySelector('meta[name=viewport]')?.content || '');
    if (!/user-scalable\s*=\s*no/.test(vp)) f.push('viewport meta missing user-scalable=no');
    const ta = (el, name) => {
      if (!el) { f.push(name + ' element missing'); return; }
      const v = getComputedStyle(el).touchAction;
      if (v !== 'none') f.push(name + ' touch-action is "' + v + '" (need none)');
    };
    ta(document.getElementById('c'), '#c canvas');
    ta(document.body, 'body');
    const ev = new Event('gesturestart', { cancelable: true, bubbles: true });
    document.dispatchEvent(ev);
    if (!ev.defaultPrevented) f.push('gesturestart not preventDefault-ed (iOS pinch-zoom would fire)');
    return f;
  });
  return { fails };
}
