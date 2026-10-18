// Existing low-level regressions exercise the opt-in direct-control preference.
// New strategy.spec tests the fresh/default decision flow without this helper.
export async function enableDirectControls(page){
  if(await page.locator('#direct-control-mode').isChecked())return;
  await page.click('#btn-menu');
  await page.locator('#control-style-settings > summary').click();
  await page.locator('#direct-control-mode').check();
  await page.locator('#control-style-settings > summary').click();
  await page.locator('#game-menu [data-close-drawer]').click();
}
