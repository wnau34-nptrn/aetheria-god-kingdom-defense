import { RESOURCE_INFO, CONSTRUCTION_COST, availableNode, nearestResourceNode, resourceSummary } from '../systems/economy.js';

// DOM/input adapter. Simulation keeps ownership of inventory and work progress.
export function createEconomyControls(env) {
  const { window: w, state, agents, trees, ores, buildings, camCtrl } = env;
  const d = w.document, el = id => d.getElementById(id);
  let plan = null, resource = 'wood', lastChange = '', nextWorker = 0;
  const deliveries = [];
  const closeDrawer = () => w.dispatchEvent(new w.Event('aetheria:close-drawer'));
  const nodes = r => (r === 'ore' ? ores : trees).filter(n => availableNode(n, r));
  const text = (id, value) => { if (el(id).textContent !== value) el(id).textContent = value; };
  function select(entity, focus = false) {
    state.selectedEntity = entity;
    el('inspector-card').classList.toggle('visible', !!entity);
    if (entity) {
      if (focus) { camCtrl.followEntity = null; camCtrl.target.copy(entity.mesh.position); camCtrl.targetRadius = 48; }
      env.updateInspector();
    }
  }
  function reset() {
    plan = null;
    el('construction-bar').hidden = true;
    env.hideReticle();
  }
  function chooseWorker() {
    const pool = agents.filter(a => a.alive && a.role === 'villager');
    if (!pool.length) { env.issue('ไม่มีคนงาน · เพิ่มชาวบ้านในแผงอาณาจักร (20 ศรัทธา)'); return; }
    const worker = pool[nextWorker++ % pool.length];
    reset(); closeDrawer(); env.setObserve(); select(worker, true);
  }
  function issueOrder(worker, kind) {
    if (!worker?.alive || worker.role !== 'villager' || !['wood', 'ore', 'food'].includes(kind)) return false;
    const target = nearestResourceNode(worker, kind, kind === 'ore' ? ores : trees);
    worker.workOrder = { resource: kind };
    worker.targetObj = target; worker.workTimer = 0; worker.buildTarget = null;
    lastChange = `${worker.name} รับคำสั่งเก็บ${RESOURCE_INFO[kind].name} · ${target ? 'AI หาแหล่งและเดินไปเก็บเอง' : 'ยังไม่มีแหล่งพร้อม · AI จะรอและค้นหาให้อัตโนมัติ'}${worker.carryAmount > 0 ? ' · ส่งของที่แบกอยู่เข้าคลังก่อน' : ''}`;
    reset(); env.setObserve(); select(worker); env.log(lastChange); env.notify(lastChange);
    return true;
  }
  function constructionIssue() {
    if (!plan?.point) return 'แตะพื้นเกาะเพื่อเลือกตำแหน่ง';
    const issue = env.placementIssue(plan.point.x, plan.point.z);
    if (issue) return issue;
    if (!agents.some(a => a.alive && a.role === 'villager')) return 'ต้องมีคนงานอย่างน้อย 1 คน';
    const limit = plan.type === 'house' ? 3 + state.civEra * 3 : 1 + state.civEra * 2;
    if (buildings.filter(b => b.type === plan.type).length >= limit) return 'อาคารชนิดนี้เต็มจำนวนของยุคแล้ว';
    if (state.wood < CONSTRUCTION_COST.wood || state.ore < CONSTRUCTION_COST.ore) return 'ทรัพยากรไม่พอ · ต้องมีไม้ 25 + แร่ 18 ในคลัง';
    return null;
  }
  function preview(point) {
    if (!plan) return;
    // Hover is a preview; after a tap/click the chosen point stays fixed until the next tap.
    const pos = plan.point || point;
    if (pos) env.showReticle(pos, !!env.placementIssue(pos.x, pos.z));
  }
  function updatePlan() {
    if (!plan) return;
    const issue = constructionIssue();
    el('construction-bar').dataset.state = issue ? 'blocked' : 'ready';
    text('construction-hint', `${plan.type === 'house' ? 'บ้าน' : 'ป้อม'} · ไม้ 25 + แร่ 18 · ${issue || 'ตำแหน่งพร้อม · ยืนยันเพื่อให้คนงานเริ่มสร้าง'}`);
    el('btn-confirm-construction').disabled = !!issue;
    if (plan.point) env.showReticle(plan.point, !!issue);
  }
  function beginConstruction(type) {
    if (!['house', 'tower'].includes(type)) return;
    reset(); closeDrawer(); env.setObserve(); plan = { type, point: null };
    el('inspector-card').classList.remove('visible');
    el('construction-bar').hidden = false; updatePlan();
  }
  function confirmConstruction() {
    const issue = constructionIssue();
    if (!plan || issue) { if (plan) env.issue(issue); return false; }
    const { type, point } = plan;
    // Revalidate at confirmation. No spending occurs when aiming or cancelling.
    const building = env.createBuilding(type, point.x, point.z);
    state.wood -= CONSTRUCTION_COST.wood; state.ore -= CONSTRUCTION_COST.ore;
    const worker = agents.filter(a => a.alive && a.role === 'villager').sort((a,b) => Math.hypot(a.x-point.x,a.z-point.z)-Math.hypot(b.x-point.x,b.z-point.z))[0];
    worker.buildTarget = building;
    lastChange = `เริ่มสร้าง${type === 'house' ? 'บ้าน' : 'ป้อม'} · จ่ายไม้ 25 + แร่ 18 · ${worker.name} จะไปก่อสร้างหลังส่งของ`;
    env.log(lastChange); env.notify(lastChange); reset(); select(building); env.updateHUD(); return true;
  }
  function chooseConstructionSite(point) {
    if (!plan) return false;
    plan.point = point; updatePlan(); return true;
  }
  function handlePoint(event) {
    if (plan) {
      chooseConstructionSite(env.terrainPoint(event)); return true;
    }
    return false;
  }
  function updatePanel() {
    if (el('economy-panel').hidden) return;
    const info = RESOURCE_INFO[resource], summary = resourceSummary(resource, agents);
    text('economy-title', info.name); text('economy-source', info.source); text('economy-use', info.use);
    text('economy-stock', `${Math.floor(state[resource])}`); text('economy-transit', `${summary.inTransit}`); text('economy-working', `${summary.working.length}`);
    const active = summary.assigned;
    text('economy-reason', resource === 'faith' ? `${state.timeScale === 0 ? 'หยุดเวลา · ศรัทธาจะฟื้นเมื่อเดินเวลา' : 'ศรัทธาฟื้นตามเวลาเกม'} · โบนัสพลัง/เหตุการณ์เข้าคลังทันที` : !active.length ? 'ยังไม่มีผู้รับผิดชอบ · เลือกคนงานแล้วสั่งเก็บ' : state.isNight ? 'กลางคืน · พักงานไปหลบภัย คำสั่งจะทำต่อในตอนเช้า' : summary.working.length ? 'เก็บ → แบก → ส่งที่วิหารกลางเมือง · ของระหว่างขนยังใช้สร้างไม่ได้' : 'ตรวจสถานะด้านล่าง: อาจกำลังกิน ขนของ ก่อสร้าง หรือรอแหล่งทรัพยากร');
    const rows = [...new Set([...active, ...summary.cargo])];
    const signature = rows.map(a => `${a.id}|${a.name}|${a.stateLabel}|${a.carryType}|${a.carryAmount}`).join(';');
    if (el('economy-workers').dataset.rows !== signature) {
      el('economy-workers').dataset.rows = signature;
      el('economy-workers').replaceChildren(...rows.map(a => {
        const li = d.createElement('li'), small = d.createElement('small'); li.textContent = a.name;
        small.textContent = `${a.stateLabel}${a.carryAmount ? ` · แบก${RESOURCE_INFO[a.carryType]?.name || ''} ${a.carryAmount}` : ''}`;li.append(small);return li;
      }));
    }
    text('economy-last-change', lastChange || 'ยังไม่มีการส่งของหรือคำสั่งใหม่ในรอบนี้');
    el('btn-economy-source').disabled = resource !== 'faith' && !nodes(resource).length;
  }
  function delivery(agent, result) {
    if (!result) return;
    lastChange = `${agent.name} ส่ง${RESOURCE_INFO[result.resource].name} +${result.amount} เข้าคลังแล้ว`;
    env.log(lastChange);
    const node = d.createElement('div'); node.className = 'economy-delivery'; node.textContent = `+${result.amount} ${RESOURCE_INFO[result.resource].name} · เข้าคลัง`;
    el('economy-feedback-layer').append(node);
    deliveries.push({ node, until: env.time() + 3, x: agent.x, z: agent.z });
    if (deliveries.length > 4) deliveries.shift().node.remove();
    env.updateHUD();
  }
  function render() {
    updatePlan(); updatePanel();
    for (let i = deliveries.length - 1; i >= 0; i--) {
      const item = deliveries[i];
      if (env.time() >= item.until) { item.node.remove(); deliveries.splice(i, 1); continue; }
      const p = env.project(item.x, env.height(item.x,item.z)+4, item.z);
      item.node.hidden = !p;
      if (p) { item.node.style.left = `${p.x}px`; item.node.style.top = `${p.y}px`; }
    }
  }
  for (const b of d.querySelectorAll('[data-resource]')) b.addEventListener('click', () => { resource = b.dataset.resource; });
  el('btn-select-worker').addEventListener('click', chooseWorker); el('btn-economy-worker').addEventListener('click', chooseWorker);
  el('btn-economy-source').addEventListener('click', () => {
    const pool = resource === 'faith' ? buildings.filter(b => b.type === 'temple') : nodes(resource);
    const target = [...pool].sort((a,b) => Math.hypot(a.x-camCtrl.target.x,a.z-camCtrl.target.z)-Math.hypot(b.x-camCtrl.target.x,b.z-camCtrl.target.z))[0];
    if (target) { reset();closeDrawer();env.setObserve();select(target,true); }
  });
  d.querySelectorAll('[data-build]').forEach(b => b.addEventListener('click', () => beginConstruction(b.dataset.build)));
  el('auto-build').addEventListener('change', e => { state.autoBuild = e.target.checked; env.log(state.autoBuild ? 'เปิดสร้างอัตโนมัติ · ไม้ 25 + แร่ 18 ต่อหลัง' : 'ปิดสร้างอัตโนมัติ · เลือกตำแหน่งและยืนยันเอง'); });
  el('btn-cancel-construction').addEventListener('click', reset);
  el('btn-confirm-construction').addEventListener('click', confirmConstruction);
  // Delegate because inspector contents refresh as the unit's status changes.
  el('insp-body').addEventListener('click', e => {
    const button = e.target.closest('[data-worker-resource]'); if (!button) return;
    const worker = state.selectedEntity; if (!worker?.alive || worker.role !== 'villager') return;
    if (button.dataset.workerResource === 'auto') {
      worker.workOrder = null; worker.targetObj = null; worker.workTimer = 0; worker.buildTarget = null;
      reset(); select(worker); env.log(`${worker.name} กลับไปทำงานอัตโนมัติ`);
    } else issueOrder(worker, button.dataset.workerResource);
  });
  return { reset, select, chooseWorker, beginOrder: issueOrder, issueOrder, handlePoint, preview, beginConstruction, chooseConstructionSite, confirmConstruction, updatePanel, delivery, render,
    get active() { return !!plan; } };
}
