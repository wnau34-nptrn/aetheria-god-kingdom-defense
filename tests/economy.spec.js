import {test,expect} from '@playwright/test';

// These playthroughs use real UI input and read-only world snapshots for aiming.
// No resource grants, entity teleports, clock jumps or API commands are used.
for(const mobile of [false,true])test(`resource orders, deliveries and a paid building through ${mobile?'touch':'mouse'} UI`,async({browser})=>{
 test.setTimeout(300000);
 const viewport=mobile?{width:390,height:844}:{width:1024,height:640};
 const context=await browser.newContext({viewport,hasTouch:mobile,isMobile:mobile});
 try{
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const press=selector=>mobile?page.locator(selector).tap():page.locator(selector).click();
  const tap=point=>mobile?page.touchscreen.tap(point.x,point.y):page.mouse.click(point.x,point.y);
  const snapshot=()=>page.evaluate(()=>{const a=AETHERIA_API;return {wood:a.state.wood,ore:a.state.ore,time:a.simulationTime,buildings:a.buildings.length,auto:a.state.autoBuild};});
  // A fixed wall delay can finish before software WebGL has drawn the new view.
  const cameraReady=()=>page.waitForFunction(()=>{
   const a=AETHERIA_API,t=a.camCtrl.target,v=a.cameraView.target;
   return Math.hypot(t.x-v.x,t.y-v.y,t.z-v.z)<1e-6;
  },null,{timeout:30000});
  async function aim(kind){return page.evaluate(kind=>{
   const a=AETHERIA_API,c=a.camCtrl,t=c.target,r=c.radius,eye=[t.x+r*Math.sin(c.phi)*Math.sin(c.theta),t.y+r*Math.cos(c.phi),t.z+r*Math.sin(c.phi)*Math.cos(c.theta)];
   const f=[t.x-eye[0],t.y-eye[1],t.z-eye[2]],fl=Math.hypot(...f);f.forEach((v,i)=>f[i]=v/fl);const rt=[-f[2],0,f[0]],rl=Math.hypot(...rt);rt.forEach((v,i)=>rt[i]=v/rl);const up=[rt[1]*f[2]-rt[2]*f[1],rt[2]*f[0]-rt[0]*f[2],rt[0]*f[1]-rt[1]*f[0]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
   let pts=kind==='wood'?a.trees.filter(n=>n.growth>=.55&&n.woodAmount>0):kind==='ore'?a.ores.filter(n=>n.oreAmount>0):[];
   if(kind==='build')for(let x=-22;x<=22;x+=2)for(let z=-22;z<=22;z+=2)if(!a.getBuildingPlacementIssue(x,z))pts.push({x,z});
   const worker=a.state.selectedEntity;
   return pts.map(n=>{const v=[n.x-eye[0],(kind==='build'?_getTerrainHeightAt(n.x,n.z):n.mesh.position.y+1.2)-eye[1],n.z-eye[2]],dep=dot(v,f),tan=Math.tan(24*Math.PI/180);return {x:(dot(v,rt)/(dep*tan*innerWidth/innerHeight)+1)*innerWidth/2,y:(1-dot(v,up)/(dep*tan))*innerHeight/2,dep,distance:Math.hypot(n.x-(worker?.x||0),n.z-(worker?.z||0))};}).filter(p=>p.dep>0&&p.x>10&&p.x<innerWidth-10&&p.y>135&&p.y<innerHeight-10&&document.elementFromPoint(p.x,p.y)?.id==='game-canvas').sort((a,b)=>a.distance-b.distance);
  },kind);}
  async function progressUntil(predicate,arg){
   // Desktop only: use the existing compact layout during progression for software WebGL.
   if(!mobile)await page.setViewportSize({width:400,height:300});
   await press('[data-speed="5"]');await page.waitForFunction(predicate,arg,{timeout:120000});await press('[data-speed="0"]');
   if(!mobile)await page.setViewportSize(viewport);
  }
  await page.goto(process.env.PLAYTEST_URL||'/');await page.waitForFunction(()=>window.AETHERIA_API);await press('[data-speed="0"]');
  expect((await snapshot()).auto).toBe(false);
  for(const resource of ['wood','ore']){
   await press(`#resource-${resource}`);await expect(page.locator('#economy-panel')).toBeVisible();await expect(page.locator('#economy-source')).toContainText('ส่งคลังกลาง');
   await press('#btn-economy-worker');await expect(page.locator('#economy-panel')).toBeHidden();
   const id=await page.evaluate(()=>AETHERIA_API.state.selectedEntity.id);
   await press(`[data-worker-resource="${resource}"]`);await expect(page.locator('#work-command-bar')).toBeVisible();
   await cameraReady();const points=await aim(resource);expect(points.length).toBeGreaterThan(0);await tap(points[0]);
   await expect(page.locator('#work-command-bar')).toBeHidden();
   expect(await page.evaluate(id=>AETHERIA_API.agents.find(a=>a.id===id).workOrder.resource,id)).toBe(resource);
   const before=await snapshot();
   await progressUntil(({id,resource})=>{const w=AETHERIA_API.agents.find(a=>a.id===id);return w.carryType===resource&&w.carryAmount>0;},{id,resource});
   const cargo=await page.evaluate(id=>AETHERIA_API.agents.find(a=>a.id===id).carryAmount,id);expect(cargo).toBeGreaterThan(0);
   await press(`#resource-${resource}`);await expect(page.locator('#economy-transit')).not.toHaveText('0');
   await page.screenshot({path:`test-results/economy-${mobile?'mobile':'desktop'}-${resource}-cargo.png`,animations:'disabled',timeout:90000});
   await press('#economy-panel [data-close-drawer]');
   await progressUntil(({id,resource})=>{const a=AETHERIA_API,w=a.agents.find(p=>p.id===id);return [...document.querySelectorAll('.log-entry')].some(e=>e.textContent.includes(w.name)&&e.textContent.includes(`ส่ง${resource==='wood'?'ไม้':'แร่ศิลา'}`)&&e.textContent.includes('เข้าคลังแล้ว'));},{id,resource});
   expect((await snapshot())[resource]).toBeGreaterThanOrEqual(before[resource]+cargo);
  }
  await press('#btn-mob-reset-cam');
  await press('#btn-toggle-left-hud');await press('[data-build="house"]');await expect(page.locator('#construction-bar')).toBeVisible();
  await cameraReady();const points=await aim('build');expect(points.length).toBeGreaterThan(0);
  for(const point of points.slice(0,20)){await tap(point);if(await page.locator('#btn-confirm-construction').isEnabled())break;}
  await expect(page.locator('#btn-confirm-construction')).toBeEnabled();
  const before=await snapshot();await press('#btn-cancel-construction');expect(await snapshot()).toEqual(before);
  // Choose again and explicitly confirm. Aiming/cancelling never spends.
  await press('#btn-toggle-left-hud');await press('[data-build="house"]');
  for(const point of points.slice(0,20)){await tap(point);if(await page.locator('#btn-confirm-construction').isEnabled())break;}
  await press('#btn-confirm-construction');const after=await snapshot();expect(after.wood).toBe(before.wood-25);expect(after.ore).toBe(before.ore-18);expect(after.buildings).toBe(before.buildings+1);
  expect(await page.evaluate(()=>AETHERIA_API.buildings.at(-1).progress)).toBe(.05);
  await progressUntil(()=>AETHERIA_API.buildings.at(-1).progress===1);
  await page.screenshot({path:`test-results/economy-${mobile?'mobile':'desktop'}-completed.png`,animations:'disabled',timeout:90000});
  expect(errors).toEqual([]);
 }finally{await context.close();}
});
