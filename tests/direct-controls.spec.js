import {enableDirectControls} from './helpers/controls-mode.js';
import { test, expect } from '@playwright/test';

// Fresh games, UI commands only. World state is read for assertions, never granted.
for (const mobile of [false, true]) test(`essential commands and pending choices work directly through ${mobile ? 'touch' : 'mouse'}`, async ({ browser }) => {
  test.setTimeout(240000);
  const viewport = mobile ? { width:390, height:844 } : { width:1024, height:640 };
  const context = await browser.newContext({ viewport, hasTouch:mobile, isMobile:mobile });
  try {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const press = selector => mobile ? page.locator(selector).tap() : page.locator(selector).click();
    const read = () => page.evaluate(() => {
      const a = AETHERIA_API;
      return { faith:a.state.faith, wood:a.state.wood, ore:a.state.ore, population:a.agents.filter(w=>w.alive).length,
        soldiers:a.agents.filter(w=>w.alive&&w.role==='soldier').length, era:a.state.civEra };
    });
    async function reachable(selector) {
      const button = page.locator(selector);
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1); expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+1);
      await expect.poll(()=>button.evaluate(b=>{const r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b;}), {message:`${selector} receives input after the responsive layout settles`}).toBe(true);
    }
    await page.goto('/'); await page.waitForFunction(()=>window.AETHERIA_API);await enableDirectControls(page); await press('[data-speed="0"]');
    await expect(page.locator('#left-panel')).toBeHidden();
    for (const selector of ['#btn-train-soldier','#btn-spawn-villager','#btn-select-worker','[data-build="house"]','[data-build="tower"]','#btn-advance-era']) await reachable(selector);
    const start = await read();
    await press('#btn-train-soldier'); const trained = await read();
    expect(trained.soldiers).toBe(start.soldiers+1); expect(trained.population).toBe(start.population); expect(trained.faith).toBeCloseTo(start.faith-25, 5);
    await expect(page.locator('#quick-soldiers')).toHaveText(String(trained.soldiers));
    await press('#btn-spawn-villager'); const recruited = await read();
    expect(recruited.population).toBe(start.population+1); expect(recruited.faith).toBeCloseTo(start.faith-45, 5);
    await expect(page.locator('#quick-pop')).toHaveText(String(recruited.population));
    await expect(page.locator('#btn-spawn-villager')).toHaveAttribute('aria-disabled','true');
    await expect(page.locator('#left-panel')).toBeHidden();
    await press('[data-build="house"]'); await expect(page.locator('#construction-bar')).toBeVisible();
    await press('#btn-cancel-construction'); expect(await read()).toEqual(recruited);
    await page.screenshot({path:`test-results/direct-commands-${mobile?'mobile':'desktop'}.png`, animations:'disabled', timeout:90000});
    await press('#btn-select-worker'); await expect(page.locator('#worker-task-bar')).toBeVisible();
    for (const job of ['wood','ore','food','auto']) await reachable(`[data-worker-resource="${job}"]`);
    await press('[data-worker-resource="wood"]');
    expect(await page.evaluate(()=>AETHERIA_API.state.selectedEntity.workOrder.resource)).toBe('wood');
    await press('#btn-close-insp'); await expect(page.locator('#worker-task-bar')).toBeHidden();
    await press('#btn-trigger-dilemma'); await expect(page.locator('#decision-card')).toBeVisible();
    await expect(page.locator('#dilemma-overlay')).toBeHidden();
    for (let choice=0;choice<3;choice++) await reachable(`#dl-choice-${choice}`);
    await reachable('#btn-decision-continue');
    for(const selector of ['#btn-zoom-in','#btn-zoom-out','#btn-mob-reset-cam']) await reachable(selector);
    const title = await page.locator('#decision-title').textContent();
    await page.screenshot({path:`test-results/direct-decision-${mobile?'mobile':'desktop'}.png`, animations:'disabled', timeout:90000});
    // Playing on does not discard or reroll the question, and replying respects current pause.
    await press('#btn-decision-continue'); await expect(page.locator('#decision-card')).toBeVisible();
    await press('[data-speed="1"]'); const time=await page.evaluate(()=>AETHERIA_API.simulationTime);
    await page.waitForFunction(t=>AETHERIA_API.simulationTime>t+.1,time,{timeout:30000}); await press('[data-speed="0"]');
    await press('#btn-trigger-dilemma'); await expect(page.locator('#decision-title')).toHaveText(title);
    await press('#btn-decision-details'); await expect(page.locator('#dilemma-overlay')).toBeVisible();
    await press('#btn-close-dilemma'); await expect(page.locator('#dilemma-overlay')).toBeHidden();
    await expect(page.locator('#decision-title')).toHaveText(title);
    await press('#dl-choices .dl-choice-btn:not([aria-disabled="true"]) >> nth=0');
    await expect(page.locator('#decision-card')).toBeHidden();
    expect(await page.evaluate(()=>AETHERIA_API.state.timeScale)).toBe(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
