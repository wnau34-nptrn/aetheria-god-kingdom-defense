// Simulation data only. The runtime owns movement, meshes and DOM feedback.
export const RESOURCE_INFO = {
  wood: { name: 'ไม้', source: 'คนงานตัดต้นไม้ → แบกครั้งละ 5 → ส่งคลังกลาง', use: 'ใช้สร้างบ้านและป้อม', color: 0xb88953 },
  ore: { name: 'แร่ศิลา', source: 'คนงานขุดก้อนแร่ → แบกครั้งละไม่เกิน 4 → ส่งคลังกลาง', use: 'ใช้สร้างบ้านและป้อม', color: 0x94a3b8 },
  food: { name: 'อาหาร', source: 'เก็บผลไม้ ทำไร่ หรือตกปลา → แบกกลับคลังกลาง', use: 'ชาวเมืองกินเสบียงเมื่อหิว · ฝนและเหตุการณ์ให้โบนัสเข้าคลังทันที', color: 0xfb7185 },
  faith: { name: 'ศรัทธา', source: 'ฟื้นพื้นฐาน 0.45 ต่อวินาทีเกม · ได้เพิ่มจากส่งของ พักพิง ค้าขาย รุ่งอรุณ และปราบอสูร', use: 'ใช้พลังเทพ เพิ่มชาวบ้าน และแต่งตั้งทหาร · สูงสุด 200', color: 0xddc58b }
};
export const CONSTRUCTION_COST = { wood: 25, ore: 18 };

export function workerResource(agent) {
  if (agent.workOrder) return agent.workOrder.resource;
  if (agent.role === 'farmer' || agent.role === 'fisherman') return 'food';
  if (agent.role === 'merchant') return 'faith';
  if (agent.role === 'villager') return agent.id % 2 === 0 ? 'wood' : 'ore';
  return null;
}

export function availableNode(node, resource) {
  if (resource === 'wood') return node.type === 'tree' && node.growth >= 0.55 && node.woodAmount > 0;
  if (resource === 'ore') return node.type === 'ore' && node.oreAmount > 0;
  return resource === 'food' && node.type === 'tree' && node.species === 'fruit' && node.hasFruit;
}

export function nearestResourceNode(agent, resource, nodes) {
  let nearest = null, distance = Infinity;
  for (const node of nodes) {
    if (!availableNode(node, resource)) continue;
    const next = Math.hypot(node.x - agent.x, node.z - agent.z);
    if (next < distance) { nearest = node; distance = next; }
  }
  return nearest;
}

export function resourceSummary(resource, agents) {
  const living = agents.filter(a => a.alive);
  const assigned = living.filter(a => workerResource(a) === resource);
  const cargo = living.filter(a => a.carryType === resource && a.carryAmount > 0);
  return {
    assigned,
    working: assigned.filter(a => ['GATHER', 'FARM', 'FISH', 'MARKET'].includes(a.state)),
    inTransit: cargo.reduce((sum, a) => sum + a.carryAmount, 0),
    cargo,
  };
}

export function depositCargo(agent, stock) {
  const resource = agent.carryType, amount = agent.carryAmount;
  if (!['wood', 'ore', 'food'].includes(resource) || !(amount > 0)) return null;
  stock[resource] += amount;
  agent.carryType = null; agent.carryAmount = 0;
  return { resource, amount };
}
