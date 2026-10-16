import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameHarness } from './helpers/game-harness.js';

const living = a => a.agents.filter(w=>w.alive);

test('direct recruitment charges once and immediately updates visible population, troops and affordability',()=>{
 const h=createGameHarness(),a=h.api,d=h.window.document;
 try{
  h.click('[data-speed="0"]');const population=living(a).length,soldiers=living(a).filter(w=>w.role==='soldier').length,faith=a.state.faith;
  assert.ok(d.getElementById('command-bar').contains(d.getElementById('btn-train-soldier')));
  h.click('#btn-train-soldier');assert.equal(a.state.faith,faith-25);assert.equal(living(a).length,population);
  assert.equal(d.getElementById('quick-soldiers').textContent,String(soldiers+1));
  h.click('#btn-spawn-villager');assert.equal(a.state.faith,faith-45);assert.equal(d.getElementById('quick-pop').textContent,String(population+1));
  assert.equal(d.getElementById('btn-train-soldier').getAttribute('aria-disabled'),'true');
  const remaining=a.state.faith;h.click('#btn-train-soldier');assert.equal(a.state.faith,remaining);
 }finally{h.close();}
});

test('training chooses a worker without cargo and never deletes carried resources',()=>{
 const h=createGameHarness(),a=h.api;
 try{
  const workers=living(a).filter(w=>w.role==='villager');Object.assign(workers[0],{carryType:'wood',carryAmount:5});
  h.click('#btn-train-soldier');assert.equal(workers[0].alive,true);assert.equal(workers[0].carryAmount,5);
  for(const worker of living(a).filter(w=>w.role==='villager'))Object.assign(worker,{carryType:'wood',carryAmount:5});
  const faith=a.state.faith,population=living(a).length;h.click('#btn-train-soldier');
  assert.equal(a.state.faith,faith);assert.equal(living(a).length,population);
  assert.match(h.window.document.getElementById('dilemma-toast').textContent,/รอส่งคลัง/);
 }finally{h.close();}
});

test('building command readiness follows current stock and workers without opening a drawer',()=>{
 const h=createGameHarness(),a=h.api,d=h.window.document;
 try{
  a.state.wood=24;a.state.ore=18;a.updateHUD();assert.equal(d.querySelector('[data-build="house"]').dataset.unavailable,'true');
  a.state.wood=25;a.updateHUD();assert.equal(d.querySelector('[data-build="house"]').dataset.unavailable,'false');
  for(const worker of a.agents)if(worker.role==='villager')worker.alive=false;
  a.updateHUD();assert.match(d.querySelector('[data-build="house"]').title,/ต้องมีคนงาน/);
  a.state.civProgress=100;a.updateHUD();assert.equal(d.getElementById('btn-advance-era').getAttribute('aria-disabled'),'false');
  h.click('#btn-advance-era');assert.equal(a.state.civEra,2);
  a.evolveToEra(4);assert.match(d.getElementById('command-era-progress').textContent,/ยุคสูงสุด/);
 }finally{h.close();}
});

test('natural events show all answers directly, pause, and keep the same pending question while playing on',()=>{
 const h=createGameHarness(),a=h.api,d=h.window.document;
 try{
  h.advance(18.1,1);assert.equal(d.getElementById('decision-card').hidden,false);
  assert.equal(d.getElementById('dilemma-overlay').classList.contains('visible'),false);
  const choices=d.getElementById('dl-choices'),first=d.getElementById('dl-choice-0'),title=d.getElementById('decision-title').textContent;
  assert.equal(choices.parentElement.id,'decision-choices');assert.equal(choices.children.length,3);
  const paused=a.simulationTime;for(let frame=0;frame<10;frame++)h.frame();assert.equal(a.simulationTime,paused);
  h.click('#btn-decision-continue');assert.equal(a.state.timeScale,1);
  h.advance(43,1);assert.ok(a.simulationTime>paused);assert.equal(d.getElementById('decision-card').hidden,false);
  assert.equal(d.getElementById('dl-choice-0'),first);assert.equal(d.getElementById('decision-title').textContent,title);
  h.click('#btn-trigger-dilemma');assert.equal(d.getElementById('decision-title').textContent,title);
 }finally{h.close();}
});

test('a pending card refreshes prices after recruitment and rechecks funds before applying a choice',()=>{
 const h=createGameHarness(),a=h.api,d=h.window.document;
 try{
  a.state.faith=35;a.openInteractiveDilemma(4,false,true);h.click('#btn-decision-continue');
  assert.equal(d.getElementById('dl-choice-0').getAttribute('aria-disabled'),'false');
  h.click('#btn-train-soldier');assert.equal(a.state.faith,10);assert.equal(d.getElementById('dl-choice-0').getAttribute('aria-disabled'),'true');
  assert.match(d.querySelector('#dl-choice-0 .dl-choice-cost').textContent,/ศรัทธา 10\/15/);
  h.click('#dl-choice-0');assert.equal(a.state.faith,10);assert.equal(d.getElementById('decision-card').hidden,false);
  h.click('#dl-choice-2');assert.equal(a.state.faith,55);assert.equal(d.getElementById('decision-card').hidden,true);assert.equal(a.state.timeScale,1);
 }finally{h.close();}
});

test('answering after playing on respects the current speed and stale clicks cannot apply the result twice',()=>{
 const h=createGameHarness(),a=h.api,d=h.window.document;
 try{
  h.click('[data-speed="5"]');a.openInteractiveDilemma(4,false,true);h.click('#btn-decision-continue');
  h.click('[data-speed="0"]');const button=d.getElementById('dl-choice-2'),faith=a.state.faith;
  button.click();assert.equal(a.state.faith,faith+45);assert.equal(a.state.timeScale,0);
  button.click();assert.equal(a.state.faith,faith+45);assert.equal(a.state.timeScale,0);
 }finally{h.close();}
});

test('story view and compact answers share one pending decision and restore the selected speed',()=>{
 const h=createGameHarness(),a=h.api,d=h.window.document;
 try{
  h.click('[data-speed="2.5"]');a.openInteractiveDilemma(0,false,true);
  const button=d.getElementById('dl-choice-0'),title=d.getElementById('decision-title').textContent;
  h.click('#btn-decision-details');assert.equal(d.getElementById('decision-card').hidden,true);
  assert.equal(d.getElementById('dl-choices').parentElement.id,'dl-choices-host');assert.equal(a.state.timeScale,0);
  h.click('#btn-close-dilemma');assert.equal(d.getElementById('decision-card').hidden,false);
  assert.equal(d.getElementById('dl-choice-0'),button);assert.equal(d.getElementById('decision-title').textContent,title);assert.equal(a.state.timeScale,2.5);
  h.click('[data-speed="1"]');h.click('#btn-decision-details');h.click('#btn-close-dilemma');assert.equal(a.state.timeScale,1);
 }finally{h.close();}
});

test('a new island clears its old pending question',()=>{
 const h=createGameHarness(),a=h.api,d=h.window.document;
 try{a.openInteractiveDilemma(0,false,true);h.click('#btn-regen-island');assert.equal(d.getElementById('decision-card').hidden,true);assert.equal(d.getElementById('dilemma-overlay').classList.contains('visible'),false);}
 finally{h.close();}
});
