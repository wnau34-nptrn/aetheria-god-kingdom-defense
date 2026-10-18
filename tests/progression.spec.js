import {test,expect} from '@playwright/test';

for(const mobile of [false,true])test(`normal era progression keeps the same kingdom on ${mobile?'touch':'desktop'} while sandbox preview resets it`,async({browser})=>{
  test.setTimeout(240000);
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},hasTouch:mobile,isMobile:mobile});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const press=selector=>mobile?page.locator(selector).tap():page.locator(selector).click();
    await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.AETHERIA_API);await press('[data-speed="0"]');
    await press('#btn-select-worker');await press('[data-worker-resource="wood"]');
    // Controlled starting condition: near-ready progress, injured house and a
    // worker carrying wood. All advancement and preview actions use actual UI.
    await page.evaluate(()=>{
      const a=AETHERIA_API,worker=a.state.selectedEntity,house=a.buildings.find(e=>e.type==='house');
      window.__eraKingdom={worker,house,people:[...a.agents],buildings:[...a.buildings],workerId:worker.entityId,houseMesh:house.mesh};
      a.state.civProgress=99.99;a.updateHUD();
    });
    const read=()=>page.evaluate(()=>{const a=AETHERIA_API,k=window.__eraKingdom;return {era:a.state.civEra,progress:a.state.civProgress,selected:a.state.selectedEntity===k.worker,samePeople:a.agents.length===k.people.length&&a.agents.every((e,i)=>e===k.people[i]),sameBuildings:a.buildings.length===k.buildings.length&&a.buildings.every((e,i)=>e===k.buildings[i]),houseHP:k.house.hp,houseMesh:k.house.mesh===k.houseMesh,workerId:k.worker.entityId,order:k.worker.workOrder?.resource,cargo:k.worker.carryAmount,bridges:a.worldLayout.bridgeLevels};});
    const start=await page.evaluate(()=>AETHERIA_API.simulationTime);
    await press('[data-speed="5"]');await page.waitForFunction(t=>AETHERIA_API.simulationTime>=t+.25,start,{timeout:60000});await press('[data-speed="0"]');
    expect((await read()).era).toBe(1);expect((await read()).progress).toBe(100);
    // Set preservation fixtures after pausing. Autonomous delivery/repair during
    // the speed check must not be mistaken for an advancement reset on slow GPUs.
    await page.evaluate(()=>{const k=window.__eraKingdom;Object.assign(k.worker,{carryType:'wood',carryAmount:5});k.house.hp=47;});
    await expect(page.locator('#btn-advance-era')).toHaveAttribute('aria-disabled','false');
    for(const era of [2,3,4]){
      if(era>2)await page.evaluate(()=>{AETHERIA_API.state.civProgress=100;AETHERIA_API.updateHUD();});
      await press('#btn-advance-era');const after=await read();
      expect(after).toMatchObject({era,selected:true,samePeople:true,sameBuildings:true,houseHP:47,houseMesh:true,order:'wood',cargo:5,bridges:[14]});
      await expect(page.locator('#era-top-badge')).toContainText(`ยุคที่ ${era}`);
      await expect(page.locator('#worker-task-bar')).toBeVisible();
    }
    await page.screenshot({path:`test-results/progression-${mobile?'mobile':'desktop'}-retained.png`,animations:'disabled',timeout:90000});
    await expect(page.locator('#command-era-progress')).toHaveText('ยุคสูงสุดแล้ว');
    await press('#btn-menu');await page.getByText('เครื่องมือโลกและยุค',{exact:true}).click();
    await expect(page.locator('#era-dock')).toHaveAttribute('title',/Sandbox/);
    await page.screenshot({path:`test-results/progression-${mobile?'mobile':'desktop'}-sandbox.png`,animations:'disabled',timeout:90000});
    await press('[data-era="2"]');
    expect(await page.evaluate(()=>({era:AETHERIA_API.state.civEra,people:AETHERIA_API.agents.filter(e=>e.alive).length,old:AETHERIA_API.agents.includes(__eraKingdom.worker)}))).toEqual({era:2,people:14,old:false});
    expect(errors).toEqual([]);
  }finally{await context.close();}
});
