import { readFile, writeFile } from 'node:fs/promises';
import { createGameHarness } from './helpers/game-harness.js';
const source=process.env.SPEED_SOURCE?await readFile(process.env.SPEED_SOURCE,'utf8'):undefined;
const results=[];
for(const scenario of ['all-trades-unaffordable','council-no-plot']){
 const h=createGameHarness({source}),a=h.api;
 try{
  if(scenario==='all-trades-unaffordable'){a.state.faith=a.state.wood=a.state.food=0;a.openInteractiveDilemma(2);}
  else{
   for(let x=-30;x<=30;x+=5)for(let z=-30;z<=30;z+=5)a.buildings.push({type:'house',x,z,hp:100,maxHp:100,progress:1});
   a.state.wood=20;a.openInteractiveDilemma(1);
  }
  const snapshot=()=>({wood:a.state.wood,food:a.state.food,faith:a.state.faith,pop:a.agents.filter(x=>x.alive).length,houses:a.buildings.filter(x=>x.type==='house').length,wagons:a.wagons.length});
  const before=snapshot();h.click('#dl-choice-0');
  results.push({scenario,before,after:snapshot(),modalOpen:h.window.document.getElementById('dilemma-overlay').classList.contains('visible'),toast:h.window.document.getElementById('dilemma-toast').textContent});
 }finally{h.close();}
}
await writeFile(process.env.SPEED_REPORT||'docs/speed-review/events-after.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
