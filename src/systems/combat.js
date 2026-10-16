// Simulation-only melee timing. One hit at the contact point, independent of FPS.
const PROFILES = {
  soldier: { windup:0.15, strike:0.10, recovery:0.20, reach:1.85, damage:24 },
  stalker: { windup:0.20, strike:0.15, recovery:0.50, reach:1.85 },
  brute: { windup:0.35, strike:0.20, recovery:0.30, reach:2.05 },
  boss: { windup:0.45, strike:0.20, recovery:0.20, reach:2.25 }
};

export function combatProfile(entity) {
  return PROFILES[entity.role === 'soldier' ? 'soldier' : entity.isBoss ? 'boss' : entity.isBrute ? 'brute' : 'stalker'];
}

export function meleeReach(attacker, target) {
  const buildingRadius = target.type === 'temple' ? 3.6 : !['agent','monster'].includes(target.type) ? 1.6 : 0;
  return combatProfile(attacker).reach + buildingRadius;
}

export function validCombatTarget(target) {
  return !!target && target.alive !== false && target.hp > 0 && target.mesh?.visible !== false;
}

export function chooseCombatTarget(attacker, candidates) {
  const current = attacker.combat?.target;
  // Finish the committed motion even when its target dies or enters shelter.
  // Switching immediately erases the killing stroke before it is rendered.
  if(current&&attacker.combat.phase!=='idle')return current;
  if (candidates.includes(current) && validCombatTarget(current)) return current;
  let closest = null, distance = Infinity;
  for (const target of candidates) {
    if (!validCombatTarget(target)) continue;
    const d = Math.hypot(target.x-attacker.x, target.z-attacker.z);
    if (d < distance) { distance=d; closest=target; }
  }
  return closest;
}

export function clearMelee(entity) {
  entity.combat = null;
}

export function advanceMelee(attacker, target, dt) {
  const profile = combatProfile(attacker), reach = meleeReach(attacker,target);
  let action = attacker.combat;
  if (!action || action.target !== target) action = attacker.combat = { target, phase:'idle', time:0, hit:false, facing:0 };
  const result = { started:false, swing:false, hit:false };
  if (attacker.alive === false || (!validCombatTarget(target)&&action.phase==='idle')) { clearMelee(attacker); return result; }
  const distance = Math.hypot(target.x-attacker.x,target.z-attacker.z);
  if (action.phase === 'idle') {
    if (distance > reach) return result;
    action.time=0; action.hit=false; action.phase='windup';
    action.facing=Math.atan2(target.x-attacker.x,target.z-attacker.z);
    result.started=true;
  }
  const before=action.time;
  action.time += dt;
  result.swing=before<profile.windup-1e-9&&action.time+1e-9>=profile.windup;
  const contact = profile.windup + profile.strike * 0.5;
  if (!action.hit && action.time + 1e-9 >= contact) {
    action.hit=true;
    // A moving target may evade a committed swing; no remote damage.
    const dx=target.x-attacker.x,dz=target.z-attacker.z;
    const facingDot=distance<1e-6?1:(Math.sin(action.facing)*dx+Math.cos(action.facing)*dz)/distance;
    result.hit=validCombatTarget(target) && distance <= reach+0.3 && facingDot>=0.25;
  }
  action.phase=action.time < profile.windup-1e-9 ? 'windup' : action.time < profile.windup+profile.strike-1e-9 ? 'strike' : 'recover';
  if (action.time + 1e-9 >= profile.windup+profile.strike+profile.recovery) {
    action.phase='idle'; action.time=0;
  }
  return result;
}

// Gentle footprint correction, including opposing sides. Terrain validation is
// supplied by the runtime; this does not move units through a river or building.
export function separateCombatants(units, dt, canStand) {
  for (let i=0;i<units.length;i++) for (let j=i+1;j<units.length;j++) {
    const a=units[i],b=units[j];
    if (!validCombatTarget(a)||!validCombatTarget(b)) continue;
    let dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);
    const radius=e=>e.isBoss?0.88:e.isBrute?0.75:0.6;
    const minimum=radius(a)+radius(b);
    if (d>=minimum) continue;
    if (d<1e-6) { const angle=(i+1)*2.399963+j;dx=Math.cos(angle);dz=Math.sin(angle);d=1; }
    const push=Math.min(minimum-Math.hypot(b.x-a.x,b.z-a.z),dt*2.4)*0.5;
    for(const [unit,sign] of [[a,-1],[b,1]]) {
      if(unit.speed===0)continue;
      const x=unit.x+dx/d*push*sign,z=unit.z+dz/d*push*sign;
      if(canStand(unit,x,z)){unit.x=x;unit.z=z;}
    }
  }
}
