import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const out=process.env.READABILITY_EVIDENCE || `/tmp/aetheria-readability-${Date.now()}`;
mkdirSync(out,{recursive:true});
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(`${out}/metadata.json`,JSON.stringify({started:new Date().toISOString(),sourceSHA256:hash('src/legacy/game.js'),cssSHA256:hash('src/styles/game.css'),htmlSHA256:hash('index.html'),viewport:{width:400,height:300},speeds:[1,5],method:'UI-only observe policy; read-only state snapshots; normal wheel zoom deltaY2200; close natural events; pause for captures; no RNG, world or clock overrides; software WebGL'},null,2),{flag:'wx'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{void browser.close().catch(()=>{});});
try {
  for(const speed of [1,5]) {
    const context=await browser.newContext({viewport:{width:400,height:300}}), page=await context.newPage(), errors=[], checkpoints=[];
    page.on('pageerror',e=>errors.push(e.message));
    const sample=()=>page.evaluate(()=>{const a=AETHERIA_API,d=document;return {simulationTime:a.simulationTime,day:a.state.day,time:a.state.timeOfDay,speed:a.state.timeScale,people:a.agents.filter(v=>v.alive).length,enemies:a.monsters.filter(v=>v.alive).length,faith:a.state.faith,food:a.state.food,countdown:d.getElementById('night-countdown').textContent,guidance:d.getElementById('night-guidance').textContent,quickEnemies:Number(d.getElementById('quick-enemies').textContent),quickPeople:Number(d.getElementById('quick-pop').textContent),event:d.getElementById('dilemma-overlay').classList.contains('visible')};});
    try {
      await page.goto(process.env.GAME_URL||'http://127.0.0.1:5174');await page.waitForFunction(()=>window.AETHERIA_API);
      await page.click('[data-speed="0"]');await page.click('#btn-toggle-bubbles');
      await page.keyboard.press('KeyH');await page.mouse.move(200,150);await page.mouse.wheel(0,2200);await page.keyboard.press('KeyH');
      await page.click(`[data-speed="${speed}"]`);
      const start=Date.now();let warned=false, night=false, eventCount=0;
      while(Date.now()-start<600000) {
        let s=await sample();
        if(s.event){await page.click('#btn-close-dilemma');eventCount++;s=await sample();}
        appendFileSync(`${out}/${speed}x.jsonl`,JSON.stringify(s)+'\n');
        assert.equal(s.quickEnemies,s.enemies);assert.equal(s.quickPeople,s.people);
        if((!warned&&s.time>=18&&s.time<20)||(!night&&s.time>=20)){
          const label=s.time<20?'warning':'night';
          if(label==='warning'){assert.match(s.guidance,/ก่อนคืนแรก/);warned=true;} else {assert.ok(s.enemies>0);night=true;}
          await page.click('[data-speed="0"]');
          const paused=await sample();await page.waitForTimeout(800);const after=await sample();assert.equal(after.simulationTime,paused.simulationTime);assert.equal(after.countdown,paused.countdown);
          await page.screenshot({path:`${out}/${speed}x-${label}-400.png`});
          await page.setViewportSize({width:800,height:600});await page.screenshot({path:`${out}/${speed}x-${label}-800.png`});await page.setViewportSize({width:400,height:300});
          checkpoints.push(paused);await page.click(`[data-speed="${speed}"]`);
          console.log(JSON.stringify({speed,label,...paused}));
        }
        if(night&&s.time>=20.3)break;
        await page.waitForTimeout(1000);
      }
      assert.ok(warned,'must observe natural first-night warning');assert.ok(night,'must reach natural siege');assert.deepEqual(errors,[]);
      writeFileSync(`${out}/${speed}x-summary.json`,JSON.stringify({speed,checkpoints,final:await sample(),eventCount,errors,wallSeconds:(Date.now()-start)/1000},null,2));
      console.log(`${speed}x complete`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
console.log(out);
