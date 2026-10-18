import {enableDirectControls} from './helpers/controls-mode.js';
import { test, expect } from '@playwright/test';

test('boots, pauses combat, preserves dilemma speed, changes era and saves progress', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.waitForFunction(()=>window.AETHERIA_API);await enableDirectControls(page);
  await page.evaluate(()=>{AETHERIA_API.state.timeScale=0;});
  const top=await page.locator('#top-bar').boundingBox();
  const hud=await page.locator('#hud-master-control').boundingBox();
  expect(top.x+top.width).toBeLessThanOrEqual(hud.x);
  await page.click('#btn-trigger-dilemma');await page.click('#btn-decision-details');
  if (await page.locator('.event-stories').getAttribute('open') === null) await page.locator('.event-stories > summary').click();
  await page.click('[data-dl-idx="1"]');
  await page.click('#btn-close-dilemma');
  expect(await page.evaluate(()=>AETHERIA_API.state.timeScale)).toBe(0);
  await page.locator('#dl-choice-2').click({force:true});
  // Inspect actual state over rendered animation frames; projectiles and daylight must freeze.
  await page.evaluate(()=>{const a=AETHERIA_API;a.state.timeOfDay=9;a.state.isNight=false;a.state.faith=200;a.spawnMonster(1);a.castMeteorStrike(6,6);});
  const frozen=await page.evaluate(()=>({time:AETHERIA_API.state.timeOfDay,hp:AETHERIA_API.monsters.map(m=>m.hp),projectiles:AETHERIA_API.projectiles.map(p=>[p.x,p.y,p.z])}));
  await page.waitForTimeout(1600);
  expect(await page.evaluate(()=>({time:AETHERIA_API.state.timeOfDay,hp:AETHERIA_API.monsters.map(m=>m.hp),projectiles:AETHERIA_API.projectiles.map(p=>[p.x,p.y,p.z])}))).toEqual(frozen);
  await page.evaluate(()=>{AETHERIA_API.state.civProgress=0;});
  await page.click('button[data-hud-view="city"]');
  await page.locator('#btn-advance-era').click({force:true});
  expect(await page.evaluate(()=>AETHERIA_API.state.civEra)).toBe(1);
  await page.click('#btn-menu');
  await page.getByText('เครื่องมือโลกและยุค', {exact:true}).click();
  await page.click('[data-era="2"]');
  expect(await page.evaluate(()=>AETHERIA_API.state.civEra)).toBe(2);
  await page.screenshot({path:'docs/screenshots/current-desktop.png'});
  await page.click('#btn-save-game');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('AETHERIA_CIV_SAVE_V1')).civEra)).toBe(2);
  await page.reload();await page.waitForFunction(()=>window.AETHERIA_API);await enableDirectControls(page);
  expect(await page.evaluate(()=>AETHERIA_API.state.civEra)).toBe(2);
  await page.evaluate(()=>{AETHERIA_API.state.timeScale=0;Storage.prototype.setItem=()=>{throw new DOMException('Quota exceeded','QuotaExceededError');};});
  await page.click('#btn-menu');
  await page.click('#btn-save-game');
  await expect(page.locator('#dilemma-toast')).toContainText('บันทึกไม่สำเร็จ');
  expect(errors).toEqual([]);
});

test('touch casts exactly once and core mobile HUD stays within viewport',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.AETHERIA_API);await enableDirectControls(page);
  await page.evaluate(()=>{const a=AETHERIA_API;a.state.timeScale=0;a.state.faith=200;a.setGodPower('rain');});
  await page.touchscreen.tap(195,460);
  expect(await page.evaluate(()=>AETHERIA_API.state.faith)).toBe(185);
  await page.evaluate(()=>AETHERIA_API.setGodPower('observe'));
  await page.screenshot({path:'docs/screenshots/current-mobile.png'});
  for(const id of ['#top-bar','#god-dock','#hud-master-control']) {
    const box=await page.locator(id).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(391);
  }
  expect(errors).toEqual([]);await context.close();
});

test('shows a useful startup error when WebGL is unavailable',async({page})=>{
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'||type==='webgl2'?null:original.call(this,type,...args);};});
  await page.goto('/');await expect(page.getByRole('alert')).toContainText('ไม่สามารถเริ่มเกม 3D');
});
