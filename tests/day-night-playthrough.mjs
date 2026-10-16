// Natural UI-only observation of a full day/night cycle. Read-only world snapshots
// assist aiming; this is scripted QA, not a human fun or paired balance study.
import { chromium } from '@playwright/test';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const out=process.env.CYCLE_EVIDENCE||`/tmp/aetheria-cycle-${Date.now()}`;
const modes=(process.env.CYCLE_MODES||'desktop,mobile').split(',');
await mkdir(out,{recursive:true});
const hashes={};for(const p of ['src/legacy/game.js','src/ui/interface.js','src/styles/game.css','index.html'])hashes[p]=createHash('sha256').update(await readFile(p)).digest('hex');
await writeFile(`${out}/metadata.json`,JSON.stringify({startedAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes,method:'Fresh context per device. Real WebGL. Desktop400x300 during progression,1024x640 for paused power inputs and visual checkpoints; mobile390x844 throughout. Normal zoom-out buttons to maximum between checkpoints for software-renderer throughput; reset camera for native-size screenshots. Do not infer physical-device FPS. UI-only speed5x with1x warning/siege crossings and pauses for input/screenshots. No API writes, clock/RNG override, forced events, era or day jumps. Read-only world coordinates assist pointer/touch aiming. Recruit one soldier, attempt one tower, rain when food/hunger calls for it, lightning on enemies if affordable; natural affordable event choices. Continue to next day08:12, including a population-zero sandbox. Unpaired random runs, not human fun/balance/FPS evidence.'},null,2),{flag:'wx'});
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];
try{for(const mode of modes){
 const mobile=mode==='mobile',viewport=mobile?{width:390,height:844}:{width:400,height:300},screenshotViewport=mobile?viewport:{width:1024,height:640},dir=`${out}/${mode}`;
 await mkdir(dir,{recursive:true});const context=await browser.newContext({viewport,hasTouch:mobile,isMobile:mobile});const page=await context.newPage();page.setDefaultTimeout(30000);
 const errors=[],failures=[],actions=[],checkpoints=[],findings=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure()?.errorText}));
 const started=Date.now();let shots=new Set(),eventCount=0,lastStatus=0,initial,trained=false,tower=false,rained=false,casts=0,lastCast=-100,menuChecked=false,warnApproach=false,nightApproach=false;
 const sample=()=>page.evaluate(()=>{const a=AETHERIA_API,s=a.state,people=a.agents.filter(x=>x.alive),enemies=a.monsters.filter(x=>x.alive),d=document;return {simulationTime:+a.simulationTime.toFixed(3),day:s.day,time:+s.timeOfDay.toFixed(4),night:s.isNight,secondWave:s.secondWaveTonight,era:s.civEra,progress:+s.civProgress.toFixed(2),speed:s.timeScale,faith:+s.faith.toFixed(2),food:+s.food.toFixed(2),wood:+s.wood.toFixed(2),ore:+s.ore.toFixed(2),people:people.length,soldiers:people.filter(x=>x.role==='soldier').length,enemies:enemies.length,towers:a.buildings.filter(x=>x.type==='tower').length,meanHunger:people.reduce((v,p)=>v+p.hunger,0)/Math.max(1,people.length),power:s.activePower,event:d.getElementById('dilemma-overlay').classList.contains('visible'),category:d.getElementById('dl-category').textContent,choices:[...d.querySelectorAll('.dl-choice-btn')].map(e=>({id:e.id,disabled:e.getAttribute('aria-disabled')==='true',text:e.textContent.trim()})),hud:{people:Number(d.getElementById('quick-pop').textContent),enemies:Number(d.getElementById('quick-enemies').textContent),faith:Number(d.getElementById('quick-faith').textContent),countdown:d.getElementById('night-countdown').textContent,guidance:d.getElementById('night-guidance').textContent,threat:d.getElementById('kingdom-readout').dataset.threat},log:[...d.querySelectorAll('.log-entry')].slice(0,4).map(e=>e.textContent)};});
 const record=async(type,data)=>appendFile(`${dir}/timeline.jsonl`,JSON.stringify({wallSeconds:+((Date.now()-started)/1000).toFixed(2),type,...data})+'\n');
 async function dismissInterrupt(){eventCount++;await record('interrupt-event',await sample());const close=page.locator('#btn-close-dilemma');if(mobile)await close.tap();else await close.click();}
 const press=async selector=>{
  const isDecision=/^#(dl-choice|btn-close-dilemma)/.test(selector);
  for(let attempt=0;attempt<4;attempt++){
   if(!isDecision&&await page.locator('#dilemma-overlay').isVisible())await dismissInterrupt();
   try{const p=page.locator(selector);if(mobile)await p.tap({timeout:8000});else await p.click({timeout:8000});return;}
   catch(error){if(!isDecision&&await page.locator('#dilemma-overlay').isVisible()){await dismissInterrupt();continue;}throw error;}
  }
  throw new Error('Repeated decision interruption: '+selector);
 };
 const speed=async v=>{await press(`[data-speed="${v}"]`);};
 const shot=async label=>{
  if(shots.has(label))return;shots.add(label);
  if(await page.locator('#dilemma-overlay').isVisible())await dismissInterrupt();
  await speed(0);const paused=await sample();await page.waitForTimeout(350);assert.equal((await sample()).simulationTime,paused.simulationTime);
  await page.setViewportSize(screenshotViewport);await press('#btn-mob-reset-cam');
  await page.screenshot({path:`${dir}/${label}.png`,animations:'disabled',timeout:90000});
  await page.setViewportSize(viewport);for(let i=0;i<14;i++)await press('#btn-zoom-out');
  checkpoints.push({label,state:paused});await record('checkpoint',{label,state:paused});console.log(JSON.stringify({mode,checkpoint:label,time:paused.time,day:paused.day,people:paused.people,enemies:paused.enemies}));await speed(5);
 };
 async function targets(kind){return page.evaluate(kind=>{
   const a=AETHERIA_API,c=a.camCtrl,t=c.target,r=c.radius,eye=[t.x+r*Math.sin(c.phi)*Math.sin(c.theta),t.y+r*Math.cos(c.phi),t.z+r*Math.sin(c.phi)*Math.cos(c.theta)];
   const f=[t.x-eye[0],t.y-eye[1],t.z-eye[2]],fl=Math.hypot(...f);f.forEach((v,i)=>f[i]=v/fl);const rt=[-f[2],0,f[0]],rl=Math.hypot(...rt);rt.forEach((v,i)=>rt[i]=v/rl);const up=[rt[1]*f[2]-rt[2]*f[1],rt[2]*f[0]-rt[0]*f[2],rt[0]*f[1]-rt[1]*f[0]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
   let pts=kind==='enemy'?a.monsters.filter(x=>x.alive).map(x=>({x:x.x,z:x.z})):kind==='worker'?a.agents.filter(x=>x.alive&&x.role!=='soldier').map(x=>({x:x.x,z:x.z})):[];
   if(kind==='tower')for(let x=-24;x<=24;x+=2)for(let z=-24;z<=20;z+=2)if(!a.getBuildingPlacementIssue(x,z))pts.push({x,z});
   return pts.map(({x,z})=>{const p=[x-eye[0],_getTerrainHeightAt(x,z)-eye[1],z-eye[2]],dep=dot(p,f),tan=Math.tan(24*Math.PI/180);return {world:{x,z},x:(dot(p,rt)/(dep*tan*innerWidth/innerHeight)+1)*innerWidth/2,y:(1-dot(p,up)/(dep*tan))*innerHeight/2,dep};}).filter(p=>p.dep>0&&p.x>10&&p.x<innerWidth-10&&p.y>5&&p.y<innerHeight-5&&document.elementFromPoint(p.x,p.y)?.id==='game-canvas').sort((a,b)=>Math.hypot(a.x-innerWidth/2,a.y-innerHeight/2)-Math.hypot(b.x-innerWidth/2,b.y-innerHeight/2)).slice(0,20);
 },kind);}
 async function cast(power,kind){await speed(0);if(!mobile)await page.setViewportSize(screenshotViewport);await press(`[data-power="${power}"]`);const before=await sample();let done=false;
   for(const p of await targets(kind)){await page.mouse.move(p.x,p.y);if(power==='miracle'&&!(await page.locator('#placement-feedback').textContent()).includes('วางหอคอยได้'))continue;
     if(mobile)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);const after=await sample();if(after.faith<before.faith||after.towers>before.towers){actions.push({label:power,viewport:screenshotViewport,screen:p,before,after});await record('action',{label:power,viewport:screenshotViewport,screen:p,before,after});done=true;break;}}
   if(!done)findings.push({type:'aim-unavailable',power,at:before.simulationTime});await press('[data-power="observe"]');if(!mobile)await page.setViewportSize(viewport);await speed(5);return done;
 }
 try{
 await page.goto(process.env.PLAYTEST_URL||'http://127.0.0.1:5173');await page.waitForFunction(()=>window.AETHERIA_API);await speed(0);initial=await sample();await shot('01-start');
 // Full view via the normal camera controls; no camera state mutation.
 await speed(1);
 await press('#btn-toggle-left-hud');await press('#btn-train-soldier');await press('#left-panel [data-close-drawer]');trained=true;actions.push({label:'train-one',state:await sample()});await speed(5);
 while(Date.now()-started<25*60*1000){let s=await sample();await record('snapshot',s);assert.equal(s.hud.people,s.people);assert.equal(s.hud.enemies,s.enemies);
   if(s.event){eventCount++;await record('natural-event',s);const choice=s.choices.find(x=>!x.disabled);if(choice)await press('#'+choice.id);if((await sample()).event)await press('#btn-close-dilemma');await speed(5);continue;}
   if(!menuChecked&&s.simulationTime-initial.simulationTime>8){await press('#btn-menu');await speed(0);const p=await sample();await page.waitForTimeout(450);assert.equal((await sample()).simulationTime,p.simulationTime);await press('#game-menu [data-close-drawer]');await press('#btn-toggle-right-hud');await press('#right-panel [data-close-drawer]');await speed(5);menuChecked=true;actions.push({label:'menu-map-pause',at:s.simulationTime});}
   if(!tower&&s.day===1&&s.time<17&&s.faith>=25){tower=await cast('miracle','tower');if(!tower)throw new Error('No visible tower plot via normal HUD');}
   if(!rained&&s.faith>=35&&(s.food<25||s.meanHunger>30)){rained=await cast('rain','worker');if(!rained)findings.push({type:'rain-target-offscreen',at:s.simulationTime});}
   if(!warnApproach&&s.day===1&&s.time>=17.95){await speed(1);warnApproach=true;}
   if(!shots.has('02-warning')&&s.day===1&&s.time>=18&&s.time<20){await shot('02-warning');}
   if(!nightApproach&&s.day===1&&s.time>=19.95){await speed(1);nightApproach=true;}
   if(!shots.has('03-siege')&&s.night&&s.enemies>0){await shot('03-siege');if(await page.locator('#siege-banner').evaluate(e=>e.classList.contains('visible')))await press('#btn-jump-battle');else findings.push({type:'battle-shortcut-expired-during-pause',at:s.simulationTime});}
   if(s.enemies&&s.faith>=20&&s.simulationTime-lastCast>18&&casts<3){if(await cast('lightning','enemy'))casts++;lastCast=s.simulationTime;}
   if(s.day>=2&&s.time>=0.5&&s.time<5.5&&!shots.has('04-reinforcements'))await shot('04-reinforcements');
   if(s.day>=2&&s.time>=6&&!shots.has('05-dawn'))await shot('05-dawn');
   if(s.day>=2&&s.time>=initial.time){await speed(0);await shot('06-next-morning');await speed(0);break;}
   if(Date.now()-lastStatus>25000){console.log(JSON.stringify({mode,wall:Math.round((Date.now()-started)/1000),game:s.simulationTime,day:s.day,time:s.time,people:s.people,enemies:s.enemies}));lastStatus=Date.now();}
   await page.waitForTimeout(500);
 }
 const final=await sample();assert.ok(final.simulationTime-initial.simulationTime>=24/.11-.05,'a complete24-hour cycle');assert.ok(shots.has('02-warning')&&shots.has('03-siege')&&shots.has('05-dawn'),'warning siege dawn observed');assert.deepEqual(errors,[]);
 const result={mode,viewport,screenshotViewport,initial,final,checkpoints,actions,eventCount,findings,errors,failures,wallSeconds:(Date.now()-started)/1000};results.push(result);await writeFile(`${dir}/summary.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({mode,finished:true,final,wallSeconds:result.wallSeconds}));
 }catch(e){await writeFile(`${dir}/failure.json`,JSON.stringify({message:e.message,state:await sample().catch(()=>null),errors,failures,findings},null,2));throw e;}finally{await context.close();}
}
await writeFile(`${out}/summary.json`,JSON.stringify({results},null,2));console.log(out);
}finally{await browser.close();}
