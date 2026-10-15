import { test, expect } from '@playwright/test';

test('small landscape HUD keeps speed controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await page.goto('/'); await page.waitForFunction(() => window.AETHERIA_API);
  const top = await page.locator('#top-bar').boundingBox();
  const tools = await page.locator('#hud-master-control').boundingBox();
  await page.screenshot({ path: 'test-results/small-landscape-hud.png' });
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
});
