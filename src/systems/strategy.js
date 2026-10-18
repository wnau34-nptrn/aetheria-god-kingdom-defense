import {availableNode,nearestResourceNode} from './economy.js';
import {distance,livingEnemies,planArmyOrder,threatened} from './battle.js';
import {constructionRequirement,recruitmentIssue} from './command-rules.js';
import {progressionIssue} from './progression.js';

export const STRATEGY_ACTIONS={
  guard:{label:'ป้องกันเมือง',detail:'AI เลือกแนวรับใกล้ภัยและจัดทหารให้'},
  attack:{label:'กวาดล้างอสูร',detail:'AI เลือกอสูรที่คุกคามเมือง แล้วหาเป้าหมายถัดไป'},
  retreat:{label:'ถอนกำลัง',detail:'กลับจุดปลอดภัยใกล้วิหาร ไม่ไล่ศัตรูใหม่'},
  wood:{label:'เร่งเก็บไม้',detail:'AI จัดคนตัดไม้และขนกลับคลัง'},
  ore:{label:'เร่งขุดแร่',detail:'AI จัดคนขุดแร่และขนกลับคลัง'},
  food:{label:'เพิ่มเสบียง',detail:'AI จัดคนเก็บผลไม้ พื้นที่ปลอดภัย'},
  repair:{label:'ฟื้นฟูเมือง',detail:'AI เลือกอาคารเสียหายและส่งคนซ่อม'},
  house:{label:'ขยายที่พัก',detail:'ไม้ 25 · แร่ 18 · AI เลือกที่และคนสร้าง'},
  tower:{label:'เสริมป้อม',detail:'ไม้ 25 · แร่ 18 · AI เลือกแนวและคนสร้าง'},
  advance:{label:'พัฒนายุค',detail:'รักษาเมือง คน และแผนที่สั่งไว้'},
  balanced:{label:'บริหารสมดุล',detail:'คืนงานให้ AI เมืองจัดตามปกติ'},
  auto:{label:'ให้ AI ดูแลทั้งหมด',detail:'คืนทั้งแผนเมืองและกองทัพให้อัตโนมัติ'},
  soldier:{label:'เสริมทหาร',detail:'25 ศรัทธา · เข้าร่วมแผนรบที่ใช้อยู่'},
  villager:{label:'เพิ่มแรงงาน',detail:'20 ศรัทธา · AI จัดงานต่อให้'}
};

export function strategicThreat(monsters,buildings){
  const base=buildings.find(b=>b.type==='temple')||{x:0,z:0};
  return livingEnemies(monsters).sort((a,b)=>{
    const score=m=>distance(m,base)-(m.combat?.target?.type==='temple'?60:m.combat?.target?.type==='agent'?15:0);
    return score(a)-score(b);
  })[0]||null;
}

export function strategicContext(state,agents,buildings,monsters,phase,view='auto'){
  const people=agents.filter(a=>a.alive),enemies=livingEnemies(monsters),damaged=buildings.some(b=>b.hp<b.maxHp&&(b.progress===undefined||b.progress>=1));
  if(view!=='city'&&(enemies.length||view==='battle'&&phase!=='prepare'&&phase!=='waiting')){
    if(!people.some(a=>a.role==='soldier'))return {id:'battle',title:'ไม่มีทหาร · ฟื้นแนวป้องกันอย่างไร',actions:people.some(a=>a.role==='villager')?['soldier','tower','auto']:['soldier','villager','auto']};
    return {id:'battle',title:enemies.some(m=>m.combat?.target?.type==='temple')?'วิหารถูกโจมตี · จะรับมืออย่างไร':enemies.length?`อสูร ${enemies.length} ตน · จะรับมืออย่างไร`:'กำหนดแผนกองทัพ',actions:['guard','attack','retreat']};
  }
  if(view!=='city'&&['prepare','waiting'].includes(phase))return {id:'prepare',title:phase==='waiting'?'รอทัพหนุน · เตรียมแผนต่อ':'ใกล้ถึงเวลาบุก · เตรียมเมือง',actions:['guard','tower','food']};
  if(!people.length)return {id:'empty',title:'เมืองต้องการคนกลับมาทำงาน',actions:['villager','soldier','auto']};
  if(state.food<Math.max(12,people.length*2))return {id:'food',title:'เสบียงเริ่มน้อย · จัดงานอย่างไร',actions:['food','wood','balanced']};
  if(damaged)return {id:'repair',title:'มีอาคารเสียหาย · ฟื้นเมืองอย่างไร',actions:['repair','wood','food']};
  if(!progressionIssue(state))return {id:'advance',title:'อารยธรรมพร้อมพัฒนาต่อ',actions:['advance','house','balanced']};
  if(people.length>=6+buildings.filter(b=>b.type==='house').length*4)return {id:'housing',title:'ที่พักเต็ม · ขยายเมืองอย่างไร',actions:['house','wood','ore']};
  if(state.wood<25||state.ore<18)return {id:'materials',title:'เตรียมวัสดุสำหรับพัฒนาเมือง',actions:['wood','ore','food']};
  return {id:'develop',title:'เมืองพร้อมลงทุน · เลือกสิ่งสำคัญ',actions:['house','tower','balanced']};
}

// Positions are validated against current terrain/foundations, never screen picks.
export function strategyPositions(origin,canStand,minRadius=0){
  const result=[];
  for(let r=minRadius;r<=minRadius+24;r+=3)for(let n=0;n<(r?16:1);n++){
    const p={x:origin.x+Math.cos(n*Math.PI/8)*r,z:origin.z+Math.sin(n*Math.PI/8)*r};
    if(canStand(p))result.push(p);
  }
  return result;
}

export function createStrategyDirector(env){
  const {state,agents,buildings,monsters,trees,ores}=env;
  let enabled=true,city='balanced',military='auto',nextUpdate=0,lastArmy=null,notice='เลือกสิ่งที่สำคัญ · AI จัดคนและเป้าหมายให้',cityCount=0;
  const base=()=>buildings.find(b=>b.type==='temple')||{x:0,z:0};
  const troops=()=>agents.filter(a=>a.alive&&a.role==='soldier');
  function releaseWorker(a){
    if(!a.strategyAssignment)return;
    a.workOrder=a.strategyAssignment.previousOrder;a.targetObj=null;a.workTimer=0;
    if(a.strategyAssignment.kind==='repair'&&(!a.buildTarget||a.buildTarget.progress===undefined||a.buildTarget.progress>=1))a.buildTarget=null;
    delete a.strategyAssignment;
  }
  function reset(){
    for(const a of agents){releaseWorker(a);if(a.strategyArmy){a.armyOrder=null;delete a.strategyArmy;}}
    city='balanced';military='auto';nextUpdate=0;lastArmy=null;cityCount=0;notice='เลือกสิ่งที่สำคัญ · AI จัดคนและเป้าหมายให้';
  }
  function issueProblem(id){
    if(['house','tower'].includes(id))return constructionRequirement(id,state,agents,buildings);
    if(id==='advance')return progressionIssue(state);
    if(id==='soldier'||id==='villager')return recruitmentIssue(id,state,agents,buildings);
    if(['wood','ore','food','repair'].includes(id)&&!agents.some(a=>a.alive&&a.role==='villager'))return 'ยังไม่มีคนงาน · เพิ่มแรงงานก่อน';
    if(id==='repair'&&!buildings.some(b=>b.hp<b.maxHp))return 'ยังไม่มีอาคารเสียหาย';
    if(id==='repair'&&state.wood<5)return 'ต้องมีไม้ในคลังอย่างน้อย 5 เพื่อเริ่มซ่อม';
    return null;
  }
  function updateCity(){
    const workers=agents.filter(a=>a.alive&&a.role==='villager');
    if(city==='balanced'){for(const a of agents)releaseWorker(a);cityCount=0;return;}
    const repair=city==='repair',damaged=repair?buildings.filter(b=>b.hp<b.maxHp&&(b.progress===undefined||b.progress>=1)&&!threatened(b,monsters,22)):[];
    const pool=repair?damaged:(city==='ore'?ores:trees).filter(n=>availableNode(n,city)&&!threatened(n,monsters,22));
    if(repair&&!buildings.some(b=>b.hp<b.maxHp)){city='balanced';for(const a of agents)releaseWorker(a);cityCount=0;notice='ซ่อมอาคารครบแล้ว · AI กลับไปทำงานเมือง';return;}
    const available=workers.filter(a=>!a.buildTarget||a.strategyAssignment?.kind==='repair'&&(a.buildTarget.progress===undefined||a.buildTarget.progress>=1));
    const needed=Math.min(available.length,repair?1:Math.max(1,Math.min(workers.length-1,Math.ceil(workers.length*.6))));
    const score=a=>{
      const p=repair?[...pool].sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0]:nearestResourceNode(a,city,pool);
      return (p?distance(a,p):1e4)-(a.strategyAssignment?.kind===city?1000:0);
    };
    const chosen=available.sort((a,b)=>score(a)-score(b)).slice(0,needed),keep=new Set(chosen);
    for(const a of agents)if(!keep.has(a))releaseWorker(a);
    for(const a of chosen){
      if(a.strategyAssignment?.kind!==city){releaseWorker(a);const previousOrder=a.workOrder;a.strategyAssignment={kind:city,previousOrder};
        if(!repair){env.orderWorker(a,city);a.targetObj=nearestResourceNode(a,city,pool);}
        else{a.workOrder=null;a.targetObj=null;a.workTimer=0;}
      }
      if(repair)a.buildTarget=[...pool].sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||distance(a,base())-distance(b,base()))[0]||null;
    }
    cityCount=chosen.length;
  }
  function updateArmy(force=false){
    if(military==='auto')return;
    const units=troops();if(!units.length){lastArmy=null;return;}
    const threat=strategicThreat(monsters,buildings),b=base();
    const kind=military==='retreat'?'retreat':military==='attack'&&threat?'attack':'hold';
    let goal;
    if(kind==='attack')goal=threat;
    else if(kind==='hold'&&threat){const length=distance(b,threat)||1,reach=Math.min(17,length);goal={x:b.x+(threat.x-b.x)/length*reach,z:b.z+(threat.z-b.z)/length*reach};}
    else goal={x:b.x+16,z:b.z+4};
    const ids=units.map(u=>u.entityId).join('|'),target=threat?.entityId||threat?.id||null;
    if(!force&&lastArmy?.ids===ids&&lastArmy.kind===kind&&lastArmy.target===target&&distance(lastArmy.goal,goal)<6&&units.every(u=>u.armyOrder?.kind===kind&&env.canStand({x:u.armyOrder.slotX,z:u.armyOrder.slotZ})))return;
    for(const point of strategyPositions(goal,env.canStand,kind==='attack'?3:0)){
      const plans=planArmyOrder(units,kind,point,env.canStand);if(!plans)continue;
      for(const {unit,order} of plans){if(kind==='hold'){order.x=goal.x;order.z=goal.z;}unit.armyOrder=order;unit.strategyArmy=true;unit.stateLabel=STRATEGY_ACTIONS[military].label+' · AI จัดเป้าหมายแล้ว';}
      lastArmy={ids,kind,target,goal:{x:goal.x,z:goal.z}};return;
    }
    lastArmy=null;notice='ยังจัดแนวไม่ได้ · AI จะค้นหาจุดใหม่ให้';
  }
  function update(time,force=false){
    if(!enabled||!force&&time<nextUpdate)return;
    nextUpdate=time+2;updateCity();updateArmy(force);
  }
  function choose(id){
    if(!enabled||!STRATEGY_ACTIONS[id])return false;
    const issue=issueProblem(id);if(issue){env.issue(issue);return false;}
    if(['guard','attack','retreat'].includes(id)){military=id;lastArmy=null;}
    else if(['wood','ore','food','repair','balanced'].includes(id))city=id;
    else if(id==='auto')reset();
    else if(id==='house'||id==='tower'){
      const threat=strategicThreat(monsters,buildings),b=base();
      const origin=id==='tower'&&threat?{x:b.x+(threat.x-b.x)*.4,z:b.z+(threat.z-b.z)*.4}:b;
      const point=strategyPositions(origin,p=>!env.placementIssue(p.x,p.z)&&!threatened(p,monsters,26),id==='house'?12:24)[0];
      if(!point){env.issue('ยังไม่มีที่ก่อสร้างปลอดภัย · ไม่มีการหักทรัพยากร');return false;}
      if(!env.construct(id,point))return false;
    }else if(id==='advance'){if(!env.advance())return false;}
    else if(!env.recruit(id))return false;
    notice=STRATEGY_ACTIONS[id].label+' · รับการตัดสินใจแล้ว';
    update(env.time(),true);env.notify(notice);return true;
  }
  return {choose,update,reset,issueProblem,
    setEnabled(value){reset();enabled=!!value;if(enabled)for(const a of agents){if(a.role==='soldier')a.armyOrder=null;if(a.role==='villager')a.workOrder=null;}},get enabled(){return enabled;},
    get snapshot(){const b=base();return {enabled,city,military,cityCount,armyCount:troops().length,notice,target:lastArmy?.target||null,temple:b.hp?{hp:Math.ceil(b.hp),maxHp:b.maxHp}:null};},
    context(phase,view){return strategicContext(state,agents,buildings,monsters,phase,view);}
  };
}
