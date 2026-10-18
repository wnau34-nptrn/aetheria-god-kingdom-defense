import { chooseCombatTarget } from './combat.js';

export const ORDER_LABELS = { rally:'รวมพล', move:'เคลื่อนพล', hold:'รักษาแนวรับ', attack:'โจมตีพื้นที่', retreat:'ถอยกลับฐาน', auto:'AI อัตโนมัติ' };
export const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
export const livingEnemies = monsters => monsters.filter(m=>m.alive!==false&&m.hp>0);
export const threatened = (point,monsters,radius=20) => !!point&&livingEnemies(monsters).some(m=>distance(point,m)<radius);

export function battlePhase(state,monsters,time,recoveryUntil=0) {
  if(livingEnemies(monsters).length)return 'combat';
  const t=state.timeOfDay,night=t>=20||t<5.5;
  if(night&&!state.secondWaveTonight&&(state.siegeTriggeredTonight||t<4.5))return 'waiting';
  if(time<recoveryUntil)return 'recovery';
  if(t>=18&&t<20||t>=20&&!state.siegeTriggeredTonight)return 'prepare';
  return 'city';
}

// Atomic formation planning. No unit receives an order if there is no safe slot.
export function planArmyOrder(units,kind,point,canStand) {
  if(!ORDER_LABELS[kind]||kind==='auto'||!point||!Number.isFinite(point.x)||!Number.isFinite(point.z)||!canStand(point))return null;
  const slots=[],columns=Math.ceil(Math.sqrt(units.length));
  for(let i=0;i<units.length;i++) {
    const desired={x:point.x+(i%columns-(columns-1)/2)*2.6,z:point.z+(Math.floor(i/columns)-(Math.ceil(units.length/columns)-1)/2)*2.6};
    let slot=null;
    for(let r=0;r<=10&&!slot;r+=2)for(let n=0;n<(r?12:1);n++) {
      const p={x:desired.x+Math.cos(n*Math.PI/6)*r,z:desired.z+Math.sin(n*Math.PI/6)*r};
      if(canStand(p)&&slots.every(s=>distance(p,s)>1.8)){slot=p;break;}
    }
    if(!slot)return null;
    slots.push(slot);
  }
  return units.map((unit,i)=>({unit,order:{kind,x:point.x,z:point.z,slotX:slots[i].x,slotZ:slots[i].z,startX:unit.x,startZ:unit.z,arrived:false}}));
}

function routeDistance(point,order) {
  const dx=order.x-order.startX,dz=order.z-order.startZ,len=dx*dx+dz*dz;
  const t=len?Math.max(0,Math.min(1,((point.x-order.startX)*dx+(point.z-order.startZ)*dz)/len)):0;
  return Math.hypot(point.x-order.startX-dx*t,point.z-order.startZ-dz*t);
}

export function armyAction(unit,monsters) {
  const order=unit.armyOrder;
  if(!order)return null;
  // A command accepts the next action; a committed strike finishes exactly once.
  if(unit.combat?.target&&unit.combat.phase!=='idle')return {kind:'melee',target:unit.combat.target};
  const point={x:order.slotX,z:order.slotZ},atPoint=distance(unit,point)<1;
  if(atPoint)order.arrived=true;
  if(order.kind==='retreat')return {kind:atPoint?'rest':'move',point,label:atPoint?'ตั้งหลักที่ฐาน':'ถอนกำลังกลับฐาน'};
  let candidates=[];
  if(order.kind==='hold')candidates=livingEnemies(monsters).filter(m=>distance(m,order)<=11&&distance(m,unit)<=15);
  else if(order.kind==='attack')candidates=livingEnemies(monsters).filter(m=>distance(m,unit)<=13&&(distance(m,order)<=18||routeDistance(m,order)<=10));
  else if(order.arrived)candidates=livingEnemies(monsters).filter(m=>distance(m,order)<=6&&distance(m,unit)<=9);
  const target=chooseCombatTarget(unit,candidates);
  if(target)return {kind:'melee',target};
  return {kind:atPoint?'hold':'move',point,label:atPoint?'ประจำจุด · '+ORDER_LABELS[order.kind]:ORDER_LABELS[order.kind]};
}

export function civilianDanger(agent,goal,monsters,time) {
  if(threatened(agent,monsters,20)||threatened(goal,monsters,20))agent.safeAfter=time+4;
  return time<(agent.safeAfter||0);
}

export function chooseRefuge(agent,buildings,monsters,canStand) {
  const homes=buildings.filter(b=>(b.type==='house'&&b.progress>=1||b.type==='temple')&&canStand(b,true)&&!threatened(b,monsters,22));
  homes.sort((a,b)=>distance(a,agent)-distance(b,agent));
  if(homes.length)return {x:homes[0].x,z:homes[0].z,building:homes[0]};
  let best={x:agent.x,z:agent.z},score=-Infinity;
  for(const r of [8,16,28])for(let i=0;i<16;i++) {
    const p={x:agent.x+Math.cos(i*Math.PI/8)*r,z:agent.z+Math.sin(i*Math.PI/8)*r};
    if(!canStand(p,false))continue;
    const safety=Math.min(60,...livingEnemies(monsters).map(m=>distance(p,m)))-r*.15;
    if(safety>score){score=safety;best=p;}
  }
  return best;
}
