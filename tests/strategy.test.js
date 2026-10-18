import {test} from 'node:test';
import assert from 'node:assert/strict';
import {armyAction} from '../src/systems/battle.js';
import {createStrategyDirector,strategicContext} from '../src/systems/strategy.js';
import {createGameHarness,isolate,stationaryMonster} from './helpers/game-harness.js';

for(const speed of [1,5])test(`city decisions assign workers and deliver real wood without selection at ${speed}x`,()=>{
 const h=createGameHarness({decisions:true}),a=h.api;
 try{
  h.click('[data-speed="0"]');const camera={...a.camCtrl.target},faith=a.state.faith,stock=a.state.wood;
  h.click('[data-strategy-action="wood"]');
  assert.equal(a.state.selectedEntity,null);assert.deepEqual({...a.camCtrl.target},camera);assert.equal(a.state.faith,faith);
  assert.equal(a.strategy.snapshot.city,'wood');assert.ok(a.agents.some(w=>w.strategyAssignment?.kind==='wood'));
  assert.equal(a.economy.active,false);h.play(20,speed);assert.ok(a.state.wood>stock);
  assert.equal(a.state.selectedEntity,null);assert.equal(a.strategy.snapshot.city,'wood');
 }finally{h.close();}
});

test('changing a city decision preserves cargo and leaves an assigned construction worker on the project',()=>{
 const h=createGameHarness({decisions:true}),a=h.api;
 try{
  const workers=a.agents.filter(w=>w.role==='villager'),builder=workers[0],carrier=workers[1],house=a.buildings.find(b=>b.type==='house');
  builder.buildTarget=house;house.progress=.3;carrier.carryType='wood';carrier.carryAmount=5;
  a.strategy.choose('ore');assert.equal(builder.buildTarget===house,true);assert.equal(carrier.carryType,'wood');assert.equal(carrier.carryAmount,5);
  assert.equal(a.state.selectedEntity,null);a.strategy.choose('balanced');assert.equal(carrier.carryAmount,5);assert.equal(builder.buildTarget===house,true);
 }finally{h.close();}
});

for(const speed of [1,5])test(`attack decision picks a threat, deals damage, retargets and includes reinforcements at ${speed}x`,()=>{
 const h=createGameHarness({decisions:true}),a=h.api;
 try{
  const soldiers=a.agents.filter(u=>u.role==='soldier');isolate(h,{agents:soldiers,time:21});
  const first=stationaryMonster(h,24,-8),second=stationaryMonster(h,50,25);a.updateHUD();
  h.click('[data-strategy-action="attack"]');assert.equal(a.strategy.snapshot.target,first.entityId);
  assert.ok(soldiers.every(u=>u.armyOrder?.kind==='attack'));assert.equal(a.state.selectedEntity,null);
  h.play(6,speed);assert.ok(first.hp<10000);first.alive=false;h.play(2.1,speed);
  assert.equal(a.strategy.snapshot.target,second.entityId);
  const faith=a.state.faith;h.click('[data-strategy-action="soldier"]');
  assert.ok(Math.abs(a.state.faith-faith+25)<1e-7);assert.equal(a.agents.at(-1).armyOrder.kind,'attack');assert.equal(a.state.selectedEntity,null);
 }finally{h.close();}
});

test('retreat decision finishes the committed hit once and moves the army back without new targets',()=>{
 const h=createGameHarness({decisions:true}),a=h.api;
 try{
  const soldier=a.agents.find(u=>u.role==='soldier');isolate(h,{agents:[soldier],time:21});Object.assign(soldier,{x:24,z:-8});
  const enemy=stationaryMonster(h,24,-6.4);h.play(.1,1);assert.equal(soldier.combat.phase,'windup');
  a.strategy.choose('retreat');const before=Math.hypot(soldier.x-soldier.armyOrder.slotX,soldier.z-soldier.armyOrder.slotZ);
  h.play(.1,1);assert.equal(enemy.hp,9976);h.play(6,5);assert.equal(enemy.hp,9976);
  assert.ok(Math.hypot(soldier.x-soldier.armyOrder.slotX,soldier.z-soldier.armyOrder.slotZ)<before);
  assert.equal(a.state.selectedEntity,null);
 }finally{h.close();}
});

test('construction decision picks a site and builder, pays once, and completes without aiming',()=>{
 const h=createGameHarness({decisions:true}),a=h.api;
 try{
  h.click('[data-speed="0"]');a.state.wood=a.state.ore=100;a.strategyUI.render();
  const count=a.buildings.length;h.click('[data-strategy-action="house"]');
  assert.equal(a.state.wood,75);assert.equal(a.state.ore,82);assert.equal(a.buildings.length,count+1);assert.equal(a.economy.active,false);assert.equal(a.state.selectedEntity,null);
  const house=a.buildings.at(-1);assert.ok(a.agents.some(u=>u.buildTarget===house));h.play(25,5);assert.equal(house.progress,1);
 }finally{h.close();}
});

test('a rejected automatic site spends nothing and creates no project',()=>{
 const state={wood:100,ore:100,civEra:1,faith:100},agents=[{alive:true,role:'villager',x:0,z:0}],buildings=[];let created=0,issue='';
 const director=createStrategyDirector({state,agents,buildings,monsters:[],trees:[],ores:[],time:()=>0,canStand:()=>true,placementIssue:()=> 'blocked',construct:()=>{created++;},issue:s=>issue=s,notify:()=>{}});
 assert.equal(director.choose('house'),false);assert.equal(created,0);assert.equal(state.wood,100);assert.equal(state.ore,100);assert.match(issue,/ไม่มีการหัก/);
});

test('repair decision restores an existing building and then returns the worker to its earlier job',()=>{
 const h=createGameHarness({decisions:true}),a=h.api;
 try{
  const worker=a.agents.find(u=>u.role==='villager'),temple=a.buildings.find(b=>b.type==='temple');isolate(h,{agents:[worker],buildings:[temple],time:12});
  Object.assign(worker,{x:8,z:0,workOrder:{resource:'ore'}});temple.hp=47;
  assert.equal(a.strategy.choose('repair'),true);h.play(30,5);assert.equal(temple.hp,temple.maxHp);
  assert.equal(a.strategy.snapshot.city,'balanced');assert.equal(worker.workOrder.resource,'ore');assert.equal(a.state.selectedEntity,null);
 }finally{h.close();}
});

test('resource decisions avoid threatened nodes and keep the order while no safe source is available',()=>{
 const h=createGameHarness({decisions:true}),a=h.api;
 try{
  const worker=a.agents.find(u=>u.role==='villager');isolate(h,{agents:[worker],time:12});Object.assign(worker,{x:0,z:0});
  a.ores.splice(1);Object.assign(a.ores[0],{x:35,z:0,oreAmount:100});const enemy=stationaryMonster(h,35,0);
  a.strategy.choose('ore');h.play(2,5);assert.equal(worker.workOrder.resource,'ore');assert.equal(worker.targetObj,null);assert.notEqual(worker.state,'GATHER');
  enemy.alive=false;h.play(25,5);assert.ok(a.state.ore>15||worker.carryAmount>0);
 }finally{h.close();}
});

test('compact city questions keep time, camera and focus and decisions remain usable',()=>{
 const h=createGameHarness({decisions:true}),a=h.api,d=h.window.document;
 try{
  h.click('[data-speed="2.5"]');d.querySelector('[data-strategy-action="wood"]').focus();const focus=d.activeElement,camera={...a.camCtrl.target};
  a.openInteractiveDilemma(2,false,true);assert.equal(a.state.timeScale,2.5);assert.deepEqual({...a.camCtrl.target},camera);assert.equal(d.activeElement===focus,true);
  assert.equal(d.getElementById('decision-card').parentElement.id,'god-dock-wrapper');h.click('[data-strategy-action="ore"]');assert.equal(a.strategy.snapshot.city,'ore');assert.equal(a.state.selectedEntity,null);
  h.click('#btn-decision-details');assert.equal(a.state.timeScale,0);h.click('#btn-close-dilemma');assert.equal(a.state.timeScale,2.5);
 }finally{h.close();}
});

test('normal advancement preserves decisions but a new sandbox world clears them',()=>{
 const h=createGameHarness({decisions:true}),a=h.api;
 try{
  h.click('[data-speed="0"]');a.strategy.choose('wood');a.strategy.choose('guard');const worker=a.agents.find(u=>u.role==='villager');a.state.civProgress=100;
  assert.equal(a.strategy.choose('advance'),true);assert.equal(a.agents.includes(worker),true);assert.equal(a.strategy.snapshot.city,'wood');assert.equal(a.strategy.snapshot.military,'guard');
  a.previewEra(2);assert.equal(a.strategy.snapshot.city,'balanced');assert.equal(a.strategy.snapshot.military,'auto');assert.equal(a.agents.includes(worker),false);
 }finally{h.close();}
});

test('context prioritizes real daytime threats, allows city decisions during battle and never treats darkness as an enemy',()=>{
 const s={food:30,wood:20,ore:15,civEra:1,civProgress:0},agents=[{alive:true}],enemy={alive:true,hp:20};
 assert.equal(strategicContext(s,agents,[],[enemy],'combat').id,'battle');
 assert.equal(strategicContext(s,agents,[],[enemy],'combat','city').id,'materials');
 assert.equal(strategicContext(s,agents,[],[],'prepare').id,'prepare');
 assert.equal(strategicContext(s,agents,[],[],'city').id,'materials');
});


test('guard responds to an enemy inside the temple perimeter while formation slots remain valid',()=>{
 const soldier={alive:true,role:'soldier',entityId:'s1',x:12,z:0},enemy={alive:true,hp:20,entityId:'m1',x:5,z:0};
 const director=createStrategyDirector({state:{},agents:[soldier],buildings:[{type:'temple',x:0,z:0}],monsters:[enemy],trees:[],ores:[],time:()=>0,canStand:p=>Math.hypot(p.x,p.z)>9,notify:()=>{},issue:()=>{}});
 director.choose('guard');assert.equal(soldier.armyOrder.x,5);assert.ok(Math.hypot(soldier.armyOrder.slotX,soldier.armyOrder.slotZ)>9);
 assert.equal(armyAction(soldier,[enemy]).target,enemy);
});

test('a new construction project is preserved when its builder previously held a repair assignment',()=>{
 const h=createGameHarness({decisions:true}),a=h.api;
 try{
  const worker=a.agents.find(u=>u.role==='villager'),temple=a.buildings.find(b=>b.type==='temple');isolate(h,{agents:[worker],buildings:[temple],time:12});temple.hp=10;
  Object.assign(worker,{x:8,z:0});a.state.wood=a.state.ore=100;a.strategy.choose('repair');assert.equal(worker.buildTarget,temple);
  assert.equal(a.strategy.choose('house'),true);const project=a.buildings.at(-1);assert.equal(worker.buildTarget,project);
  a.strategy.update(a.simulationTime,true);assert.equal(worker.buildTarget,project);assert.ok(project.progress<1);
 }finally{h.close();}
});


test('battle context offers rebuilding the army instead of empty-unit maneuvers',()=>{
 const state={food:30},enemy={alive:true,hp:20};
 assert.deepEqual(strategicContext(state,[{alive:true,role:'villager'}],[],[enemy],'combat').actions,['soldier','tower','auto']);
 assert.deepEqual(strategicContext(state,[],[],[enemy],'combat').actions,['soldier','villager','auto']);
 assert.deepEqual(strategicContext(state,[{alive:true,role:'soldier'}],[],[enemy],'combat').actions,['guard','attack','retreat']);
});
