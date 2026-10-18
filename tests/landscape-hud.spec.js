import {enableDirectControls} from './helpers/controls-mode.js';
import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 400, height: 300 }, { width: 640, height: 480 }, { width: 844, height: 390 }]) {
test(`landscape HUD keeps speed controls reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.goto('/'); await page.waitForFunction(() => window.AETHERIA_API);await enableDirectControls(page);
  const top = await page.locator('#top-bar').boundingBox();
  const tools = await page.locator('#hud-master-control').boundingBox();
  await page.screenshot({ path: `test-results/landscape-hud-${viewport.width}.png` });
  expect(tools.y).toBeGreaterThanOrEqual(top.y + top.height);
  await page.click('[data-speed="5"]');
  expect(await page.evaluate(() => AETHERIA_API.state.timeScale)).toBe(5);
  await page.click('[data-speed="0"]');
  expect(await page.evaluate(() => AETHERIA_API.state.timeScale)).toBe(0);
  await page.keyboard.press('KeyH');
  await expect(page.locator('body')).toHaveClass(/hud-hidden/);
  await page.keyboard.press('KeyH');
  await page.click('[data-speed="1"]');
  expect(await page.evaluate(() => AETHERIA_API.state.timeScale)).toBe(1);
  await page.click('[data-speed="0"]');
  for (const selector of ['#btn-train-soldier','#btn-spawn-villager','#btn-select-worker','[data-build="house"]','[data-build="tower"]','#btn-advance-era']) {
    const box=await page.locator(selector).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
  }
  await page.click('#btn-trigger-dilemma');await expect(page.locator('#decision-card')).toBeVisible();
  for (let choice=0;choice<3;choice++) {
    const button=page.locator(`#dl-choice-${choice}`),box=await button.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
    await expect.poll(()=>button.evaluate(b=>{const r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b;})).toBe(true);
  }
  await expect.poll(()=>page.locator('#btn-decision-continue').evaluate(b=>{const r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b;})).toBe(true);
  await page.screenshot({path:`test-results/landscape-decision-${viewport.width}.png`,animations:'disabled',timeout:90000});
});
}
