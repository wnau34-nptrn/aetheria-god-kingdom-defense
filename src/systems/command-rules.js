import { CONSTRUCTION_COST } from './economy.js';

export function recruitmentIssue(kind, state, agents, buildings) {
  const cost = kind === 'soldier' ? 25 : 20;
  if (kind === 'villager') {
    const population = agents.filter(a => a.alive).length;
    const capacity = 6 + buildings.filter(b => b.type === 'house').length * 4;
    if (population >= capacity) return `บ้านพักเต็มแล้ว (${population}/${capacity}) · สร้างบ้านเพิ่มก่อน`;
  }
  if (state.faith < cost) return `ศรัทธาไม่พอ · ต้องการ ${cost} (มี ${Math.floor(state.faith)})`;
  if (kind === 'soldier') {
    const workers = agents.filter(a => a.alive && a.role === 'villager');
    if (workers.length && workers.every(a => a.carryAmount > 0)) return 'คนงานกำลังขนของ · รอส่งคลังก่อนแต่งตั้งทหาร';
  }
  return null;
}

export function constructionRequirement(type, state, agents, buildings) {
  if (!agents.some(a => a.alive && a.role === 'villager')) return 'ต้องมีคนงานอย่างน้อย 1 คน';
  const limit = type === 'house' ? 3 + state.civEra * 3 : 1 + state.civEra * 2;
  if (buildings.filter(b => b.type === type).length >= limit) return 'อาคารชนิดนี้เต็มจำนวนของยุคแล้ว';
  if (state.wood < CONSTRUCTION_COST.wood || state.ore < CONSTRUCTION_COST.ore) return 'ทรัพยากรไม่พอ · ต้องมีไม้ 25 + แร่ 18 ในคลัง';
  return null;
}
