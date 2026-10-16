import {test,expect} from '@playwright/test';

for(const viewport of [{width:400,height:300},{width:390,height:844}]){
 test(`failed powers explain cost and mute survives actions at ${viewport.width}x${viewport.height}`,async({browser})=>{
  const mobile=viewport.height>500;
  const context=await browser.newContext({viewport,hasTouch:mobile,isMobile:mobile});
  try{
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   // Observe real audio nodes without replacing Web Audio or changing game state.
   await page.addInitScript(()=>{const original=AudioContext.prototype.createGain;window.observedAudioGains=[];AudioContext.prototype.createGain=function(...args){const gain=original.apply(this,args);window.observedAudioGains.push(gain);return gain;};});
   const press=async selector=>mobile?page.locator(selector).tap():page.locator(selector).click();
   await page.goto(process.env.PLAYTEST_URL||'http://127.0.0.1:5173');await page.waitForFunction(()=>window.AETHERIA_API);
   await press('[data-speed="0"]');await press('[data-power="rain"]');
   const start=await page.evaluate(()=>AETHERIA_API.state.faith);
   const point={x:viewport.width/2,y:viewport.height*.55};
   const cast=()=>mobile?page.touchscreen.tap(point.x,point.y):page.mouse.click(point.x,point.y);
   await cast();await cast();
   expect(await page.evaluate(()=>AETHERIA_API.state.faith)).toBeCloseTo(start-30,5);
   await press('#btn-menu');await expect(page.locator('#btn-toggle-audio')).toHaveAttribute('aria-pressed','true');
   await press('#btn-toggle-audio');await expect(page.locator('#btn-toggle-audio')).toHaveAttribute('aria-pressed','false');await press('#game-menu [data-close-drawer]');
   await page.waitForTimeout(800);
   const gains=()=>page.evaluate(()=>observedAudioGains.slice(0,2).map(g=>g.gain.value));
   for(const gain of await gains())expect(gain).toBeLessThan(.0002);
   await press('[data-power="meteor"]');const before=await page.evaluate(()=>({faith:AETHERIA_API.state.faith,shots:AETHERIA_API.projectiles.length}));await cast();
   await expect(page.locator('#dilemma-toast')).toHaveClass(/visible/);await expect(page.getByRole('status').filter({hasText:'ศรัทธาไม่พอ'})).toContainText('35');
   expect(await page.evaluate(()=>({faith:AETHERIA_API.state.faith,shots:AETHERIA_API.projectiles.length}))).toEqual(before);
   const notice=await page.locator('#dilemma-toast').boundingBox(),resources=await page.locator('#kingdom-readout').boundingBox(),camera=await page.locator('#mobile-cam-controls').boundingBox();
   expect(notice.y+notice.height).toBeLessThanOrEqual(resources.y);expect(notice.x+notice.width).toBeLessThanOrEqual(camera.x);
   await page.screenshot({path:`test-results/action-feedback-${viewport.width}x${viewport.height}.png`,animations:'disabled',timeout:90000});
   await page.waitForTimeout(800);for(const gain of await gains())expect(gain).toBeLessThan(.0002);
   await press('#btn-menu');await expect(page.locator('#btn-toggle-audio')).toHaveText('🔇 เสียง: ปิด');await expect(page.locator('#btn-toggle-audio')).toHaveAttribute('aria-pressed','false');
   const nodes=await page.evaluate(()=>observedAudioGains.length);await press('#btn-ring-bell');expect(await page.evaluate(()=>observedAudioGains.length)).toBe(nodes);
   await press('#btn-toggle-audio');await expect(page.locator('#btn-toggle-audio')).toHaveAttribute('aria-pressed','true');await page.waitForTimeout(500);for(const gain of await gains())expect(gain).toBeGreaterThan(.03);
   expect(errors).toEqual([]);
  }finally{await context.close();}
 });
}

test('empty-city guidance leads to the existing recovery action',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(process.env.PLAYTEST_URL||'/');await page.waitForFunction(()=>window.AETHERIA_API);await page.click('[data-speed="0"]');
 // Controlled empty-city fixture. Natural overnight losses are recorded by the
 // separate day/night driver; no resources or clock are granted here.
 await page.evaluate(()=>{for(const a of AETHERIA_API.agents){a.alive=false;a.mesh.visible=false;}AETHERIA_API.updateHUD();});
 await expect(page.locator('#night-guidance')).toContainText('เพิ่มชาวบ้าน');
 await page.screenshot({path:'test-results/empty-city-recovery.png',animations:'disabled',timeout:90000});
 const faith=await page.evaluate(()=>AETHERIA_API.state.faith);await page.click('#btn-toggle-left-hud');await page.click('#btn-spawn-villager');
 await expect(page.locator('#quick-pop')).toHaveText('1');expect(await page.evaluate(()=>AETHERIA_API.state.faith)).toBeCloseTo(faith-20,5);await expect(page.locator('#night-guidance')).not.toContainText('ฟื้นเมือง');
});
