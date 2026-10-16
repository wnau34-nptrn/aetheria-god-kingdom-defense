import {test,expect} from '@playwright/test';
test.use({screenshot:'only-on-failure'});

// Controlled presentation matrix with no funds, and with/without a selected
// worker. No event effects or time jumps. Separate tests use fresh UI-only games.
test('all five decisions expose every answer with worker selection across five screen sizes',async({page})=>{
 test.setTimeout(300000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.waitForFunction(()=>window.AETHERIA_API);await page.click('[data-speed="0"]');
 await page.evaluate(()=>{const a=AETHERIA_API;a.state.faith=a.state.wood=a.state.ore=a.state.food=0;a.updateHUD();});
 for(const viewport of [{width:1024,height:640},{width:800,height:600},{width:390,height:844},{width:844,height:390},{width:400,height:300}]){
  await page.setViewportSize(viewport);
  for(const selected of [false,true]){
   await page.evaluate(selected=>{const a=AETHERIA_API;a.economy.select(selected?a.agents.find(w=>w.alive&&w.role==='villager'):null);},selected);
  for(let event=0;event<5;event++){
   await page.evaluate(index=>AETHERIA_API.openInteractiveDilemma(index,true,true),event);
   await page.waitForFunction(()=>{const a=AETHERIA_API,t=a.camCtrl.target,v=a.cameraView.target;return Math.hypot(t.x-v.x,t.y-v.y,t.z-v.z)<1e-6;});
   await expect(page.locator('#decision-card')).toBeVisible();
   await expect.poll(()=>page.locator('#decision-card').evaluate(c=>c.scrollHeight<=c.clientHeight+1),{message:`all controls fit for event ${event+1} at ${viewport.width}x${viewport.height}, worker selected: ${selected}`}).toBe(true);
   for(const id of ['dl-choice-0','dl-choice-1','dl-choice-2','btn-decision-continue']){
    const button=page.locator(`#${id}`);
    await expect.poll(()=>button.evaluate(b=>{const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&hit?.closest('button')===b?'ready':JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height,viewport:[innerWidth,innerHeight],hit:hit?.outerHTML.slice(0,180),body:document.body.className});}),{message:`${id} is directly reachable for event ${event+1} at ${viewport.width}x${viewport.height}`}).toBe('ready');
   }
  if(viewport.height>540){
   const selectors=['#btn-train-soldier','#btn-spawn-villager','#btn-select-worker','[data-build="house"]','[data-build="tower"]','#btn-advance-era','#btn-zoom-in','#btn-zoom-out','#btn-mob-reset-cam'];
   if(selected)for(const job of ['wood','ore','food','auto'])selectors.push(`[data-worker-resource="${job}"]`);
   for(const selector of selectors)await expect.poll(()=>page.locator(selector).evaluate(b=>{const r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b;}),{message:`${selector} remains directly reachable beside the question at ${viewport.width}x${viewport.height}`}).toBe(true);
  }
  }
  await page.screenshot({path:`test-results/decision-layout-${viewport.width}x${viewport.height}-${selected?'worker':'normal'}.png`,animations:'disabled',timeout:90000});
  }
 }
 expect(errors).toEqual([]);
});
