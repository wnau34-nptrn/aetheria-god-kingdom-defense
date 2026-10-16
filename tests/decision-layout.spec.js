import {test,expect} from '@playwright/test';

// Controlled presentation matrix. Event effects, resources and simulation time
// are not changed. Separate direct-controls tests exercise real UI playthroughs.
test('all five decisions expose every answer and play-on across four screen sizes',async({page})=>{
 test.setTimeout(240000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.waitForFunction(()=>window.AETHERIA_API);await page.click('[data-speed="0"]');
 for(const viewport of [{width:1024,height:640},{width:390,height:844},{width:844,height:390},{width:400,height:300}]){
  await page.setViewportSize(viewport);
  for(let event=0;event<5;event++){
   await page.evaluate(index=>AETHERIA_API.openInteractiveDilemma(index,true,true),event);
   await page.waitForFunction(()=>{const a=AETHERIA_API,t=a.camCtrl.target,v=a.cameraView.target;return Math.hypot(t.x-v.x,t.y-v.y,t.z-v.z)<1e-6;});
   await expect(page.locator('#decision-card')).toBeVisible();
   await expect.poll(()=>page.locator('#decision-card').evaluate(c=>c.scrollHeight<=c.clientHeight+1),{message:`all controls fit for event ${event+1} at ${viewport.width}x${viewport.height}`}).toBe(true);
   for(const id of ['dl-choice-0','dl-choice-1','dl-choice-2','btn-decision-continue']){
    const button=page.locator(`#${id}`);
    await expect.poll(()=>button.evaluate(b=>{const r=b.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b;}),{message:`${id} is directly reachable for event ${event+1} at ${viewport.width}x${viewport.height}`}).toBe(true);
   }
  }
  await page.screenshot({path:`test-results/decision-layout-${viewport.width}x${viewport.height}.png`,animations:'disabled',timeout:90000});
 }
 expect(errors).toEqual([]);
});
