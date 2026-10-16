import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameHarness, isolate } from './helpers/game-harness.js';
import { availableNode, resourceSummary } from '../src/systems/economy.js';

for (const speed of [1, 5]) for (const resource of ['wood','ore','food']) {
  test(`ordered ${resource} is carried before being deposited once at ${speed}x`, () => {
    const h=createGameHarness(),a=h.api;
    try {
      const worker=a.agents.find(x=>x.role==='villager');isolate(h,{agents:[worker]});
      Object.assign(worker,{x:12,z:8});
      const target=resource==='ore'?a.ores[0]:a.trees.find(t=>t.species==='fruit');
      Object.assign(target,{x:12,z:8,growth:1,hasFruit:true,woodAmount:50,oreAmount:resource==='ore'?3:50});
      a.state[resource]=0;
      assert.equal(a.economy.issueOrder(worker,resource,target),true);
      h.play(1.6,speed);
      const expected=resource==='wood'?5:resource==='ore'?3:2;
      assert.equal(a.state[resource],0);assert.equal(worker.carryType,resource);assert.equal(worker.carryAmount,expected);
      assert.equal(resourceSummary(resource,a.agents).inTransit,expected);
      if(resource==='ore')assert.equal(target.oreAmount,0,'ore does not regenerate a free remainder');
      // Stop new harvesting without interrupting the delivery already in progress.
      worker.workOrder={resource,x:500,z:500};worker.targetObj=null;
      h.play(12,speed);
      assert.equal(a.state[resource],expected);assert.equal(worker.carryAmount,0);
      assert.match(h.window.document.querySelector('.log-entry').textContent,/เข้าคลังแล้ว/);
      h.play(1,speed);assert.equal(a.state[resource],expected,'one shipment is not counted twice');
    } finally {h.close();}
  });
}

test('a changed order retains existing cargo and hunger/night retain the new order',()=>{
 const h=createGameHarness(),a=h.api;
 try {
  const worker=a.agents.find(x=>x.role==='villager');isolate(h,{agents:[worker]});
  Object.assign(worker,{x:8,z:0,carryType:'wood',carryAmount:5});
  const ore=a.ores[0];Object.assign(ore,{x:15,z:8,oreAmount:50});
  assert.ok(a.economy.issueOrder(worker,'ore',ore));assert.equal(worker.carryType,'wood');assert.equal(worker.carryAmount,5);
  a.state.food=10;worker.hunger=70;h.play(.1,1);assert.equal(worker.state,'FORAGE');assert.equal(worker.workOrder.resource,'ore');
  worker.hunger=0;a.state.timeOfDay=21;h.play(.1,1);assert.equal(worker.state,'SHELTER');assert.equal(worker.carryAmount,5);assert.equal(worker.workOrder.resource,'ore');
  a.state.timeOfDay=9;h.play(15,5);assert.ok(a.state.wood>=25);assert.equal(worker.workOrder.resource,'ore');
 }finally{h.close();}
});

test('orders reject depleted or wrong resources and never assign soldiers or children',()=>{
 const h=createGameHarness(),a=h.api;
 try{const worker=a.agents.find(x=>x.role==='villager'),ore=a.ores[0];
  assert.equal(a.economy.issueOrder(worker,'wood',ore),false);
  ore.oreAmount=0;assert.equal(a.economy.issueOrder(worker,'ore',ore),false);
  ore.oreAmount=3;assert.equal(availableNode(ore,'ore'),true);
  for(const role of ['soldier','child'])assert.equal(a.economy.issueOrder(a.agents.find(x=>x.role===role),'ore',ore),false);
 }finally{h.close();}
});

test('manual gather orders win over opportunistic building and survive pause',()=>{
 const h=createGameHarness(),a=h.api;
 try{const worker=a.agents.find(x=>x.role==='villager'),house=a.buildings.find(x=>x.type==='house');isolate(h,{agents:[worker],buildings:[house]});
  const ore=a.ores[0];Object.assign(ore,{x:12,z:8,oreAmount:50});Object.assign(worker,{x:12,z:8});house.progress=.25;
  a.economy.issueOrder(worker,'ore',ore);h.play(1,1);assert.equal(worker.state,'GATHER');assert.equal(house.progress,.25);
  const snapshot={x:worker.x,z:worker.z,work:worker.workTimer,ore:a.state.ore};h.click('[data-speed="0"]');for(let i=0;i<20;i++)h.frame();
  assert.deepEqual({x:worker.x,z:worker.z,work:worker.workTimer,ore:a.state.ore},snapshot);
 }finally{h.close();}
});

test('cargo is delivered before a reserved building task begins',()=>{
 const h=createGameHarness(),a=h.api;
 try{const worker=a.agents.find(x=>x.role==='villager'),house=a.buildings.filter(x=>x.type==='house')[1];isolate(h,{agents:[worker],buildings:[house]});
  Object.assign(worker,{x:8,z:0,carryType:'wood',carryAmount:5,buildTarget:house});house.progress=.25;
  h.play(.1,1);assert.equal(worker.state,'HAUL');assert.equal(house.progress,.25);
  h.play(20,5);assert.equal(worker.carryAmount,0);assert.equal(house.progress,1);
 }finally{h.close();}
});

test('automatic construction defaults off and only spends after explicit opt-in',()=>{
 const h=createGameHarness(),a=h.api;
 try{a.state.wood=100;a.state.ore=100;const count=a.buildings.length;
  h.play(5,5);assert.equal(a.buildings.length,count);
  h.window.document.getElementById('auto-build').checked=true;h.window.document.getElementById('auto-build').dispatchEvent(new h.window.Event('change'));
  assert.equal(a.state.autoBuild,true);h.play(.1,1);assert.equal(a.buildings.length,count+1);
  assert.match(h.window.document.querySelector('.log-entry').textContent,/จ่ายไม้ 25 \+ แร่ 18/);
 }finally{h.close();}
});

for(const speed of [1,5])test(`confirmed construction spends once and is completed by a real worker at ${speed}x`,()=>{
 const h=createGameHarness(),a=h.api;
 try{const worker=a.agents.find(x=>x.role==='villager');isolate(h,{agents:[worker],buildings:a.buildings});
  a.state.wood=25;a.state.ore=18;const count=a.buildings.length;
  a.economy.beginConstruction('house');a.economy.chooseConstructionSite({x:-3,z:-8});
  assert.equal(a.state.wood,25);assert.equal(a.buildings.length,count);
  assert.equal(a.economy.confirmConstruction(),true);assert.equal(a.state.wood,0);assert.equal(a.state.ore,0);assert.equal(a.buildings.length,count+1);
  const house=a.buildings.at(-1);assert.equal(house.progress,.05);assert.equal(worker.buildTarget,house);
  assert.equal(a.economy.confirmConstruction(),false);assert.equal(a.buildings.length,count+1);
  h.play(25,speed);assert.equal(house.progress,1,'construction must require the worker to travel and work');
 }finally{h.close();}
});

test('construction cancellation, blocked foundations, insufficient stock and changed affordability never spend',()=>{
 const h=createGameHarness(),a=h.api;
 try{const count=a.buildings.length;a.state.wood=25;a.state.ore=18;
  a.economy.beginConstruction('house');a.economy.chooseConstructionSite({x:-3,z:-8});a.economy.reset();assert.equal(a.economy.confirmConstruction(),false);
  a.economy.beginConstruction('house');a.economy.chooseConstructionSite({x:0,z:0});assert.equal(a.economy.confirmConstruction(),false);
  a.economy.chooseConstructionSite({x:-3,z:-8});a.state.wood=24;assert.equal(a.economy.confirmConstruction(),false);
  assert.equal(a.state.wood,24);assert.equal(a.state.ore,18);assert.equal(a.buildings.length,count);
  a.state.wood=25;for(const worker of a.agents)if(worker.role==='villager')worker.alive=false;
  assert.equal(a.economy.confirmConstruction(),false);assert.equal(a.state.wood,25);
 }finally{h.close();}
});

test('choosing a job reveals its nearest source without assigning work or spending',()=>{
 const h=createGameHarness(),a=h.api;
 try{const worker=a.agents.find(x=>x.role==='villager');
  const stock={wood:a.state.wood,ore:a.state.ore,faith:a.state.faith};
  a.economy.select(worker);a.economy.beginOrder(worker,'ore');
  const nearest=a.ores.filter(n=>n.oreAmount>0).sort((x,y)=>Math.hypot(x.x-worker.x,x.z-worker.z)-Math.hypot(y.x-worker.x,y.z-worker.z))[0];
  assert.equal(a.camCtrl.target.x,nearest.mesh.position.x);assert.equal(a.camCtrl.target.z,nearest.mesh.position.z);
  assert.equal(worker.workOrder,undefined);assert.equal(a.economy.pendingResource,'ore');
  assert.deepEqual({wood:a.state.wood,ore:a.state.ore,faith:a.state.faith},stock);
  a.economy.reset();assert.equal(a.economy.active,false);
  for(const ore of a.ores)ore.oreAmount=0;
  a.economy.beginOrder(worker,'ore');assert.match(h.window.document.getElementById('work-command-hint').textContent,/ยังไม่มีแหล่ง/);
 }finally{h.close();}
});

test('the selected building reports completion on the exact simulation step it finishes',()=>{
 const h=createGameHarness(),a=h.api;
 try{const worker=a.agents.find(x=>x.role==='villager');isolate(h,{agents:[worker],buildings:a.buildings});a.state.wood=25;a.state.ore=18;
  a.economy.beginConstruction('house');a.economy.chooseConstructionSite({x:-3,z:-8});assert.ok(a.economy.confirmConstruction());
  const house=a.buildings.at(-1);
  // Controlled on-site finishing fixture; no simulation time has passed yet.
  Object.assign(worker,{x:house.x,z:house.z});house.progress=.99;a.updateHUD();
  assert.match(h.window.document.getElementById('insp-body').textContent,/99%/);
  h.play(.05,1);assert.equal(house.progress,1);
  assert.match(h.window.document.getElementById('insp-body').textContent,/ก่อสร้างเสร็จแล้ว/);
 }finally{h.close();}
});
