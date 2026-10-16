import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameHarness, stationaryMonster } from './helpers/game-harness.js';
const modalOpen = h => h.window.document.getElementById('dilemma-overlay').classList.contains('visible');
const count = (a, type) => a.buildings.filter(x => x.type === type).length;
const soldiers = a => a.agents.filter(x => x.alive && x.role === 'soldier');
const world = a => ({ time: a.state.timeOfDay, day: a.state.day, faith: a.state.faith, food: a.state.food,
  wood: a.state.wood, ore: a.state.ore, progress: a.state.civProgress, simulationTime: a.simulationTime,
  agents: a.agents.map(x => [x.x,x.z,x.hp,x.hunger,x.workTimer]), buildings: a.buildings.map(x => [x.hp,x.progress,x.fireCooldown]),
  monsters: a.monsters.map(x => [x.x,x.z,x.hp]), projectiles: a.projectiles.map(x => [x.x,x.y,x.z]) });

for (const speed of [0, 1, 2.5, 5]) {
  test(`dilemmas freeze gameplay through all tabs and restore ${speed}x`, () => {
    const h = createGameHarness(), a = h.api;
    try {
      h.click(`[data-speed="${speed}"]`);a.state.faith = 200;a.castMeteorStrike(40,40);
      a.openInteractiveDilemma(0);
      const paused = world(a);
      assert.equal(h.window.document.querySelector('[data-speed="0"]').classList.contains('active'),true);
      for (let tab=0;tab<5;tab++) {
        h.click(`[data-dl-idx="${tab}"]`);
        for(let frame=0;frame<10;frame++) h.frame();
        assert.deepEqual(world(a),paused);
      }
      h.click('#btn-close-dilemma');assert.equal(a.state.timeScale,speed);
      assert.equal(h.window.document.querySelector(`[data-speed="${speed}"]`).classList.contains('active'),true);
      h.frame();
      if(speed===0)assert.deepEqual(world(a),paused);
      else assert.ok(a.simulationTime>paused.simulationTime);
    } finally { h.close(); }
  });
}

test('pause freezes gameplay and a manual night jump cannot spawn a wave until resumed', () => {
  const h=createGameHarness(),a=h.api;
  try {
    h.click('[data-speed="0"]');const paused=world(a);
    for(let frame=0;frame<40;frame++)h.frame();
    assert.deepEqual(world(a),paused);
    h.click('#btn-jump-night');for(let frame=0;frame<10;frame++)h.frame();
    assert.equal(a.monsters.length,0);
    assert.equal(a.state.timeOfDay,20.25);
    assert.match(h.window.document.getElementById('clock-display').textContent,/20:15/);
    h.click('[data-speed="1"]');h.frame();assert.ok(a.monsters.length>0);
  } finally {h.close();}
});

test('caravan rejects every unaffordable offer, including when all are unaffordable', () => {
  const h=createGameHarness(),a=h.api;
  try {
    a.state.faith=a.state.wood=a.state.food=0;a.openInteractiveDilemma(2);
    const before={population:a.agents.length,wagons:a.wagons.length,ore:a.state.ore};
    for(let choice=0;choice<3;choice++) {
      const button=h.window.document.getElementById(`dl-choice-${choice}`);
      assert.equal(button.getAttribute('aria-disabled'),'true');h.click(`#dl-choice-${choice}`);
      assert.ok(modalOpen(h));assert.equal(a.state.food,0);assert.equal(a.state.faith,0);assert.equal(a.state.wood,0);
      assert.equal(a.agents.length,before.population);assert.equal(a.wagons.length,before.wagons);assert.equal(a.state.ore,before.ore);
    }
    h.click('#btn-close-dilemma');assert.equal(modalOpen(h),false);
  } finally {h.close();}
});

for(const choice of [0,1]) {
  test(`a council ${choice===0?'house':'tower'} failure cannot charge or claim success`,()=>{
    const h=createGameHarness(),a=h.api;
    try {
      for(let x=-45;x<=45;x+=5)for(let z=-45;z<=45;z+=5)a.buildings.push({type:'house',x,z,hp:100,maxHp:100,progress:1});
      a.state.wood=a.state.ore=100;
      const before={wood:a.state.wood,ore:a.state.ore,population:a.agents.length,buildings:a.buildings.length};
      a.openInteractiveDilemma(1);h.click(`#dl-choice-${choice}`);
      assert.deepEqual({wood:a.state.wood,ore:a.state.ore,population:a.agents.length,buildings:a.buildings.length},before);
      assert.ok(modalOpen(h));assert.match(h.window.document.getElementById('dilemma-toast').textContent,/ไม่พบพื้นที่เหมาะสม/);
      assert.equal(h.window.document.querySelector('.log-entry').classList.contains('warn'),true);
      // A different paid decision still works without closing/reopening the failed event.
      h.click('#dl-choice-2');assert.equal(modalOpen(h),false);assert.equal(a.agents.length,before.population+2);
    }finally{h.close();}
  });
}

// Every advertised numeric effect is exercised with sufficient funds and room.
for(let event=0;event<5;event++)for(let choice=0;choice<3;choice++) {
 test(`event ${event+1}, choice ${choice+1} delivers its advertised result`,()=>{
  const h=createGameHarness({seed:1234}),a=h.api;
  try {
   Object.assign(a.state,{food:100,wood:100,ore:100,faith:100,civProgress:10});
   for(const agent of a.agents){agent.hp=agent.maxHp-20;agent.hunger=50;}
   if(event===4){stationaryMonster(h,50,-40);a.monsters[0].hp=a.monsters[0].maxHp=400;}
   const before={population:a.agents.length,houses:count(a,'house'),towers:count(a,'tower'),soldiers:soldiers(a).length,wagons:a.wagons.length,
     maxHp:a.buildings.map(x=>x.maxHp)};
   a.openInteractiveDilemma(event);h.click(`#dl-choice-${choice}`);assert.equal(modalOpen(h),false);
   if(event===0&&choice===0){assert.equal(a.state.food,135);assert.equal(a.state.faith,85);assert.equal(a.state.civProgress,25);assert.ok(a.agents.every(x=>x.hunger===0&&x.hp===x.maxHp));}
   if(event===0&&choice===1){assert.equal(a.state.wood,90);assert.equal(a.state.food,122);assert.ok(a.agents.every(x=>x.hunger===22.5));}
   if(event===0&&choice===2){assert.equal(a.state.wood,125);assert.equal(a.state.ore,120);assert.ok(a.agents.filter(x=>x.role!=='soldier').every(x=>x.hp===x.maxHp-32));}
   if(event===1&&choice===0){assert.equal(a.state.wood,85);assert.equal(count(a,'house'),before.houses+1);assert.equal(a.agents.length,before.population+2);}
   if(event===1&&choice===1){assert.equal(a.state.ore,85);assert.equal(count(a,'tower'),before.towers+1);assert.equal(soldiers(a).length,before.soldiers+2);}
   if(event===1&&choice===2){assert.equal(a.state.faith,75);assert.equal(a.state.civProgress,30);assert.equal(a.agents.length,before.population+2);assert.equal(soldiers(a).length,before.soldiers+1);}
   if(event===2&&choice===0){assert.equal(a.state.faith,85);assert.equal(a.state.food,130);assert.equal(a.wagons.length,before.wagons+1);}
   if(event===2&&choice===1){assert.equal(a.state.wood,85);assert.equal(a.state.ore,135);assert.equal(a.state.faith,135);}
   if(event===2&&choice===2){assert.equal(a.state.food,80);assert.equal(soldiers(a).length,before.soldiers+2);}
   if(event===3&&choice===0){assert.equal(a.state.faith,155);assert.equal(a.state.civProgress,28);}
   if(event===3&&choice===1){assert.equal(a.state.wood,130);assert.equal(a.state.ore,135);assert.equal(a.state.food,120);}
   if(event===3&&choice===2){assert.equal(a.state.faith,180);assert.equal(a.state.civProgress,40);assert.equal(a.monsters.length,2);}
   if(event===4&&choice===0){assert.equal(a.state.faith,85);assert.equal(a.monsters[0].hp,240);assert.ok(soldiers(a).every(x=>x.hp===x.maxHp));}
   if(event===4&&choice===1){assert.equal(a.state.ore,88);assert.deepEqual(a.buildings.map(x=>x.maxHp),before.maxHp.map(x=>x+50));assert.ok(a.buildings.every(x=>x.hp===x.maxHp));}
   if(event===4&&choice===2)assert.equal(a.state.faith,145);
  }finally{h.close();}
 });
}
