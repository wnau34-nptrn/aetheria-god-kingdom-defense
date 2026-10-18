import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameHarness, isolate, stationaryMonster } from './helpers/game-harness.js';
import { createEntityIdentity } from '../src/systems/entity-identity.js';
import { nextCivilization, progressionIssue } from '../src/systems/progression.js';

test('civilization rules require a completed current era and advance only one step', () => {
  for (const civEra of [1, 2, 3]) {
    assert.equal(nextCivilization({ civEra, civProgress:99.99 }), null);
    assert.deepEqual(nextCivilization({ civEra, civProgress:100 }), { civEra:civEra+1, civProgress:civEra===3?100:0 });
  }
  for (const civEra of [0, 1.5, 4, 5, NaN]) assert.equal(nextCivilization({civEra,civProgress:100}),null);
  for (const civProgress of [NaN, Infinity, -1]) assert.ok(progressionIssue({civEra:1,civProgress}));
});

test('entity identity is serializable, immutable, idempotent and independent of mesh replacement', () => {
  const ids=createEntityIdentity(),person={id:7,role:'villager',mesh:{}},building={type:'house'};
  ids.assign(person);ids.assign(building);const original=person.entityId;
  person.mesh={};ids.assign(person);
  assert.equal(person.entityId,original);assert.equal(person.id,7);
  assert.notEqual(person.entityId,building.entityId);
  assert.equal(JSON.parse(JSON.stringify(person)).entityId,original);
  assert.throws(()=>{person.entityId=building.entityId;},TypeError);
});

test('normal advancement preserves invested buildings, cargo, orders, terrain, waves, projectiles and selection through all eras', () => {
  const h=createGameHarness(),a=h.api;
  try {
    h.click('[data-speed="0"]');a.state.wood=100;a.state.ore=100;a.state.faith=200;
    a.economy.beginConstruction('house');a.economy.chooseConstructionSite({x:-3,z:-8});assert.equal(a.economy.confirmConstruction(),true);
    const house=a.buildings.at(-1),workers=a.agents.filter(e=>e.role==='villager');
    const builder=workers.find(e=>e.buildTarget===house),carrier=workers.find(e=>e!==builder);
    assert.ok(builder);assert.ok(carrier);
    house.hp=53;house.maxHp+=50;
    a.economy.issueOrder(carrier,'ore');Object.assign(carrier,{carryType:'wood',carryAmount:5,hunger:42,hp:63,workTimer:.7});
    a.economy.select(carrier);a.camCtrl.followEntity=carrier;
    a.applyTerraforming(40,25,1,.08);const height=h.window._getTerrainHeightAt(40,25);
    a.spawnMonster(1);a.castMeteorStrike(60,-48);
    a.state.siegeTriggeredTonight=true;a.state.secondWaveTonight=true;
    const arrays=[a.agents,a.buildings,a.trees,a.ores,a.monsters,a.projectiles,a.wagons,a.livestock,a.cropFields];
    const members=arrays.map(list=>[...list]);
    const entities=members.flat();const data=entities.map(e=>({id:e.entityId,mesh:e.mesh,x:e.x,z:e.z,hp:e.hp,maxHp:e.maxHp,progress:e.progress}));
    const stock={food:a.state.food,wood:a.state.wood,ore:a.state.ore,faith:a.state.faith};
    for(const era of [2,3,4]) {
      a.state.civProgress=100;h.click('#btn-advance-era');assert.equal(a.state.civEra,era);
      arrays.forEach((list,i)=>{assert.equal(list.length,members[i].length);list.forEach((e,j)=>assert.equal(e,members[i][j]));});
      entities.forEach((e,i)=>assert.deepEqual({id:e.entityId,mesh:e.mesh,x:e.x,z:e.z,hp:e.hp,maxHp:e.maxHp,progress:e.progress},data[i]));
      assert.deepEqual({food:a.state.food,wood:a.state.wood,ore:a.state.ore,faith:a.state.faith},stock);
      assert.equal(h.window._getTerrainHeightAt(40,25),height);
      assert.equal(a.state.selectedEntity,carrier);assert.equal(a.camCtrl.followEntity,carrier);
      assert.equal(builder.buildTarget===house,true);assert.equal(house.progress,.05);
      assert.equal(carrier.carryAmount,5);assert.equal(carrier.carryType,'wood');assert.equal(carrier.workOrder.resource,'ore');
      assert.equal(carrier.hunger,42);assert.equal(carrier.workTimer,.7);
      assert.equal(a.state.siegeTriggeredTonight,true);assert.equal(a.state.secondWaveTonight,true);assert.equal(a.state.timeScale,0);
    }
    assert.equal(a.advanceEra(),false);assert.equal(a.state.civEra,4);
  } finally {h.close();}
});

for(const speed of [1,2.5,5]) test(`progress caps without replacing the city or automatically advancing at ${speed}x`,()=>{
  const h=createGameHarness(),a=h.api;
  try {
    const worker=a.agents[0];a.state.civProgress=99.99;h.play(1,speed);
    assert.equal(a.state.civEra,1);assert.equal(a.state.civProgress,100);assert.equal(a.agents[0],worker);
    assert.equal(h.window.document.getElementById('btn-advance-era').getAttribute('aria-disabled'),'false');
    h.click('[data-speed="0"]');h.click('#btn-advance-era');assert.equal(a.state.civEra,2);
    h.click('#btn-advance-era');assert.equal(a.state.civEra,2,'a repeated click cannot skip another era');
  } finally {h.close();}
});

test('a committed melee strike and its target survive normal advancement and apply damage once',()=>{
  const h=createGameHarness(),a=h.api;
  try {
    const soldier=a.agents.find(e=>e.role==='soldier');isolate(h,{agents:[soldier],time:21});
    const monster=stationaryMonster(h,soldier.x,soldier.z+1.6);
    h.play(.1,1);assert.equal(soldier.combat.phase,'windup');
    const action=soldier.combat,contacts=a.combatFeedback.contacts;
    a.state.civProgress=100;a.advanceEra();assert.equal(soldier.combat,action);assert.equal(action.target,monster);
    h.play(.1,1);assert.equal(monster.hp,9976);assert.equal(a.combatFeedback.contacts,contacts+1);
    h.play(.1,1);assert.equal(monster.hp,9976);
  }finally{h.close();}
});

test('AI keeps delivering over the existing south bridge after normal advancement to era three',()=>{
  const h=createGameHarness(),a=h.api;
  try {
    const worker=a.agents.find(e=>e.role==='villager');isolate(h,{agents:[worker]});
    Object.assign(worker,{x:-28,z:-25,carryType:'ore',carryAmount:5});a.state.ore=0;
    for(const era of [2,3]){a.state.civProgress=100;assert.equal(a.advanceEra(),true);assert.equal(a.state.civEra,era);}
    assert.deepEqual([...a.worldLayout.bridgeLevels],[14]);
    assert.equal(a.worldLayout.well,false);assert.equal(a.worldLayout.pasture,false);
    assert.equal(a.isNearBuildingFoundation(24,31,0),false,'no invisible livestock corral is reserved');
    h.play(55,5);assert.ok(a.state.ore>=5,'cargo must actually cross the existing bridge and arrive');
  }finally{h.close();}
});

test('new construction uses the new era while old buildings keep their health, bonuses and appearance',()=>{
  const h=createGameHarness(),a=h.api;
  try{
    const old=a.buildings.find(e=>e.type==='house'),mesh=old.mesh;old.hp=42;old.maxHp+=50;
    a.state.civProgress=100;a.advanceEra();a.state.wood=25;a.state.ore=18;
    a.economy.beginConstruction('house');a.economy.chooseConstructionSite({x:-3,z:-8});assert.equal(a.economy.confirmConstruction(),true);
    const built=a.buildings.at(-1);assert.equal(built.era,2);assert.equal(built.maxHp,220);
    assert.equal(old.era,1);assert.equal(old.mesh,mesh);assert.equal(old.hp,42);assert.equal(old.maxHp,230);
  }finally{h.close();}
});

test('sandbox preview and island regeneration remain explicit resets with distinct entity identities',()=>{
  const h=createGameHarness(),a=h.api;
  try{
    const originals=[...a.agents,...a.buildings],ids=new Set(originals.map(e=>e.entityId));
    h.click('[data-era="3"]');assert.equal(a.state.civEra,3);assert.equal(a.agents.filter(e=>e.alive).length,23);
    assert.equal(originals.some(e=>a.agents.includes(e)||a.buildings.includes(e)),false);
    assert.equal([...a.agents,...a.buildings].some(e=>ids.has(e.entityId)),false);
    assert.deepEqual([...a.worldLayout.bridgeLevels],[14,-16]);assert.equal(a.worldLayout.well,true);
    assert.match(h.window.document.querySelector('#era-dock').title,/Sandbox/);
    h.click('#btn-regen-island');assert.equal(a.state.civEra,1);assert.equal(a.agents.filter(e=>e.alive).length,7);
    assert.deepEqual([...a.worldLayout.bridgeLevels],[14]);assert.equal(a.worldLayout.well,false);
  }finally{h.close();}
});
