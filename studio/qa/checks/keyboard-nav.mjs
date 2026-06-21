// CHECK: the whole game must be playable with the keyboard alone. GENERALIZED from
// "I want to play with the keyboard" — the class is "every interactive surface (menus,
// dialogue, the action button) responds to keys", not one screen. The mouse may still
// work, but a keyboard-only player must be able to: open the journal with a key, move a
// selection cursor through its controls and ACTIVATE one with Space/Enter, nudge the
// settings sliders with Left/Right, pick dialogue options, and use Space as the action
// button. game.html's window.__kbNav() drives the REAL keydown listeners with synthetic
// events (so the wiring is exercised, not just the helpers) and returns the failures.
export const meta = {
  id: 'keyboard-nav',
  title: 'Menus, dialogue choices, and the action button are keyboard-operable',
  touches: ['studio/game.html'],
};

export async function run(page) {
  const r = await page.evaluate('window.__kbNav ? window.__kbNav() : {fails:["__kbNav probe missing"]}');
  return { fails: (r && r.fails) || [] };
}
