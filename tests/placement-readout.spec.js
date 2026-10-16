import { test, expect } from '@playwright/test';

async function boot(page) {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.waitForFunction(() => window.AETHERIA_API);
  await page.click('[data-speed="0"]'); await page.click('#btn-toggle-bubbles');
  for (const side of ['left', 'right']) {
    if (await page.locator(`#btn-toggle-${side}-hud`).evaluate(e => e.classList.contains('active'))) await page.click(`#btn-toggle-${side}-hud`);
  }
  return errors;
}

// Read-only world-to-screen projection; casting still uses actual pointer/touch input.
async function candidates(page, reason) {
  return page.evaluate(reason => {
    const a = AETHERIA_API, c = a.camCtrl, t = c.target, r = c.radius;
    const eye = [t.x + r * Math.sin(c.phi) * Math.sin(c.theta), t.y + r * Math.cos(c.phi), t.z + r * Math.sin(c.phi) * Math.cos(c.theta)];
    const f = [t.x-eye[0],t.y-eye[1],t.z-eye[2]], fl=Math.hypot(...f); f.forEach((v,i)=>f[i]=v/fl);
    const right=[-f[2],0,f[0]], rl=Math.hypot(...right);right.forEach((v,i)=>right[i]=v/rl);
    const up=[right[1]*f[2]-right[2]*f[1],right[2]*f[0]-right[0]*f[2],right[0]*f[1]-right[1]*f[0]];
    const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0), points=[];
    for(let x=-35;x<=35;x+=1) for(let z=-35;z<=35;z+=1) {
      const issue=a.getBuildingPlacementIssue(x,z);
      if(reason ? !issue?.includes(reason) : issue) continue;
      const p=[x-eye[0],_getTerrainHeightAt(x,z)-eye[1],z-eye[2]], depth=dot(p,f), tan=Math.tan(24*Math.PI/180);
      const sx=(dot(p,right)/(depth*tan*innerWidth/innerHeight)+1)*innerWidth/2;
      const sy=(1-dot(p,up)/(depth*tan))*innerHeight/2;
      if(depth>0&&sx>15&&sy>120&&sx<innerWidth-15&&sy<innerHeight-165&&document.elementFromPoint(sx,sy)?.id==='game-canvas') points.push({x:sx,y:sy});
    }
    return points;
  }, reason);
}
async function aim(page, reason = null) {
  for (const p of await candidates(page, reason)) {
    await page.mouse.move(p.x, p.y);
    const text = await page.locator('#placement-feedback').textContent();
    if (reason ? text.includes(reason) : text.includes('วางหอคอยได้')) return p;
  }
  throw new Error(`No reachable plot for ${reason ?? 'ready'}`);
}

test('desktop preview explains blockers, builds via pointer, and clears when switching powers', async ({ page }) => {
  const errors = await boot(page);
  await page.keyboard.press('Digit6');
  for(const reason of ['แม่น้ำ','ถนน','ลาดชัน','ใกล้อาคาร']) {
    const p = await aim(page, reason);
    const before=await page.evaluate(()=>({faith:AETHERIA_API.state.faith,count:AETHERIA_API.buildings.length}));
    await page.mouse.click(p.x,p.y);
    expect(await page.evaluate(()=>({faith:AETHERIA_API.state.faith,count:AETHERIA_API.buildings.length}))).toEqual(before);
  }
  await page.screenshot({path:'docs/readability-review/desktop-blocked.png'});
  const p=await aim(page);
  await page.screenshot({path:'docs/readability-review/desktop-ready.png'});
  const before=await page.evaluate(()=>({faith:AETHERIA_API.state.faith,count:AETHERIA_API.buildings.length}));
  await page.mouse.click(p.x,p.y);
  expect(await page.evaluate(()=>({faith:AETHERIA_API.state.faith,count:AETHERIA_API.buildings.length}))).toEqual({faith:before.faith-25,count:before.count+1});
  await expect(page.locator('#placement-feedback')).toContainText('ใกล้อาคาร');
  await expect(page.locator('#quick-faith')).toHaveText(`${Math.floor(before.faith-25)}`);
  await page.keyboard.press('Digit1'); await expect(page.locator('#placement-feedback')).toBeHidden();
  expect(errors).toEqual([]);
});

for (const viewport of [{width:390,height:844},{width:400,height:300},{width:844,height:390}]) {
  test(`essential readout fits with side panels tucked at ${viewport.width}x${viewport.height}`, async ({page})=>{
    await page.setViewportSize(viewport); const errors=await boot(page);
    for(const id of ['#kingdom-readout','#quick-faith','#quick-food','#quick-pop','#quick-enemies','#god-dock']) {
      const b=await page.locator(id).boundingBox(); expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(viewport.width);expect(b.y+b.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.screenshot({path:`docs/readability-review/hud-${viewport.width}x${viewport.height}.png`});
    const camera=await page.locator('#mobile-cam-controls').boundingBox();
    const summary=await page.locator('#kingdom-readout').boundingBox();
    expect(camera.y+camera.height).toBeLessThanOrEqual(summary.y);
    if(viewport.height<=500) {
      const eras=await page.locator('#era-dock').boundingBox();
      expect(camera.y).toBeGreaterThanOrEqual(eras.y+eras.height);
    }
    await page.keyboard.press('KeyH');
    // H hides the containing dock, including its resources and placement prompt.
    await expect(page.locator('#god-dock-wrapper')).toHaveCSS('opacity','0');
    await page.keyboard.press('KeyH'); await expect(page.locator('#god-dock-wrapper')).toHaveCSS('opacity','1');
    expect(errors).toEqual([]);
  });
}

test('touch previews before release, builds once, and a pinch cancels placement', async ({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage(); const errors=await boot(page);
  await page.keyboard.press('Digit6'); const p=await aim(page);
  const session=await context.newCDPSession(page);
  const before=await page.evaluate(()=>({faith:AETHERIA_API.state.faith,count:AETHERIA_API.buildings.length}));
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:1}]});
  expect(await page.evaluate(()=>AETHERIA_API.buildings.length)).toBe(before.count);
  await expect(page.locator('#placement-feedback')).toContainText('วางหอคอยได้');
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(await page.evaluate(()=>({faith:AETHERIA_API.state.faith,count:AETHERIA_API.buildings.length}))).toEqual({faith:before.faith-25,count:before.count+1});
  const q=await aim(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:q.x,y:q.y,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:q.x,y:q.y,id:1},{x:q.x+20,y:q.y+20,id:2}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(await page.evaluate(()=>AETHERIA_API.buildings.length)).toBe(before.count+1);
  const dock=await page.locator('#god-dock').boundingBox();
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:q.x,y:q.y,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:dock.x+15,y:dock.y+15,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(await page.evaluate(()=>AETHERIA_API.buildings.length)).toBe(before.count+1);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:q.x,y:q.y,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  expect(await page.evaluate(()=>AETHERIA_API.buildings.length)).toBe(before.count+1);
  expect(errors).toEqual([]);await context.close();
});
