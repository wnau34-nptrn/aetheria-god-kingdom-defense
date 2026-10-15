// Extended observational playthrough. All game mutations use visible UI input.
// AETHERIA_API is read only for state snapshots and projection, never used to issue game commands.
import { chromium } from '@playwright/test';
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
const base=process.env.PLAYTEST_URL||'http://127.0.0.1:5173';
const target=process.env.PLAYTEST_TARGET||'original';
const evidence=`docs/playthrough/${target}`;
const commands=process.env.PLAYTEST_COMMANDS||'/tmp/aetheria-play-actions.jsonl';
await mkdir(`${evidence}/screenshots`,{recursive:true});
await writeFile(commands,'');
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const viewport={width:Number(process.env.PLAYTEST_WIDTH||800),height:Number(process.env.PLAYTEST_HEIGHT||600)};
const page=await browser.newPage({viewport});
page.setDefaultTimeout(15000);
const started=Date.now();let count=0,lastScreen='',lastEvent=false,lastEra=0,lastNight=null,stop=false;
const metadata={startedAt:new Date().toISOString(),target,url:base+(target==='original'?'/original/aetheria_3d_floating_island_god_simulator_kingdom_defense.html':'/'),viewport,method:'Playwright UI input; read-only API snapshots; no resource/time/era/spawn mutations through API.',headless:true,renderer:'Chromium ANGLE/SwiftShader'};
await writeFile(`${evidence}/metadata.json`,JSON.stringify(metadata,null,2)+'\n');
async function log(type,data){await appendFile(`${evidence}/timeline.jsonl`,JSON.stringify({wallSeconds:Math.round((Date.now()-started)/1000),type,...data})+'\n');}
page.on('pageerror',error=>log('pageerror',{message:error.message}));
page.on('console',m=>{if(m.type()==='error')log('console-error',{message:m.text().slice(0,300)});});
await page.goto(metadata.url);await page.waitForFunction(()=>window.AETHERIA_API);
async function sample(){
 const data=await page.evaluate(()=>{
  const a=window.AETHERIA_API,alive=a.agents.filter(x=>x.alive);const countBy=(items,field)=>items.reduce((r,x)=>(r[x[field]]=(r[x[field]]||0)+1,r),{});
  const round=n=>Math.round(n*100)/100;
  return {day:a.state.day,time:round(a.state.timeOfDay),night:a.state.isNight,era:a.state.civEra,progress:round(a.state.civProgress),speed:a.state.timeScale,
   resources:{food:round(a.state.food),wood:round(a.state.wood),ore:round(a.state.ore),faith:round(a.state.faith)},population:alive.length,soldiers:alive.filter(x=>x.role==='soldier').length,
   roles:countBy(alive,'role'),activities:countBy(alive,'state'),buildings:countBy(a.buildings,'type'),
   units:alive.map(x=>({id:x.id,name:x.name,role:x.role,state:x.state,hunger:round(x.hunger),hp:round(x.hp),x:round(x.x),z:round(x.z),carrying:x.carryType,amount:x.carryAmount,visible:x.mesh.visible})),
   structures:a.buildings.map(x=>({type:x.type,name:x.name,hp:round(x.hp),maxHp:x.maxHp,progress:x.progress===undefined?null:round(x.progress),x:round(x.x),z:round(x.z)})),
   monsters:a.monsters.filter(x=>x.alive).map(x=>({name:x.name,hp:round(x.hp),maxHp:x.maxHp,isBoss:x.isBoss,x:round(x.x),z:round(x.z)})),
   nature:{trees:a.trees.length,fruitTrees:a.trees.filter(x=>x.hasFruit).length,ores:a.ores.length},
   props:{wagons:a.wagons.length,livestock:a.livestock.length,windmills:a.windmills.length,cropFields:a.cropFields.length},
   selection:a.state.selectedEntity?{name:a.state.selectedEntity.name,type:a.state.selectedEntity.type}:null,
   dilemma:document.getElementById('dilemma-overlay').classList.contains('visible')?{title:document.getElementById('dl-title').textContent,category:document.getElementById('dl-category').textContent,choices:[...document.querySelectorAll('.dl-choice-btn')].map(x=>({id:x.id,text:x.innerText,disabled:x.classList.contains('disabled')}))}:null,
   log:[...document.querySelectorAll('.log-entry')].map(x=>x.textContent),hudHidden:document.body.classList.contains('hud-hidden')};
 });
 await writeFile(`${evidence}/latest.json`,JSON.stringify({wallSeconds:Math.round((Date.now()-started)/1000),...data},null,2)+'\n');
 await log('snapshot',data);return data;
}
async function shot(name){const file=`${evidence}/screenshots/${name}.png`;await page.screenshot({path:file});await log('screenshot',{path:file});}
async function project(x,z,y){return page.evaluate(({x,z,y})=>{
 const c=AETHERIA_API.camCtrl,t=c.target,r=c.radius;
 const eye=[t.x+r*Math.sin(c.phi)*Math.sin(c.theta),t.y+r*Math.cos(c.phi),t.z+r*Math.sin(c.phi)*Math.cos(c.theta)];
 const f=[t.x-eye[0],t.y-eye[1],t.z-eye[2]],fl=Math.hypot(...f);for(let i=0;i<3;i++)f[i]/=fl;
 const right=[-f[2],0,f[0]],rl=Math.hypot(...right);for(let i=0;i<3;i++)right[i]/=rl;
 const up=[right[1]*f[2]-right[2]*f[1],right[2]*f[0]-right[0]*f[2],right[0]*f[1]-right[1]*f[0]];
 const p=[x-eye[0],(y??window._getTerrainHeightAt(x,z))-eye[1],z-eye[2]];
 const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),depth=dot(p,f),tan=Math.tan(24*Math.PI/180);
 return {x:(dot(p,right)/(depth*tan*innerWidth/innerHeight)+1)*innerWidth/2,y:(1-dot(p,up)/(depth*tan))*innerHeight/2,depth};
 },{x,z,y});}
async function execute(command){
 await log('input',{command});
 if(command.type==='click') await page.locator(command.selector).click();
 else if(command.type==='key') await page.keyboard.press(command.key);
 else if(command.type==='cast'){
  await page.keyboard.press(command.key);const p=await project(command.x,command.z);
  if(p.depth<=0||p.x<0||p.x>viewport.width||p.y<0||p.y>viewport.height)throw new Error(`Target outside viewport ${JSON.stringify(p)}`);
  const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id,p);await log('aim',{world:{x:command.x,z:command.z},screen:p,hit});
  if(hit!=='game-canvas')throw new Error(`Aim blocked by ${hit}`);
  await page.mouse.click(p.x,p.y);await page.keyboard.press('Digit1');
 }
 else if(command.type==='inspect'){
  await page.keyboard.press('Digit1');
  const entity=await page.evaluate(({role,id,kind})=>{const a=AETHERIA_API;const pool=kind==='building'?a.buildings:kind==='tree'?a.trees:kind==='ore'?a.ores:a.agents.filter(x=>x.alive&&x.mesh.visible);const e=pool.find(x=>id!==undefined?x.id===id:role?x.role===role:true);return e?{x:e.x,z:e.z,y:e.mesh.position.y+1.2,name:e.name}:null;},command);
  if(!entity)throw new Error('No matching visible entity');const p=await project(entity.x,entity.z,entity.y);await page.mouse.click(p.x,p.y);await log('inspect-target',{entity,screen:p});
 }
 else if(command.type==='drag') {await page.mouse.move(command.x??550,command.y??380);await page.mouse.down({button:command.button||'left'});await page.mouse.move((command.x??550)+command.dx,(command.y??380)+command.dy,{steps:12});await page.mouse.up({button:command.button||'left'});}
 else if(command.type==='wheel')await page.mouse.wheel(0,command.delta);
 else if(command.type==='screenshot')await shot(command.name);
 else if(command.type==='stop')stop=true;
 else throw new Error('Unknown UI command');
}
await shot('00-start');
lastEra=1;lastNight=false;
while(!stop&&(Date.now()-started)<25*60*1000){
 const lines=(await readFile(commands,'utf8')).trim().split('\n').filter(Boolean);
 while(count<lines.length){const command=JSON.parse(lines[count++]);try{await execute(command);}catch(e){await log('input-error',{command,message:e.message});console.log('INPUT ERROR',e.message);}}
 const s=await sample();
 if(s.era!==lastEra){lastEra=s.era;await shot(`era-${s.era}-day-${s.day}`);}
 if(s.night!==lastNight){lastNight=s.night;await shot(`day-${s.day}-${s.night?'night':'daylight'}`);}
 if(s.dilemma&&!lastEvent)await shot(`event-${String(s.dilemma.category).includes('Military')?'military':String(s.dilemma.category).includes('Council')?'council':String(s.dilemma.category).includes('Caravan')?'caravan':String(s.dilemma.category).includes('Relic')?'relic':'petition'}-${Math.round((Date.now()-started)/1000)}`);
 lastEvent=!!s.dilemma;
 if(Math.floor((Date.now()-started)/1000)%20<3)console.log(JSON.stringify({wall:Math.round((Date.now()-started)/1000),day:s.day,time:s.time,era:s.era,progress:s.progress,pop:s.population,res:s.resources,monsters:s.monsters.length,dilemma:s.dilemma?.category}));
 await page.waitForTimeout(2000);
}
await sample();await shot('final');await browser.close();console.log('PLAYTHROUGH COMPLETE');
