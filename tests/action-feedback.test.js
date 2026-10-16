import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGameHarness} from './helpers/game-harness.js';

for (const [name,invoke,cost] of [
 ['rain',a=>a.castRainPower(0,0),15],['meteor',a=>a.castMeteorStrike(0,0),35],['lightning',a=>a.castLightningStrike(0,0),20],
 ['villager',(a,h)=>h.click('#btn-spawn-villager'),20],['soldier',(a,h)=>h.click('#btn-train-soldier'),25]
]) test(`unaffordable ${name} reports on the playfield and preserves world`,()=>{
 const h=createGameHarness(),a=h.api,d=h.window.document;
 try{a.state.faith=cost-1;h.click('[data-speed="0"]');const before={faith:a.state.faith,units:a.agents.length,shots:a.projectiles.length,towers:a.buildings.length};
 invoke(a,h);const toast=d.getElementById('dilemma-toast');assert.ok(toast.classList.contains('visible'));assert.match(toast.textContent,/ศรัทธาไม่พอ/);assert.match(toast.textContent,new RegExp(`${cost}`));
 assert.deepEqual({faith:a.state.faith,units:a.agents.length,shots:a.projectiles.length,towers:a.buildings.length},before);
 assert.match(d.querySelector('.log-entry').textContent,/ศรัทธาไม่พอ/);
 }finally{h.close();}
});
