// Bounded ground markers; they never participate in picking or simulation.
export function createArmyView({THREE,scene,height}) {
  const geometry=new THREE.RingGeometry(1.05,1.22,24);
  const material=new THREE.MeshBasicMaterial({color:0x7dd3fc,side:THREE.DoubleSide,transparent:true,opacity:.85});
  const rings=Array.from({length:32},()=>{const m=new THREE.Mesh(geometry,material);m.rotation.x=-Math.PI/2;m.visible=false;scene.add(m);return m;});
  const goalGeometry=new THREE.RingGeometry(2.2,2.45,32),goalMaterial=new THREE.MeshBasicMaterial({color:0xfde68a,side:THREE.DoubleSide,transparent:true,opacity:.85});
  const goals=Array.from({length:8},()=>{const m=new THREE.Mesh(goalGeometry,goalMaterial);m.rotation.x=-Math.PI/2;m.visible=false;scene.add(m);return m;});
  return {render(units,hidden){
    for(let i=0;i<rings.length;i++){const u=units[i];rings[i].visible=!!u&&!hidden&&u.mesh.visible;if(rings[i].visible)rings[i].position.set(u.x,height(u.x,u.z)+.2,u.z);}
    const orders=[...new Map(units.filter(u=>u.armyOrder).map(u=>[`${u.armyOrder.kind}:${u.armyOrder.x}:${u.armyOrder.z}`,u.armyOrder])).values()];
    for(let i=0;i<goals.length;i++){const order=orders[i];goals[i].visible=!!order&&!hidden;if(goals[i].visible)goals[i].position.set(order.x,height(order.x,order.z)+.2,order.z);}
  }};
}
