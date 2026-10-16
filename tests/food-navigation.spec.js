import { test, expect } from '@playwright/test';

test('a fisherman produces food from the walkable river bank in real WebGL', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 300 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.waitForFunction(() => window.AETHERIA_API);
  await page.click('[data-speed="0"]');
  // Controlled era-2 work fixture; this is not natural progression into the era.
  const start = await page.evaluate(() => {
    const a = AETHERIA_API; a.evolveToEra(2);
    const fisher = a.agents.find(x => x.role === 'fisherman');
    for (const other of a.agents) if (other !== fisher) { other.alive = false; other.mesh.visible = false; }
    fisher.hunger = 0; a.state.food = 0; a.state.autoBuildCooldown = 1000;
    return a.simulationTime;
  });
  await page.click('[data-speed="5"]');
  await page.waitForFunction(time => AETHERIA_API.simulationTime >= time + 13, start);
  await page.click('[data-speed="0"]');
  expect(await page.evaluate(() => AETHERIA_API.state.food)).toBeGreaterThanOrEqual(8);
  expect(errors).toEqual([]);
});

test('the river-bank worker moves and a nearby meal works in real WebGL', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.waitForFunction(() => window.AETHERIA_API);
  await page.click('[data-speed="0"]');
  const start = await page.evaluate(() => {
    const a = AETHERIA_API, w = a.agents.find(x => x.id === 3);
    return { x: w.x, z: w.z, time: a.simulationTime };
  });
  await page.click('[data-speed="5"]');
  await page.waitForFunction(start => AETHERIA_API.simulationTime >= start + 3, start.time);
  await page.click('[data-speed="0"]');
  expect(await page.evaluate(start => {
    const w = AETHERIA_API.agents.find(x => x.id === 3);
    return Math.hypot(w.x - start.x, w.z - start.z);
  }, start)).toBeGreaterThan(1);
  // Controlled fixture for a meal; the movement check above used the natural start.
  const before = await page.evaluate(() => {
    const a = AETHERIA_API, worker = a.agents.find(x => x.id === 3);
    for (const other of a.agents) if (other !== worker) { other.alive = false; other.mesh.visible = false; }
    Object.assign(worker, { x: 3, z: 0, hunger: 70, carryAmount: 0, targetObj: null });
    a.state.food = 10; a.state.wood = 0; a.state.autoBuildCooldown = 1000;
    a.trees.splice(1); Object.assign(a.trees[0], { x: 80, z: 30, hasFruit: true, growth: 1 });
    return a.simulationTime;
  });
  await page.click('[data-speed="5"]');
  await page.waitForFunction(time => AETHERIA_API.simulationTime >= time + 1, before);
  await page.click('[data-speed="0"]');
  expect(await page.evaluate(() => AETHERIA_API.state.food)).toBe(8);
  expect(await page.evaluate(() => AETHERIA_API.agents.find(x => x.id === 3).hunger)).toBeLessThan(5);
  expect(errors).toEqual([]);
});
