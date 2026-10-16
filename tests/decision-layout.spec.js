import { test, expect } from '@playwright/test';

// A controlled no-funds presentation matrix. Separate direct-controls tests
// exercise fresh UI-only games; these fixtures apply no event effects or time jumps.
function hitState(button) {
  const rect = button.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2);
  if (rect.x>=0 && rect.y>=0 && rect.right<=innerWidth+1 && rect.bottom<=innerHeight+1 && hit?.closest('button')===button) return 'ready';
  const card=document.getElementById('decision-card'), dock=document.getElementById('god-dock-wrapper');
  return JSON.stringify({button:{id:button.id,build:button.dataset.build,rect:rect.toJSON()},hit:hit?.outerHTML.slice(0,260),
    card:{rect:card.getBoundingClientRect().toJSON(),scroll:card.scrollHeight,client:card.clientHeight,max:getComputedStyle(card).maxHeight},
    dock:dock.getBoundingClientRect().toJSON(),dockVar:getComputedStyle(document.documentElement).getPropertyValue('--power-dock-height'),viewport:[innerWidth,innerHeight],body:document.body.className});
}

test('all five decisions expose every answer with worker selection across five screen sizes', async ({page})=>{
  test.setTimeout(300000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto('/');await page.waitForFunction(()=>window.AETHERIA_API);await page.click('[data-speed="0"]');
    expect(await page.evaluate(()=>(()=>{const faces=[...document.fonts].filter(f=>f.family.includes('Aetheria Thai'));return faces.length===4&&faces.every(f=>f.status==='loaded');})())).toBe(true);
    await page.evaluate(()=>{const a=AETHERIA_API;a.state.faith=a.state.wood=a.state.ore=a.state.food=0;a.updateHUD();});
    for(const viewport of [{width:1024,height:640},{width:800,height:600},{width:390,height:844},{width:844,height:390},{width:400,height:300}]){
      await page.setViewportSize(viewport);
      for(const selected of [false,true]){
        await page.evaluate(selected=>{const a=AETHERIA_API;a.economy.select(selected?a.agents.find(w=>w.alive&&w.role==='villager'):null);},selected);
        for(let event=0;event<5;event++){
          await page.evaluate(index=>AETHERIA_API.openInteractiveDilemma(index,true,true),event);
          await page.waitForFunction(()=>{const a=AETHERIA_API,t=a.camCtrl.target,v=a.cameraView.target;return Math.hypot(t.x-v.x,t.y-v.y,t.z-v.z)<1e-6;});
          await expect(page.locator('#decision-card')).toBeVisible();
          await expect.poll(()=>page.locator('#decision-card').evaluate(card=>card.scrollHeight<=card.clientHeight+1?'fits':JSON.stringify({rect:card.getBoundingClientRect().toJSON(),scroll:card.scrollHeight,client:card.clientHeight,max:getComputedStyle(card).maxHeight,font:getComputedStyle(card).fontFamily,dockVar:getComputedStyle(document.documentElement).getPropertyValue('--power-dock-height'),viewport:[innerWidth,innerHeight],body:document.body.className})),{message:`all controls fit for event ${event+1} at ${viewport.width}x${viewport.height}, selected ${selected}`}).toBe('fits');
          const selectors=['#dl-choice-0','#dl-choice-1','#dl-choice-2','#btn-decision-continue'];
          if(viewport.height>540){
            selectors.push('#btn-train-soldier','#btn-spawn-villager','#btn-select-worker','[data-build="house"]','[data-build="tower"]','#btn-advance-era','#btn-zoom-in','#btn-zoom-out','#btn-mob-reset-cam');
            if(selected)for(const job of ['wood','ore','food','auto'])selectors.push(`[data-worker-resource="${job}"]`);
          }
          for(const selector of selectors)await expect.poll(()=>page.locator(selector).evaluate(hitState),{message:`${selector} receives input for event ${event+1}, selected ${selected}, at ${viewport.width}x${viewport.height}`}).toBe('ready');
        }
        await page.screenshot({path:`test-results/decision-layout-${viewport.width}x${viewport.height}-${selected?'worker':'normal'}.png`,animations:'disabled',timeout:90000});
      }
    }
    expect(errors).toEqual([]);
  } catch(error) {
    try {
      console.log('LAYOUT_DIAGNOSTIC',await page.evaluate(()=>({font:getComputedStyle(document.body).fontFamily,fonts:document.fonts.status,viewport:[innerWidth,innerHeight],card:document.getElementById('decision-card').getBoundingClientRect().toJSON(),dock:document.getElementById('god-dock-wrapper').getBoundingClientRect().toJSON(),dockVar:getComputedStyle(document.documentElement).getPropertyValue('--power-dock-height')})));
      await page.screenshot({path:'test-results/decision-layout-collision.png',animations:'disabled',timeout:60000});
    } catch(captureError) { console.log('LAYOUT_CAPTURE_ERROR',String(captureError)); }
    throw error;
  }
});
