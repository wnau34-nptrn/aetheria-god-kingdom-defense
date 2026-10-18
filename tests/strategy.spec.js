import {test,expect} from '@playwright/test';

function battleFixture(){
 const a=AETHERIA_API;a.state.timeScale=0;Object.assign(a.state,{timeOfDay:21,isNight:true,siegeTriggeredTonight:true,secondWaveTonight:true});
 for(const p of [{x:24,z:-8},{x:58,z:-40}]){a.spawnMonster(1);const m=a.monsters.at(-1);Object.assign(m,{...p,hp:5000,maxHp:5000,speed:0,dmg:0});m.mesh.position.set(m.x,_getTerrainHeightAt(m.x,m.z),m.z);}
 a.updateHUD();
}
async function hits(page,selectors){
 return page.evaluate(selectors=>selectors.filter(s=>{const b=document.querySelector(s);if(!b)return true;const r=b.getBoundingClientRect();return r.top<0||r.left<0||r.right>innerWidth+1||r.bottom>innerHeight+1||!b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),selectors);
}

for(const mobile of [false,true])test(`decisions dispatch workers and a retargeting army without selection on ${mobile?'touch':'desktop'}`,async({browser})=>{
 test.setTimeout(360000);
 const size=mobile?{width:390,height:844}:{width:1280,height:800},context=await browser.newContext({viewport:size,hasTouch:mobile,isMobile:mobile});
 try{
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const press=s=>mobile?page.locator(s).tap():page.locator(s).click();
  await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.AETHERIA_API);await press('[data-speed="0"]');
  await expect(page.locator('body')).toHaveClass(/strategy-mode/);await expect(page.locator('#btn-select-army')).toBeHidden();await expect(page.locator('#btn-select-worker')).toBeHidden();
  const read=()=>page.evaluate(()=>{const a=AETHERIA_API;return {selected:a.state.selectedEntity?.entityId||null,wood:a.state.wood,faith:a.state.faith,plan:a.strategy.snapshot,time:a.simulationTime,camera:{...a.camCtrl.target}};});
  const start=await read();await press('[data-strategy-action="wood"]');let s=await read();expect(s.selected).toBe(null);expect(s.faith).toBe(start.faith);expect(s.camera).toEqual(start.camera);expect(s.plan.city).toBe('wood');expect(s.plan.cityCount).toBeGreaterThan(0);
  await expect(page.locator('#worker-task-bar')).toBeHidden();await expect(page.locator('#construction-bar')).toBeHidden();
  await page.screenshot({path:`test-results/strategy-${mobile?'mobile':'desktop'}-city.png`,animations:'disabled',timeout:90000});
  // The waiting viewport reduces software raster work; command/screenshots use size.
  if(!mobile)await page.setViewportSize({width:400,height:300});
  await press('[data-speed="5"]');await page.waitForFunction(stock=>AETHERIA_API.state.wood>=stock+5,start.wood,{timeout:150000});await press('[data-speed="0"]');
  if(!mobile)await page.setViewportSize(size);
  await page.evaluate(battleFixture);await expect(page.locator('[data-strategy-action="attack"]')).toBeVisible();
  const battleStart=await read();await press('[data-strategy-action="attack"]');s=await read();expect(s.selected).toBe(null);expect(s.plan.military).toBe('attack');expect(s.faith).toBe(battleStart.faith);expect(s.camera).toEqual(battleStart.camera);
  expect(await page.evaluate(()=>AETHERIA_API.agents.filter(a=>a.alive&&a.role==='soldier').every(a=>a.armyOrder?.kind==='attack'))).toBe(true);
  const oldTarget=s.plan.target;await page.evaluate(()=>{AETHERIA_API.monsters[0].alive=false;});
  await press('[data-speed="5"]');await page.waitForFunction(old=>AETHERIA_API.strategy.snapshot.target!==old&&!!AETHERIA_API.strategy.snapshot.target,oldTarget,{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#strategy-panel [data-strategy-action="soldier"]').getAttribute('aria-disabled')==='false',null,{timeout:90000});await press('[data-speed="0"]');
  const beforeRecruit=await read();await press('#strategy-panel [data-strategy-action="soldier"]');s=await read();expect(s.faith).toBeCloseTo(beforeRecruit.faith-25,4);expect(s.plan.armyCount).toBe(beforeRecruit.plan.armyCount+1);expect(s.selected).toBe(null);
  expect(await page.evaluate(()=>AETHERIA_API.agents.filter(a=>a.alive&&a.role==='soldier').every(a=>a.armyOrder?.kind==='attack'))).toBe(true);
  await press('[data-strategy-action="retreat"]');
  const before=await page.evaluate(()=>({time:AETHERIA_API.simulationTime,units:AETHERIA_API.agents.filter(a=>a.alive&&a.role==='soldier').map(a=>({id:a.entityId,d:Math.hypot(a.x-a.armyOrder.slotX,a.z-a.armyOrder.slotZ)}))}));
  await press('[data-speed="5"]');await page.waitForFunction(t=>AETHERIA_API.simulationTime>=t+2,before.time,{timeout:90000});await press('[data-speed="0"]');
  expect(await page.evaluate(units=>AETHERIA_API.agents.filter(a=>a.alive&&a.role==='soldier').some(a=>Math.hypot(a.x-a.armyOrder.slotX,a.z-a.armyOrder.slotZ)<units.find(u=>u.id===a.entityId).d),before.units)).toBe(true);
  await page.screenshot({path:`test-results/strategy-${mobile?'mobile':'desktop'}-battle.png`,animations:'disabled',timeout:90000});
  await press('button[data-hud-view="city"]');await press('#resource-ore');await press('#btn-economy-worker');expect((await read()).plan.city).toBe('ore');expect((await read()).selected).toBe(null);expect((await read()).plan.military).toBe('retreat');
  await press('button[data-hud-view="battle"]');await press('[data-speed="1"]');const beforeQuestion=await read();await press('#btn-trigger-dilemma');expect(await page.evaluate(()=>AETHERIA_API.state.timeScale)).toBe(1);expect((await read()).camera).toEqual(beforeQuestion.camera);
  expect(await hits(page,['#dl-choice-0','#dl-choice-1','#dl-choice-2','[data-strategy-action="guard"]','[data-strategy-action="attack"]','[data-strategy-action="retreat"]','[data-speed="0"]'])).toEqual([]);
  await page.screenshot({path:`test-results/strategy-${mobile?'mobile':'desktop'}-question.png`,animations:'disabled',timeout:90000});await press('[data-speed="0"]');expect(errors).toEqual([]);
 }finally{await context.close();}
});

test('small landscape exposes contextual battle and event choices together',async({page})=>{
 await page.setViewportSize({width:400,height:300});await page.goto('/');await page.waitForFunction(()=>window.AETHERIA_API);await page.click('[data-speed="0"]');await page.evaluate(battleFixture);
 expect(await hits(page,['[data-strategy-action="guard"]','[data-strategy-action="attack"]','[data-strategy-action="retreat"]','[data-speed="0"]','button[data-hud-view="city"]'])).toEqual([]);
 await page.click('#btn-trigger-dilemma');
 await page.screenshot({path:'test-results/strategy-small-landscape.png',animations:'disabled',timeout:90000});
 expect(await hits(page,['#dl-choice-0','#dl-choice-1','#dl-choice-2','[data-strategy-action="guard"]','[data-strategy-action="attack"]','[data-strategy-action="retreat"]','[data-speed="0"]','button[data-hud-view="city"]'])).toEqual([]);
 await page.click('[data-strategy-action="retreat"]');expect(await page.evaluate(()=>AETHERIA_API.strategy.snapshot.military)).toBe('retreat');expect(await page.evaluate(()=>AETHERIA_API.state.selectedEntity)).toBe(null);
});
