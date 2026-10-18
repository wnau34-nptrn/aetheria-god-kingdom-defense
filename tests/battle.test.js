import {test} from 'node:test';
import assert from 'node:assert/strict';
import {battlePhase,planArmyOrder,armyAction} from '../src/systems/battle.js';
import {createGameHarness,isolate,stationaryMonster} from './helpers/game-harness.js';

test('battle phases follow actual danger, reinforcements and recovery rather than darkness alone',()=>{
  const s={timeOfDay:10,siegeTriggeredTonight:false,secondWaveTonight:false},m={alive:true,hp:10};
  assert.equal(battlePhase(s,[],0),'city');assert.equal(battlePhase(s,[m],0),'combat');
  s.timeOfDay=19;assert.equal(battlePhase(s,[],0),'prepare');
  s.timeOfDay=21;s.siegeTriggeredTonight=true;assert.equal(battlePhase(s,[],0,20),'waiting');
  s.timeOfDay=1;s.secondWaveTonight=true;assert.equal(battlePhase(s,[],5,10),'recovery');
  s.timeOfDay=6;assert.equal(battlePhase(s,[m],20),'combat');assert.equal(battlePhase(s,[],20,10),'city');
});

test('formation planning is atomic, spreads units and never mutates orders on rejected ground',()=>{
  const units=[{x:0,z:0},{x:1,z:0},{x:2,z:0}];
  assert.equal(planArmyOrder(units,'hold',{x:0,z:0},()=>false),null);
  assert.ok(units.every(u=>!u.armyOrder));
  const plans=planArmyOrder(units,'hold',{x:10,z:10},p=>p.x>=10);
  assert.equal(plans.length,3);assert.ok(plans.every(p=>p.order.slotX>=10));
  assert.equal(new Set(plans.map(p=>`${p.order.slotX},${p.order.slotZ}`)).size,3);
});

test('midnight wave flag reset keeps the pending reinforcement HUD and ends it after the second wave',()=>{
  const s={timeOfDay:0,siegeTriggeredTonight:false,secondWaveTonight:false};
  assert.equal(battlePhase(s,[],20,30),'waiting');
  s.timeOfDay=1;s.secondWaveTonight=true;
  assert.equal(battlePhase(s,[],25,30),'recovery');
  assert.equal(battlePhase(s,[],31,30),'city');
});

for(const speed of [1,5])test(`hold intercepts locally and returns instead of chasing a distant enemy at ${speed}x`,()=>{
  const h=createGameHarness(),a=h.api;
  try{
    const soldier=a.agents.find(u=>u.role==='soldier');isolate(h,{agents:[soldier],time:21});
    a.army.select(soldier);assert.equal(a.army.issue('hold',{x:24,z:-8}),true);
    Object.assign(soldier,{x:soldier.armyOrder.slotX,z:soldier.armyOrder.slotZ});
    const enemy=stationaryMonster(h,soldier.x+5,soldier.z);h.play(4,speed);assert.ok(enemy.hp<10000);
    Object.assign(enemy,{x:70,z:40});h.play(7,speed);
    assert.ok(Math.hypot(soldier.x-24,soldier.z+8)<1.5);assert.equal(soldier.armyOrder.kind,'hold');
  }finally{h.close();}
});

test('retreat finishes an already committed hit once, then ignores nearby enemies',()=>{
  const h=createGameHarness(),a=h.api;
  try{
    const soldier=a.agents.find(u=>u.role==='soldier');isolate(h,{agents:[soldier],time:21});
    Object.assign(soldier,{x:24,z:-8});const m=stationaryMonster(h,24,-6.4);
    h.play(.1,1);assert.equal(soldier.combat.phase,'windup');
    a.army.select(soldier);assert.equal(a.army.issue('retreat',{x:16,z:4}),true);
    h.play(.1,1);assert.equal(m.hp,9976);h.play(6,5);assert.equal(m.hp,9976);
    assert.ok(Math.hypot(soldier.x-16,soldier.z-4)<1.5);assert.equal(soldier.armyOrder.kind,'retreat');
  }finally{h.close();}
});

test('a moving formation crosses the existing bridge and reaches distinct positions',()=>{
  const h=createGameHarness(),a=h.api;
  try{
    const soldiers=a.agents.filter(u=>u.role==='soldier');isolate(h,{agents:soldiers,time:12});
    a.army.selectAll();assert.equal(a.army.issue('move',{x:-28,z:20}),true);h.play(60,5);
    for(const u of soldiers)assert.ok(Math.hypot(u.x-u.armyOrder.slotX,u.z-u.armyOrder.slotZ)<2,`${u.name} must arrive`);
    assert.ok(Math.hypot(soldiers[0].x-soldiers[1].x,soldiers[0].z-soldiers[1].z)>1.8);
  }finally{h.close();}
});

for(const speed of [1,5])test(`safe workers continue deliveries at night while enemies exist elsewhere at ${speed}x`,()=>{
  const h=createGameHarness(),a=h.api;
  try{
    const worker=a.agents.find(u=>u.role==='villager');isolate(h,{agents:[worker],time:21});
    Object.assign(worker,{x:8,z:0,carryType:'wood',carryAmount:5});const stock=a.state.wood;
    stationaryMonster(h,70,50);h.play(6,speed);
    assert.ok(a.state.wood>=stock+5);assert.notEqual(worker.state,'SHELTER');
  }finally{h.close();}
});

test('local danger beats hunger, preserves cargo/orders, and clears only after a safe delay',()=>{
  const h=createGameHarness(),a=h.api;
  try{
    const worker=a.agents.find(u=>u.role==='villager');isolate(h,{agents:[worker],time:21});
    Object.assign(worker,{x:8,z:0,hunger:70,carryType:'wood',carryAmount:5});a.economy.issueOrder(worker,'ore');
    const enemy=stationaryMonster(h,12,0),stock=a.state.wood;
    h.play(.1,1);assert.equal(worker.state,'SHELTER');assert.equal(worker.carryAmount,5);assert.equal(worker.workOrder.resource,'ore');
    enemy.alive=false;h.play(2,1);assert.equal(worker.state,'SHELTER');
    h.play(25,5);assert.equal(worker.workOrder.resource,'ore');assert.notEqual(worker.state,'SHELTER');assert.ok(a.state.wood>=stock+5);
  }finally{h.close();}
});

test('an unsafe job waits while a worker in a safe area still deposits supplies',()=>{
  const h=createGameHarness(),a=h.api;
  try{
    const workers=a.agents.filter(u=>u.role==='villager').slice(0,2);isolate(h,{agents:workers,time:21});
    const ore=a.ores[0];Object.assign(ore,{x:35,z:0,oreAmount:100});a.ores.splice(1);
    Object.assign(workers[0],{x:0,z:0});a.economy.issueOrder(workers[0],'ore');
    Object.assign(workers[1],{x:8,z:0,carryType:'food',carryAmount:5});const stock=a.state.food;
    stationaryMonster(h,35,0);h.play(3,5);
    assert.equal(workers[0].state,'SHELTER');assert.ok(a.state.food>=stock+5);
  }finally{h.close();}
});

test('compact battle decisions retain current speed, camera, focus and the same unanswered question',()=>{
  const h=createGameHarness(),a=h.api,d=h.window.document;
  try{
    stationaryMonster(h,60,40);a.army.render();h.click('[data-speed="2.5"]');
    d.getElementById('btn-select-army').focus();const focus=d.activeElement,camera={...a.camCtrl.target};
    a.openInteractiveDilemma(4,false,true);
    assert.equal(a.state.timeScale,2.5);assert.deepEqual({...a.camCtrl.target},camera);assert.equal(d.activeElement===focus,true);
    assert.equal(d.getElementById('dl-choices').children.length,3);assert.equal(d.getElementById('btn-decision-continue').hidden,true);
    h.click('#btn-decision-details');assert.equal(a.state.timeScale,0);h.click('#btn-close-dilemma');assert.equal(a.state.timeScale,2.5);
    h.click('#dl-choice-2');assert.equal(a.state.timeScale,2.5);
  }finally{h.close();}
});

test('HUD switches independently of simulation/selection and uses real daytime threats and pending reinforcements',()=>{
  const h=createGameHarness(),a=h.api,d=h.window.document;
  try{
    h.click('[data-speed="0"]');a.army.selectAll();a.army.issue('hold',{x:24,z:-8});const ids=[...a.army.snapshot.selected],camera={...a.camCtrl.target};
    const m=stationaryMonster(h,65,-40);a.army.render();assert.equal(d.body.dataset.hudView,'battle');
    h.click('[data-hud-view="city"]');assert.equal(d.body.dataset.hudView,'city');assert.equal(a.state.timeScale,0);assert.deepEqual({...a.camCtrl.target},camera);
    assert.deepEqual([...a.army.snapshot.selected],ids);assert.ok(a.army.selected().every(u=>u.armyOrder.kind==='hold'));
    m.alive=false;a.state.timeOfDay=21;a.state.siegeTriggeredTonight=true;a.state.secondWaveTonight=false;
    h.click('[data-hud-view="auto"]');assert.equal(a.army.phase,'waiting');assert.equal(d.body.dataset.hudView,'battle');
    a.state.secondWaveTonight=true;a.army.render();assert.equal(a.army.phase,'recovery');assert.equal(d.body.dataset.hudView,'city');
    a.previewEra(2);assert.equal(a.army.selected().length,0);assert.equal(a.army.awaiting,false);
  }finally{h.close();}
});

test('aim cancellation, invalid ground and a selected unit death never issue stale orders',()=>{
  const h=createGameHarness(),a=h.api;
  try{
    a.army.selectAll();a.army.begin('hold');assert.equal(a.army.awaiting,true);
    a.setGodPower('rain');assert.equal(a.army.awaiting,false);assert.ok(a.army.selected().every(u=>!u.armyOrder));
    assert.equal(a.army.issue('hold',{x:-10,z:0}),false);assert.ok(a.army.selected().every(u=>!u.armyOrder));
    const first=a.state.selectedEntity;first.alive=false;a.state.selectedEntity=null;a.army.render();
    assert.equal(a.army.selected().length,1);assert.equal(a.state.selectedEntity===first,false);
    a.economy.chooseWorker();a.army.render();assert.equal(a.army.selected().length,0);
  }finally{h.close();}
});

test('attack area orders acquire enemies along their route but do not chase outside the bounded corridor',()=>{
  const unit={x:0,z:0,armyOrder:{kind:'attack',x:20,z:0,slotX:20,slotZ:0,startX:0,startZ:0}},near={x:7,z:1,hp:10,alive:true},far={x:0,z:60,hp:10,alive:true};
  assert.equal(armyAction(unit,[near,far]).target===near,true);assert.equal(armyAction(unit,[far]).kind,'move');
});

test('recovery counts reinforcements lost during the same fight',()=>{
  const h=createGameHarness(),a=h.api;
  try{
    const m=stationaryMonster(h,70,40);a.army.render();h.click('#btn-train-soldier');
    a.agents.at(-1).alive=false;m.alive=false;a.army.render();
    assert.equal(a.army.phase,'recovery');assert.match(h.window.document.getElementById('night-guidance').textContent,/เสียทหาร 1/);
  }finally{h.close();}
});
