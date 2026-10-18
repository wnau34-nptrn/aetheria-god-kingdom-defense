import { ORDER_LABELS, battlePhase, livingEnemies, planArmyOrder } from '../systems/battle.js';
import { clearMelee } from '../systems/combat.js';

export function createArmyControls(env) {
  const {window:w,state,agents,monsters,buildings,camCtrl}=env,d=w.document,el=id=>d.getElementById(id);
  const ids=new Set();let aiming=null,view='auto',phase='city',lastEnemies=0,recoveryUntil=0,lastPrimary=null,savedCamera=null,lastLayout='',baseline=null;
  const text=(id,value)=>{if(el(id).textContent!==value)el(id).textContent=value;};
  const troops=()=>agents.filter(a=>a.alive&&a.role==='soldier');
  const selected=()=>troops().filter(a=>ids.has(a.entityId));
  function cancelAim(){aiming=null;el('army-aim').hidden=true;env.hideReticle();}
  function select(unit,add=false){
    if(!unit?.alive||unit.role!=='soldier')return false;
    if(!add)ids.clear();if(add&&ids.has(unit.entityId))ids.delete(unit.entityId);else ids.add(unit.entityId);
    state.selectedEntity=selected()[0]||null;lastPrimary=state.selectedEntity;
    el('inspector-card').classList.remove('visible');render();return true;
  }
  function selectAll(){env.setObserve();env.resetEconomy();ids.clear();for(const u of troops())ids.add(u.entityId);state.selectedEntity=selected()[0]||null;lastPrimary=state.selectedEntity;el('inspector-card').classList.remove('visible');if(!ids.size)env.issue('ยังไม่มีทหาร · กดทหาร +1 เพื่อเสริมกำลัง');render();}
  function issue(kind,point){
    const units=selected();if(!units.length){env.issue('เลือกทหารหรือกดเลือกทั้งกองก่อน');return false;}
    if(kind==='auto'){for(const u of units){u.armyOrder=null;if(u.combat?.phase==='idle')clearMelee(u);}cancelAim();render();return true;}
    const plans=planArmyOrder(units,kind,point,env.canStand);
    if(!plans){env.issue('จุดนี้จัดกองไม่ได้ · เลือกพื้นเกาะที่เดินถึงได้ ห่างแม่น้ำและอาคาร');return false;}
    for(const {unit,order} of plans){unit.armyOrder=order;unit.stateLabel=ORDER_LABELS[kind]+' · รับคำสั่งแล้ว';if(unit.combat?.phase==='idle')clearMelee(unit);}
    cancelAim();env.notify(`${ORDER_LABELS[kind]} · ${units.length} นาย รับคำสั่งแล้ว`);render();return true;
  }
  function begin(kind){
    if(!selected().length){env.issue('เลือกทหารหรือกดเลือกทั้งกองก่อน');return;}
    env.setObserve();env.resetEconomy();
    if(kind==='auto'){issue(kind);return;}
    if(kind==='rally'||kind==='retreat'){issue(kind,env.basePoint());return;}
    aiming=kind;text('army-aim-text',`${ORDER_LABELS[kind]} · แตะจุดบนพื้นเกาะ`);el('army-aim').hidden=false;render();
  }
  function reset(){ids.clear();lastPrimary=null;cancelAim();phase='city';lastEnemies=0;recoveryUntil=0;savedCamera=null;baseline=null;view='auto';}
  function sync(){
    if(env.passive?.()){ids.clear();if(aiming)cancelAim();lastPrimary=null;return;}
    let units=selected();
    if(!state.selectedEntity&&lastPrimary?.alive===false&&units.length)state.selectedEntity=units[0];
    if(state.selectedEntity?.role==='soldier'&&state.selectedEntity.alive){if(!ids.has(state.selectedEntity.entityId)){ids.clear();ids.add(state.selectedEntity.entityId);}}
    else if(ids.size){ids.clear();cancelAim();}
    lastPrimary=state.selectedEntity;
    if(!selected().length&&aiming)cancelAim();
  }
  function render(){
    sync();const count=livingEnemies(monsters).length,time=env.time();
    if(count&&!lastEnemies&&(!baseline||phase==='city'||phase==='recovery'))baseline={troops:troops().map(u=>u.entityId),buildings:buildings.map(b=>b.entityId)};
    if(baseline&&(count||phase==='waiting')){for(const u of troops())if(!baseline.troops.includes(u.entityId))baseline.troops.push(u.entityId);for(const b of buildings)if(!baseline.buildings.includes(b.entityId))baseline.buildings.push(b.entityId);}
    if(lastEnemies>0&&!count)recoveryUntil=time+10;
    lastEnemies=count;phase=battlePhase(state,monsters,time,recoveryUntil);
    const battle=view==='battle'||view==='auto'&&['prepare','combat','waiting'].includes(phase);
    d.body.dataset.hudView=battle?'battle':'city';
    text('battle-phase',({city:'พัฒนาเมือง',prepare:'เตรียมรับศึก',combat:'อสูรกำลังบุก',waiting:'รอทัพหนุน',recovery:'ฟื้นเมือง'})[phase]);
    const temple=buildings.find(b=>b.type==='temple');
    text('battle-temple',temple?`วิหาร ${Math.max(0,Math.ceil(temple.hp))}/${temple.maxHp}`:'ไม่มีวิหาร');
    if(phase==='recovery'&&baseline&&agents.some(a=>a.alive)){
      const losses=baseline.troops.filter(id=>!troops().some(u=>u.entityId===id)).length,damage=baseline.buildings.filter(id=>!buildings.some(b=>b.entityId===id)).length;
      text('night-guidance',`หลังศึก · เสียทหาร ${losses} · อาคาร ${damage} · คนงานกลับงาน/ซ่อมเมือง`);
    }
    const units=selected();text('army-count',`ทั้งกอง ${troops().length} · เลือก ${units.length}`);
    const statuses=[...new Set(units.map(u=>u.armyOrder?u.stateLabel||ORDER_LABELS[u.armyOrder.kind]:'AI อัตโนมัติ'))];
    text('army-state',units.length?statuses.join(' · '):'เลือกทหารบนเกาะ หรือกดเลือกทั้งกอง');
    el('army-task-bar').hidden=!(battle||units.length&&view!=='city');
    d.body.classList.toggle('army-selected',units.length>0);
    d.body.classList.toggle('battle-camera',!!savedCamera);
    for(const b of d.querySelectorAll('[data-army-order]')){b.setAttribute('aria-disabled',String(!units.length));b.setAttribute('aria-pressed',String(aiming===b.dataset.armyOrder||!aiming&&units.length>0&&units.every(u=>u.armyOrder?.kind===b.dataset.armyOrder)));}
    for(const b of d.querySelectorAll('button[data-hud-view]'))b.setAttribute('aria-pressed',String(b.dataset.hudView===view));
    const attacked=buildings.find(b=>livingEnemies(monsters).some(m=>m.combat?.target===b&&m.combat.phase!=='idle'));
    text('btn-battle-focus',attacked?.type==='temple'?'วิหารถูกโจมตี':attacked?'อาคารถูกโจมตี':count?'ไปจุดรบ':phase==='waiting'?'ดูแนวรับ':'ดูแนวหน้า');
    el('btn-battle-focus').classList.toggle('battle-alert',!!attacked);
    el('btn-return-city').hidden=!savedCamera;
    const signature=`${battle}|${units.length>0}|${!!aiming}`;
    if(signature!==lastLayout){lastLayout=signature;env.layout();}
  }
  function focusBattle(){
    if(!savedCamera)savedCamera={x:camCtrl.target.x,y:camCtrl.target.y,z:camCtrl.target.z,radius:camCtrl.targetRadius,theta:camCtrl.targetTheta,phi:camCtrl.targetPhi};
    const targets=livingEnemies(monsters),attacked=targets.map(m=>m.combat?.target).find(t=>t?.type==='temple')||targets.map(m=>m.combat?.target).find(t=>buildings.includes(t)),target=attacked||targets.sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0]||{x:38,z:-30};
    camCtrl.followEntity=null;camCtrl.target.set(target.x,env.height(target.x,target.z)+1,target.z);camCtrl.targetRadius=42;render();
  }
  el('btn-select-army').addEventListener('click',selectAll);
  for(const b of d.querySelectorAll('[data-army-order]'))b.addEventListener('click',()=>begin(b.dataset.armyOrder));
  for(const b of d.querySelectorAll('button[data-hud-view]'))b.addEventListener('click',()=>{view=b.dataset.hudView;render();});
  el('btn-army-cancel').addEventListener('click',()=>{cancelAim();render();});
  el('btn-battle-focus').addEventListener('click',focusBattle);
  function returnCity(){if(!savedCamera)return;camCtrl.followEntity=null;camCtrl.target.set(savedCamera.x,savedCamera.y,savedCamera.z);camCtrl.targetRadius=savedCamera.radius;camCtrl.targetTheta=savedCamera.theta;camCtrl.targetPhi=savedCamera.phi;savedCamera=null;render();}
  el('btn-return-city').addEventListener('click',returnCity);
  w.addEventListener('keydown',e=>{if(e.code==='Escape'&&aiming){cancelAim();render();}});
  return {select,selectAll,issue,begin,render,reset,cancelAim,focusBattle,returnCity,selected,
    point(point){if(!aiming)return false;if(point)issue(aiming,point);else env.issue('เลือกพื้นเกาะเพื่อสั่งกองทัพ');return true;},
    preview(point){if(aiming&&point)env.showReticle(point,!env.canStand(point));},
    get awaiting(){return !!aiming;},get phase(){return phase;},get inBattle(){return ['prepare','combat','waiting'].includes(phase)||livingEnemies(monsters).length>0;},
    get focused(){return !!savedCamera;},
    get snapshot(){return {phase,view,selected: selected().map(u=>u.entityId),aiming};}
  };
}
