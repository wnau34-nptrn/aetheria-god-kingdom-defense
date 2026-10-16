import { combatProfile, validCombatTarget } from '../systems/combat.js';

// Bounded presentation resources. Feedback never changes HP, attack timers or AI.
export function createCombatView({ THREE, scene, world, document, window, height, project, sound }) {
  let time=0, reactions=new Map(), corpses=[];
  const counts={contacts:0,falls:0},posed=new Set();
  const overlay=document.createElement('canvas');
  overlay.id='combat-feedback';overlay.setAttribute('aria-hidden','true');document.body.append(overlay);
  const ctx=overlay.getContext('2d'), impacts=[], labels=[];
  const sparkGeo=new THREE.OctahedronGeometry(0.14,0),hitColor=new THREE.Color(0xfda4af);
  for(let i=0;i<12;i++) {
    const group=new THREE.Group(), material=new THREE.MeshBasicMaterial({color:0xfde68a,transparent:true,opacity:1});
    for(let j=0;j<4;j++)group.add(new THREE.Mesh(sparkGeo,material));
    group.visible=false;scene.add(group);impacts.push({group,material,life:0,duration:0.22});
  }
  function reaction(entity) {
    let value=reactions.get(entity);
    if(!value){value={life:0,until:0,dx:0,dz:0,base:entity.combatMaterial?.emissive?.clone(),intensity:entity.combatMaterial?.emissiveIntensity};reactions.set(entity,value);}
    return value;
  }
  function hit(entity, source, amount, kind='melee') {
    counts.contacts++;
    const r=reaction(entity), dx=entity.x-(source?.x??entity.x-1),dz=entity.z-(source?.z??entity.z),d=Math.hypot(dx,dz)||1;
    r.life=0.18;r.until=time+2.3;r.dx=dx/d;r.dz=dz/d;
    const impact=impacts.find(x=>x.life<=0);
    if(impact){
      impact.life=impact.duration;
      impact.group.position.set(entity.x-r.dx*0.4,height(entity)+1.1,entity.z-r.dz*0.4);
      impact.material.color.setHex(kind==='bolt'?0x7dd3fc:entity.type==='monster'?0xfde68a:0xfb923c);
      impact.group.visible=true;
    }
    if(labels.length<16)labels.push({x:entity.x,z:entity.z,y:height(entity)+2.8,amount:Math.ceil(amount),life:0.65,duration:0.65,enemy:entity.type==='monster'});
    sound('hit',entity.isBoss||entity.isBrute,entity.role==='soldier');
  }
  function retire(entity) {
    if(corpses.some(c=>c.entity===entity))return;
    posed.delete(entity);
    if(corpses.length>=16)world.remove(corpses.shift().entity.mesh);
    const r=reaction(entity);
    if(r.base&&entity.combatMaterial){entity.combatMaterial.emissive.copy(r.base);entity.combatMaterial.emissiveIntensity=r.intensity;}
    corpses.push({entity,time:0,y:height(entity),scale:entity.mesh.scale.clone(),direction:r.dx<0?-1:1});
    counts.falls++;entity.mesh.visible=true;
    sound('fall',entity.isBoss||entity.isBrute,false);
  }
  function step(dt) {
    time+=dt;
    for(const [entity,r] of reactions){r.life=Math.max(0,r.life-dt);if(r.until<time&&!entity.combat?.target){if(r.base&&entity.combatMaterial){entity.combatMaterial.emissive.copy(r.base);entity.combatMaterial.emissiveIntensity=r.intensity;}reactions.delete(entity);}}
    for(const p of impacts){
      if(p.life<=0)continue;
      p.life=Math.max(0,p.life-dt);p.group.visible=p.life>0;
      const progress=1-p.life/p.duration;p.material.opacity=1-progress;
      p.group.children.forEach((spark,i)=>{const a=i*Math.PI/2+0.35;const radius=0.12+progress*0.85;spark.position.set(Math.cos(a)*radius,Math.sin(a)*radius,Math.sin(a*2)*radius*0.3);spark.scale.setScalar(1-progress*0.7);});
    }
    for(let i=labels.length-1;i>=0;i--)if((labels[i].life-=dt)<=0)labels.splice(i,1);
    for(let i=corpses.length-1;i>=0;i--){
      const c=corpses[i];c.time+=dt;const t=Math.min(1,c.time/0.45),settle=t*t*(3-2*t);
      c.entity.mesh.rotation.z=c.direction*settle*1.4;
      c.entity.mesh.rotation.x=-settle*0.18;
      c.entity.mesh.position.y=c.y+settle*0.15;
      if(c.time>0.8){const s=Math.max(0.01,1-(c.time-0.8)/0.4);c.entity.mesh.scale.set(c.scale.x*s,c.scale.y*s,c.scale.z*s);}
      if(c.time>=1.2){world.remove(c.entity.mesh);reactions.delete(c.entity);corpses.splice(i,1);}
    }
  }
  const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
  function render(units,selected,hidden=false) {
    const width=window.innerWidth,heightPx=window.innerHeight;
    if(overlay.width!==width||overlay.height!==heightPx){overlay.width=width;overlay.height=heightPx;}
    ctx.clearRect(0,0,width,heightPx);
    for(const entity of units){
      if(!entity.alive||!entity.mesh.visible)continue;
      const a=entity.combat,r=reactions.get(entity),fighting=a&&validCombatTarget(a.target);
      if(!fighting&&posed.delete(entity)){
        entity.mesh.rotation.x=entity.mesh.rotation.z=0;
        entity.mesh.position.set(entity.x,height(entity),entity.z);
        if(entity.rightArm)entity.rightArm.rotation.z=0;
      }
      if(fighting||r){
        const mesh=entity.mesh;mesh.position.set(entity.x,height(entity),entity.z);mesh.rotation.x=mesh.rotation.z=0;
        if(fighting){
          posed.add(entity);
          const p=combatProfile(entity);let arm=-0.15,lean=0;
          if(a.phase==='windup'){const t=ease(a.time/p.windup);arm=-0.15-1.5*t;lean=-0.09*t;}
          else if(a.phase==='strike'){const t=ease((a.time-p.windup)/p.strike);arm=-1.65+2.3*t;lean=-0.09+0.22*t;}
          else if(a.phase==='recover'){const t=ease((a.time-p.windup-p.strike)/p.recovery);arm=0.65-0.8*t;lean=0.13*(1-t);}
          if(a.phase!=='idle')mesh.rotation.y=a.facing;
          if(entity.rightArm){entity.rightArm.rotation.x=arm;entity.rightArm.rotation.z=0.12;}
          if(entity.leftArm)entity.leftArm.rotation.x=-0.45;
          mesh.rotation.x=lean;
          if(a.phase!=='idle'){if(entity.leftLeg)entity.leftLeg.rotation.x=-0.13;if(entity.rightLeg)entity.rightLeg.rotation.x=0.13;}
        }
        if(r){
          const kick=Math.sin(r.life/0.18*Math.PI)*0.15;
          mesh.position.x+=r.dx*kick;mesh.position.z+=r.dz*kick;mesh.rotation.z+=r.dx*kick;
          if(r.base&&entity.combatMaterial){entity.combatMaterial.emissive.copy(r.base);entity.combatMaterial.emissiveIntensity=r.intensity;if(r.life>0){entity.combatMaterial.emissive.lerp(hitColor,r.life/0.18*0.75);entity.combatMaterial.emissiveIntensity=Math.max(r.intensity,0.8);}}
        }
      }
      if(hidden||!(fighting||selected===entity||(r&&r.until>time)))continue;
      const point=project(entity.x,height(entity)+(entity.type==='monster'?3.9:2.9),entity.z);
      if(!point||point.x<0||point.x>width||point.y<0||point.y>heightPx)continue;
      const foot=project(entity.x,height(entity),entity.z);
      const bodyPixels=foot?Math.abs(foot.y-point.y):26;
      const w=Math.round(Math.max(12,Math.min(entity.isBoss?38:28,bodyPixels*0.9))),x=Math.round(point.x-w/2),y=Math.round(point.y);
      ctx.fillStyle='#07111f';ctx.fillRect(x-1,y-1,w+2,6);
      ctx.fillStyle=entity.type==='monster'?'#fb7185':'#38bdf8';ctx.fillRect(x,y,w*Math.max(0,Math.min(1,entity.hp/entity.maxHp)),4);
    }
    if(!hidden)for(const label of labels){
      const foot=project(label.x,label.y-2.8,label.z),head=project(label.x,label.y-0.6,label.z);
      // At the kingdom overview scale, numbers become an overlapping wall.
      // Keep health bars; reveal individual damage when the camera is close.
      if(!foot||!head||Math.abs(foot.y-head.y)<18)continue;
      const point=project(label.x,label.y+(1-label.life/label.duration)*1.2,label.z);if(!point)continue;
      ctx.globalAlpha=Math.min(1,label.life*4);ctx.font='bold 12px "Aetheria Thai", sans-serif';ctx.textAlign='center';
      ctx.fillStyle='#07111f';ctx.fillText(`−${label.amount}`,point.x+1,point.y+1);
      ctx.fillStyle=label.enemy?'#fef3c7':'#fecaca';ctx.fillText(`−${label.amount}`,point.x,point.y);ctx.globalAlpha=1;
    }
  }
  function reset(){
    for(const c of corpses)world.remove(c.entity.mesh);corpses=[];
    for(const [e,r] of reactions)if(r.base&&e.combatMaterial){e.combatMaterial.emissive.copy(r.base);e.combatMaterial.emissiveIntensity=r.intensity;}
    reactions=new Map();posed.clear();labels.length=0;for(const p of impacts){p.life=0;p.group.visible=false;}
    ctx.clearRect(0,0,overlay.width,overlay.height);
  }
  return {hit,retire,step,render,reset,snapshot:()=>({contacts:counts.contacts,falls:counts.falls,corpses:corpses.length,impacts:impacts.filter(p=>p.life>0).length,labels:labels.length})};
}
