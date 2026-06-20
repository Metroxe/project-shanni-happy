// CHECK: the game boots clean — window.__ready true, no fatal build error, no uncaught
// page errors. The floor under every other check (a broken boot fails everything).
export const meta = {
  id: 'boot',
  title: 'Game boots with no fatal/uncaught errors',
  touches: ['studio/game.html', 'studio/js'],
};

export async function run(page, ctx) {
  const fails = [];
  const ready = await page.evaluate('!!window.__ready');
  const jsErr = await page.evaluate('window.__err || null');
  if (!ready) fails.push('game did not boot (window.__ready never true)');
  if (jsErr)  fails.push('window.__err set during build: ' + jsErr);
  if (ctx.pageErrors.length) fails.push('uncaught page errors:\n    ' + ctx.pageErrors.join('\n    '));
  return { fails };
}
