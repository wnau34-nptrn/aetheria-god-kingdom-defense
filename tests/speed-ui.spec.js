import { test, expect } from '@playwright/test';
test.use({viewport:{width:800,height:600}});

test('real WebGL frames advance at 1x/5x, event tabs pause and unfunded trade is rejected', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.waitForFunction(()=>window.AETHERIA_API);
  for(const speed of [1,5]){
    await page.click(`[data-speed="${speed}"]`);
    const start=await page.evaluate(()=>AETHERIA_API.simulationTime);
    await page.waitForFunction(time=>AETHERIA_API.simulationTime>=time+0.2,start);
    await page.click('#btn-trigger-dilemma');await page.click('#btn-decision-details');
    if (await page.locator('.event-stories').getAttribute('open') === null) await page.locator('.event-stories > summary').click();
    await page.click('[data-dl-idx="1"]');
    // A controlled insufficient-funds fixture, not a natural-play balance measurement.
    await page.evaluate(()=>{AETHERIA_API.state.faith=AETHERIA_API.state.wood=AETHERIA_API.state.food=0;});
    await page.click('[data-dl-idx="2"]');
    const paused=await page.evaluate(()=>({time:AETHERIA_API.simulationTime,wagons:AETHERIA_API.wagons.length,population:AETHERIA_API.agents.length}));
    await expect(page.locator('[data-speed="0"]')).toHaveClass(/active/);
    const choice=page.locator('#dl-choice-0');await expect(choice).toHaveAttribute('aria-disabled','true');
    await choice.scrollIntoViewIfNeeded();const box=await choice.boundingBox();
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    await expect(page.locator('#dilemma-toast')).toContainText('ไม่สามารถเลือกได้');
    await page.waitForTimeout(500);
    expect(await page.evaluate(()=>({time:AETHERIA_API.simulationTime,wagons:AETHERIA_API.wagons.length,population:AETHERIA_API.agents.length}))).toEqual(paused);
    expect(await page.evaluate(()=>AETHERIA_API.state.food)).toBe(0);
    if(speed===5)await page.screenshot({path:'docs/speed-review/screenshots/unaffordable-caravan.png'});
    await page.click('#btn-close-dilemma');
    expect(await page.evaluate(()=>AETHERIA_API.state.timeScale)).toBe(speed);
    await expect(page.locator(`[data-speed="${speed}"]`)).toHaveClass(/active/);
    await page.click('[data-speed="0"]');
  }
  expect(errors).toEqual([]);
});

test('a blocked council plot keeps resources and decision open in the actual UI',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.waitForFunction(()=>window.AETHERIA_API);
  await page.click('[data-speed="0"]');
  await page.evaluate(()=>{
    const a=AETHERIA_API;a.state.wood=100;
    // Exclusion-zone fixture covers all candidate locations without adding render meshes.
    for(let x=-45;x<=45;x+=5)for(let z=-45;z<=45;z+=5)a.buildings.push({type:'house',x,z,hp:100,maxHp:100,progress:1});
  });
  const before=await page.evaluate(()=>({wood:AETHERIA_API.state.wood,pop:AETHERIA_API.agents.length}));
  await page.click('#btn-trigger-dilemma');await page.click('#btn-decision-details');if (await page.locator('.event-stories').getAttribute('open') === null) await page.locator('.event-stories > summary').click();
  await page.click('[data-dl-idx="1"]');await page.click('#dl-choice-0');
  await expect(page.locator('#dilemma-toast')).toContainText('ไม่พบพื้นที่เหมาะสม');
  await expect(page.locator('#dilemma-overlay')).toHaveClass(/visible/);
  expect(await page.evaluate(()=>({wood:AETHERIA_API.state.wood,pop:AETHERIA_API.agents.length}))).toEqual(before);
  await page.screenshot({path:'docs/speed-review/screenshots/council-no-plot.png'});
  await page.click('#btn-close-dilemma');expect(await page.evaluate(()=>AETHERIA_API.state.timeScale)).toBe(0);
  expect(errors).toEqual([]);
});
