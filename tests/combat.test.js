import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceMelee, chooseCombatTarget, combatProfile, separateCombatants } from '../src/systems/combat.js';
import { createGameHarness, isolate, stationaryMonster } from './helpers/game-harness.js';

const unit=(x=0,extra={})=>({type:'agent',role:'soldier',alive:true,hp:160,maxHp:160,x,z:0,mesh:{visible:true},...extra});
for(const kind of ['soldier','stalker','brute','boss'])test(`${kind} commits one contact per full attack, after its windup`,()=>{
  const a=unit(0,{role:kind==='soldier'?'soldier':null,isBrute:kind==='brute',isBoss:kind==='boss'}),b=unit(1.8);
  const p=combatProfile(a),cycle=p.windup+p.strike+p.recovery;
  let hits=0,first=null;
  for(let i=1;i<=Math.round(cycle*20)*3;i++){
    const result=advanceMelee(a,b,0.05);
    if(result.hit){hits++;first??=i*0.05;assert.ok(a.combat.phase==='strike'||a.combat.phase==='recover');}
  }
  assert.equal(hits,3);assert.ok(first>=p.windup+p.strike*0.5-1e-8);
});

test('a committed swing misses a target that leaves reach and cannot hit again on return',()=>{
  const a=unit(),b=unit(1.8);advanceMelee(a,b,0.05);b.x=8;
  assert.equal(advanceMelee(a,b,0.15).hit,false);b.x=1.8;
  assert.equal(advanceMelee(a,b,0.05).hit,false);
});
test('a target moving behind a committed swing is not hit',()=>{
  const a=unit(),b=unit(1.8);advanceMelee(a,b,0.05);b.x=-1.8;
  assert.equal(advanceMelee(a,b,0.15).hit,false);
});
test('target remains locked when a closer unit appears, but releases dead and sheltered targets',()=>{
  const a=unit(),b=unit(1.8),c=unit(0.8);advanceMelee(a,b,0.05);
  assert.equal(chooseCombatTarget(a,[b,c]),b);b.mesh.visible=false;
  assert.equal(chooseCombatTarget(a,[b,c]),c);b.mesh.visible=true;b.alive=false;
  assert.equal(chooseCombatTarget(a,[b,c]),c);
});
test('opposing footprints separate without entering blocked terrain or moving stationary fixtures',()=>{
  const a=unit(),b=unit(0,{type:'monster',role:null,speed:0});
  separateCombatants([a,b],0.05,()=>false);assert.equal(a.x,0);assert.equal(a.z,0);
  separateCombatants([a,b],0.05,()=>true);assert.ok(Math.hypot(a.x,a.z)>0);assert.equal(b.x,0);assert.equal(b.z,0);
});

function duel(){
  const h=createGameHarness(),a=h.api,s=a.agents.find(e=>e.role==='soldier');
  isolate(h,{agents:[s],time:21});
  const m=stationaryMonster(h,s.x+1.8,s.z);m.isBoss=m.isBrute=false;
  return {h,a,s,m};
}
test('actual runtime stops feet, applies damage at contact and freezes poses/feedback when paused',()=>{
  const {h,a,s,m}=duel();
  try{
    h.frame();const start={x:s.x,z:s.z};h.frame();assert.equal(m.hp,10000);assert.equal(s.combat.phase,'windup');
    const windupArm=s.rightArm.rotation.x;h.frame();h.frame();assert.equal(m.hp,9976);assert.equal(a.combatFeedback.contacts,1);
    assert.ok(s.rightArm.rotation.x>windupArm);assert.deepEqual({x:s.x,z:s.z},start);
    h.click('[data-speed="0"]');
    const read=()=>JSON.stringify({combat:s.combat.time,arm:s.rightArm.rotation.x,hp:m.hp,feedback:a.combatFeedback,pose:[m.mesh.position.x,m.mesh.rotation.z]});
    const paused=read();for(let i=0;i<10;i++)h.frame();assert.equal(read(),paused);
  }finally{h.close();}
});
test('a lethal melee hit retires once, falls visibly, stays frozen on pause and is cleaned up',()=>{
  const {h,a,m}=duel();
  try{
    m.hp=24;for(let i=0;i<4;i++)h.frame();
    assert.equal(m.alive,false);assert.ok(m.mesh.parent);assert.equal(a.combatFeedback.falls,1);
    h.advance(0.3,1);assert.ok(Math.abs(m.mesh.rotation.z)>0.1);
    h.click('[data-speed="0"]');const z=m.mesh.rotation.z;for(let i=0;i<8;i++)h.frame();assert.equal(m.mesh.rotation.z,z);
    h.advance(1.1,1);assert.equal(m.mesh.parent,null);assert.equal(a.combatFeedback.corpses,0);assert.equal(a.combatFeedback.falls,1);
  }finally{h.close();}
});
test('temple protection still restores HP and reflects damage at the monster contact',()=>{
  const h=createGameHarness(),a=h.api;
  try{
    const temple=a.buildings.find(e=>e.type==='temple');isolate(h,{buildings:[temple],time:21});temple.hp=1;
    const m=stationaryMonster(h,temple.x+5.3,temple.z);m.isBoss=m.isBrute=false;m.dmg=10;
    h.advance(0.3,1);assert.equal(temple.hp,Math.round(temple.maxHp*0.65));assert.equal(m.hp,9915);assert.equal(a.combatFeedback.falls,0);
  }finally{h.close();}
});
test('burst feedback is bounded, and a new era clears effects and fallen meshes',()=>{
  const {h,a,m,s}=duel();
  try{
    m.hp=m.maxHp=s.hp=s.maxHp=100000;for(let i=0;i<30;i++){a.state.faith=200;a.castLightningStrike(m.x,m.z);}
    assert.equal(a.combatFeedback.contacts,60); // Enemy and nearby friendly soldier.
    assert.ok(a.combatFeedback.impacts<=12);assert.ok(a.combatFeedback.labels<=16);
    a.evolveToEra(2);assert.equal(a.combatFeedback.impacts,0);assert.equal(a.combatFeedback.labels,0);assert.equal(a.combatFeedback.corpses,0);
  }finally{h.close();}
});
