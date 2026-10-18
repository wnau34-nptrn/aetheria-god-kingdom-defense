import {enableDirectControls} from './helpers/controls-mode.js';
import {test,expect} from '@playwright/test';

function fixture(){
  const a=AETHERIA_API;a.state.timeScale=0;
  Object.assign(a.state,{timeOfDay:21,isNight:true,siegeTriggeredTonight:true,secondWaveTonight:true});
  a.agents.filter(u=>u.alive&&u.role==='soldier').forEach((u,i)=>{u.x=20+i*3;u.z=-8;u.mesh.position.set(u.x,_getTerrainHeightAt(u.x,u.z),u.z);});
  a.spawnMonster(1);Object.assign(a.monsters.at(-1),{x:70,z:-48,hp:5000,maxHp:5000,speed:0});
  const c=a.camCtrl;c.followEntity=null;c.target.set(24,_getTerrainHeightAt(24,0)+1,0);c.radius=c.targetRadius=65;c.theta=c.targetTheta=.7;c.phi=c.targetPhi=.9;
  a.updateHUD();
}

function targetPoints(){
  const a=AETHERIA_API,v=a.cameraView,eye=[v.position.x,v.position.y,v.position.z],t=[v.target.x,v.target.y,v.target.z];
  const f=t.map((x,i)=>x-eye[i]),length=Math.hypot(...f);f.forEach((x,i)=>f[i]=x/length);
  const right=[-f[2],0,f[0]],rl=Math.hypot(...right);right.forEach((x,i)=>right[i]=x/rl);
  const up=[right[1]*f[2]-right[2]*f[1],right[2]*f[0]-right[0]*f[2],right[0]*f[1]-right[1]*f[0]],dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),tan=Math.tan(v.fov*Math.PI/360),points=[];
  for(let x=8;x<=44;x+=2)for(let z=-16;z<=24;z+=2){
    if(a.getBuildingPlacementIssue(x,z))continue;
    const delta=[x-eye[0],_getTerrainHeightAt(x,z)-eye[1],z-eye[2]],depth=dot(delta,f);
    if(depth<=0)continue;
    const px=(dot(delta,right)/(depth*tan*innerWidth/innerHeight)+1)*innerWidth/2,py=(1-dot(delta,up)/(depth*tan))*innerHeight/2;
    if(px>15&&px<innerWidth-15&&py>145&&py<innerHeight-15&&document.elementFromPoint(px,py)?.id==='game-canvas')points.push({x:px,y:py,score:Math.hypot(x-24,z)});
  }
  return points.sort((a,b)=>a.score-b.score);
}

for(const mobile of [false,true])test(`RTS commands, battle HUD and live decisions work through ${mobile?'touch':'mouse'} controls`,async({browser})=>{
  test.setTimeout(300000);
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},hasTouch:mobile,isMobile:mobile});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const press=s=>mobile?page.locator(s).tap():page.locator(s).click();
    await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.AETHERIA_API);await enableDirectControls(page);await press('[data-speed="0"]');
    await press('#btn-train-soldier');await page.evaluate(fixture);
    await expect(page.locator('body')).toHaveAttribute('data-hud-view','battle');
    await press('#btn-select-army');expect(await page.evaluate(()=>AETHERIA_API.army.snapshot.selected.length)).toBe(3);
    await expect(page.locator('#inspector-card')).toBeHidden();
    await page.screenshot({path:`test-results/army-${mobile?'mobile':'desktop'}-commands.png`,animations:'disabled',timeout:90000});
    expect(await page.evaluate(selectors=>selectors.filter(s=>{const b=document.querySelector(s),r=b.getBoundingClientRect();return !(r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)));}),['#btn-train-soldier','#btn-spawn-villager','[data-build="tower"]','#btn-select-army',...['rally','move','hold','attack','retreat','auto'].map(k=>`[data-army-order="${k}"]`)])).toEqual([]);
    if(!mobile){
      const ids=await page.evaluate(()=>AETHERIA_API.army.snapshot.selected),p=(await page.evaluate(targetPoints))[0];expect(p).toBeTruthy();
      await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+30,p.y-20,{steps:3});await page.mouse.up();
      expect(await page.evaluate(()=>AETHERIA_API.army.snapshot.selected)).toEqual(ids);
    }
    await press('[data-army-order="hold"]');await expect(page.locator('#army-aim')).toBeVisible();
    await page.waitForFunction(()=>{const a=AETHERIA_API,c=a.camCtrl;return Math.hypot(c.target.x-a.cameraView.target.x,c.target.z-a.cameraView.target.z)<.001&&Math.abs(c.theta-c.targetTheta)<.001&&Math.abs(c.phi-c.targetPhi)<.001;});
    const faith=await page.evaluate(()=>AETHERIA_API.state.faith),points=await page.evaluate(targetPoints);expect(points.length).toBeGreaterThan(0);
    for(const p of points.slice(0,10)){if(mobile)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);if(!await page.evaluate(()=>AETHERIA_API.army.awaiting))break;}
    expect(await page.evaluate(()=>AETHERIA_API.army.selected().every(u=>u.armyOrder?.kind==='hold'))).toBe(true);
    expect(await page.evaluate(()=>AETHERIA_API.state.faith)).toBe(faith);
    const camera=await page.evaluate(()=>({...AETHERIA_API.camCtrl.target}));
    await press('button[data-hud-view="city"]');await expect(page.locator('[data-build="house"]')).toBeVisible();
    expect(await page.evaluate(()=>({...AETHERIA_API.camCtrl.target}))).toEqual(camera);
    await press('button[data-hud-view="battle"]');
    await press('[data-army-order="retreat"]');
    const before=await page.evaluate(()=>{const u=AETHERIA_API.army.selected()[0];return {time:AETHERIA_API.simulationTime,distance:Math.hypot(u.x-u.armyOrder.slotX,u.z-u.armyOrder.slotZ)};});
    await press('[data-speed="5"]');await page.waitForFunction(t=>AETHERIA_API.simulationTime>=t+2,before.time,{timeout:90000});await press('[data-speed="0"]');
    expect(await page.evaluate(()=>{const u=AETHERIA_API.army.selected()[0];return Math.hypot(u.x-u.armyOrder.slotX,u.z-u.armyOrder.slotZ);})).toBeLessThan(before.distance);
    await press('#btn-battle-focus');await expect(page.locator('#btn-return-city')).toBeVisible();await press('#btn-return-city');
    expect(await page.evaluate(()=>({...AETHERIA_API.camCtrl.target}))).toEqual(camera);
    await press('[data-speed="1"]');const eventCamera=await page.evaluate(()=>({...AETHERIA_API.camCtrl.target}));
    await press('#btn-trigger-dilemma');expect(await page.evaluate(()=>AETHERIA_API.state.timeScale)).toBe(1);
    expect(await page.evaluate(()=>({...AETHERIA_API.camCtrl.target}))).toEqual(eventCamera);
    await page.screenshot({path:`test-results/army-${mobile?'mobile':'desktop'}-decision.png`,animations:'disabled',timeout:90000});
    expect(await page.evaluate(()=>[0,1,2].every(i=>{const b=document.getElementById(`dl-choice-${i}`),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}))).toBe(true);
    await press('#dl-choice-2');await press('[data-speed="0"]');expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('battle controls remain reachable on a small landscape display',async({page})=>{
  await page.setViewportSize({width:400,height:300});await page.goto('/');await page.waitForFunction(()=>window.AETHERIA_API);await enableDirectControls(page);await page.click('[data-speed="0"]');await page.evaluate(fixture);await page.click('#btn-select-army');
  await page.screenshot({path:'test-results/army-landscape.png',animations:'disabled',timeout:90000});
  expect(await page.locator('#hud-view-bar').evaluate(b=>b.getBoundingClientRect().top>=document.getElementById('top-bar').getBoundingClientRect().bottom+2)).toBe(true);
  for(const selector of ['#btn-select-army','[data-army-order="hold"]','[data-army-order="retreat"]','button[data-hud-view="city"]','[data-speed="0"]']){
    expect(await page.locator(selector).evaluate(b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  }
});
