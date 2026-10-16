// Explicit controlled presentation fixture, never a normal player progression.
// The real runtime drives movement, windup, contact, damage, feedback and death.
export function installCombatFixture({group=false}={}) {
  const a=window.AETHERIA_API;
  a.state.timeScale=0;a.economy.reset();a.economy.select(null);
  if(group)a.evolveToEra(2);
  const soldiers=a.agents.filter(e=>e.alive&&e.role==='soldier').slice(0,group?3:1);
  const remove=e=>e.mesh?.parent?.remove(e.mesh);
  for(const e of a.agents)if(!soldiers.includes(e)){e.alive=false;remove(e);}
  a.agents.splice(0,a.agents.length,...soldiers);
  for(const e of [...a.buildings,...a.monsters,...a.projectiles,...a.wagons,...a.livestock])remove(e);
  a.buildings.length=a.monsters.length=a.projectiles.length=a.wagons.length=a.livestock.length=0;
  Object.assign(a.state,{timeOfDay:21,isNight:true,siegeTriggeredTonight:true,secondWaveTonight:true,autoBuild:false,selectedEntity:null});
  const cx=32,cz=-24;
  for(const tree of a.trees)if(Math.hypot(tree.x-cx,tree.z-cz)<6)tree.mesh.visible=false;
  for(let i=0;i<soldiers.length;i++){
    const s=soldiers[i];s.x=cx-0.9;s.z=cz+(i-(soldiers.length-1)/2)*2.2;s.hunger=0;s.combat=null;
    s.mesh.position.set(s.x,window._getTerrainHeightAt(s.x,s.z),s.z);
    a.spawnMonster(1);const m=a.monsters.at(-1);
    m.x=group?cx+3:cx+0.9;m.z=s.z;m.hp=m.maxHp=500;m.dmg=15;m.combat=null;
    m.mesh.position.set(m.x,window._getTerrainHeightAt(m.x,m.z),m.z);
  }
  a.camCtrl.followEntity=null;a.camCtrl.target.set(cx,window._getTerrainHeightAt(cx,cz)+1,cz);
  a.camCtrl.targetRadius=group?27:18;a.camCtrl.targetTheta=0.8;a.camCtrl.targetPhi=1.0;
  a.camCtrl.radius=a.camCtrl.targetRadius;a.camCtrl.theta=a.camCtrl.targetTheta;a.camCtrl.phi=a.camCtrl.targetPhi;
  a.updateHUD();
  return {contacts:a.combatFeedback.contacts,falls:a.combatFeedback.falls,time:a.simulationTime};
}

// Arm before clicking Play: slow software WebGL/IPC must not miss the first hit.
export function armCombatPause(condition) {
  window.__combatReached=false;
  const generation=window.__combatWatch=(window.__combatWatch||0)+1;
  function watch(){
    if(window.__combatWatch!==generation)return;
    const a=window.AETHERIA_API;
    const ready=condition.kind==='windup'?a.agents[0]?.combat?.phase==='windup':
      condition.kind==='contacts'?a.combatFeedback.contacts>=condition.value:
      condition.kind==='falls'?a.combatFeedback.falls>=condition.value:a.simulationTime>=condition.value;
    if(ready){a.state.timeScale=0;window.__combatReached=true;return;}
    requestAnimationFrame(watch);
  }
  requestAnimationFrame(watch);
}
