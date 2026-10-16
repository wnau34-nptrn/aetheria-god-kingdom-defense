import { test, expect } from '@playwright/test';
import { installCombatFixture } from './helpers/combat-fixture.js';

test('a rendered duel connects windup, contact, recoil and a paused falling body',async({page})=>{
  test.setTimeout(240000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.waitForFunction(()=>window.AETHERIA_API);await page.click('[data-speed="0"]');
  const before=await page.evaluate(installCombatFixture);
  await page.click('[data-speed="1"]');
  await page.waitForFunction(()=>{const a=AETHERIA_API;if(a.agents[0].combat?.phase==='windup'){a.state.timeScale=0;return true;}},null,{timeout:60000});
  expect(await page.evaluate(()=>AETHERIA_API.monsters[0].hp)).toBe(500);
  await page.screenshot({path:'test-results/combat-duel-windup.png',animations:'disabled',timeout:90000});
  await page.click('[data-speed="1"]');
  await page.waitForFunction(contacts=>{const a=AETHERIA_API;if(a.combatFeedback.contacts>contacts){a.state.timeScale=0;return true;}},before.contacts,{timeout:60000});
  const contact=await page.evaluate(()=>{const a=AETHERIA_API;return {hp:a.monsters[0].hp,phase:a.agents[0].combat.phase,distance:Math.hypot(a.agents[0].x-a.monsters[0].x,a.agents[0].z-a.monsters[0].z),feedback:a.combatFeedback};});
  expect(contact.hp).toBe(476);expect(contact.phase).toBe('strike');expect(contact.distance).toBeGreaterThan(1.4);expect(contact.feedback.impacts).toBeGreaterThan(0);
  await page.screenshot({path:'test-results/combat-duel-contact.png',animations:'disabled',timeout:90000});
  await page.evaluate(()=>{window.__fallen=AETHERIA_API.monsters[0];window.__fallen.hp=24;});
  await page.click('[data-speed="1"]');
  await page.waitForFunction(falls=>{const a=AETHERIA_API;if(a.combatFeedback.falls>falls&&!window.__fallAt)window.__fallAt=a.simulationTime;if(window.__fallAt&&a.simulationTime>=window.__fallAt+.3){a.state.timeScale=0;return true;}},before.falls,{timeout:60000});
  const fall=await page.evaluate(()=>({alive:__fallen.alive,parent:!!__fallen.mesh.parent,tilt:__fallen.mesh.rotation.z,feedback:AETHERIA_API.combatFeedback}));
  expect(fall.alive).toBe(false);expect(fall.parent).toBe(true);expect(Math.abs(fall.tilt)).toBeGreaterThan(.2);
  await page.waitForTimeout(350);expect(await page.evaluate(()=>__fallen.mesh.rotation.z)).toBe(fall.tilt);
  await page.screenshot({path:'test-results/combat-duel-fall.png',animations:'disabled',timeout:90000});
  await page.click('[data-speed="1"]');await page.waitForFunction(()=>!__fallen.mesh.parent,null,{timeout:60000});await page.click('[data-speed="0"]');
  expect(errors).toEqual([]);
});

test('a touch-sized group battle shows bounded feedback and leaves commands clickable',async({browser})=>{
  test.setTimeout(240000);
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.AETHERIA_API);await page.locator('[data-speed="0"]').tap();
    const before=await page.evaluate(installCombatFixture,{group:true});
    await page.locator('[data-speed="1"]').tap();
    await page.waitForFunction(contacts=>{const a=AETHERIA_API;if(a.combatFeedback.contacts>=contacts+5){a.state.timeScale=0;return true;}},before.contacts,{timeout:60000});
    const snapshot=await page.evaluate(()=>({time:AETHERIA_API.simulationTime,feedback:AETHERIA_API.combatFeedback,hp:AETHERIA_API.agents.map(e=>e.hp)}));
    expect(snapshot.feedback.labels).toBeLessThanOrEqual(16);expect(snapshot.feedback.impacts).toBeLessThanOrEqual(12);
    expect(snapshot.hp.some(hp=>hp<160)).toBe(true);
    expect(await page.locator('#combat-feedback').evaluate(c=>getComputedStyle(c).pointerEvents)).toBe('none');
    await page.screenshot({path:'test-results/combat-group-mobile.png',animations:'disabled',timeout:90000});
    await page.locator('[data-power="lightning"]').tap();expect(await page.evaluate(()=>AETHERIA_API.state.activePower)).toBe('lightning');
    expect(await page.evaluate(()=>AETHERIA_API.simulationTime)).toBe(snapshot.time);
    expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('a fresh kingdom reaches actual night combat through normal player controls',async({page})=>{
  test.setTimeout(240000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.waitForFunction(()=>window.AETHERIA_API);await page.click('[data-speed="0"]');
  await page.click('#btn-train-soldier');await page.click('#btn-train-soldier');
  await page.click('#btn-menu');await page.getByText('เครื่องมือโลกและยุค',{exact:true}).click();await page.click('#btn-jump-night');await page.click('#btn-menu');
  await page.click('[data-speed="5"]');
  await page.waitForFunction(()=>AETHERIA_API.combatFeedback.contacts>=3,null,{timeout:120000});await page.click('[data-speed="0"]');
  const result=await page.evaluate(()=>({feedback:AETHERIA_API.combatFeedback,wounded:AETHERIA_API.agents.some(e=>e.hp<e.maxHp)||AETHERIA_API.monsters.some(e=>e.hp<e.maxHp)}));
  expect(result.wounded).toBe(true);
  await page.screenshot({path:'test-results/combat-natural-night.png',animations:'disabled',timeout:90000});
  expect(errors).toEqual([]);
});
