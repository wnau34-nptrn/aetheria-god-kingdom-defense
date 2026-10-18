import {STRATEGY_ACTIONS} from '../systems/strategy.js';

export function createStrategyControls({window:w,director,army,economy,state,layout}){
  const d=w.document,el=id=>d.getElementById(id),card=el('strategy-panel'),council=el('decision-card'),councilHome=council.parentNode,councilNext=council.nextSibling;
  let lastContext='',lastLayout='';
  const text=(id,value)=>{if(el(id).textContent!==value)el(id).textContent=value;};
  function setMode(direct){
    director.setEnabled(!direct);army.cancelAim();economy.reset();state.selectedEntity=null;
    el('inspector-card').classList.remove('visible');
    d.body.classList.toggle('strategy-mode',!direct);el('direct-control-mode').checked=direct;
    if(direct)councilHome.insertBefore(council,councilNext);else el('god-dock-wrapper').append(council);
    try{w.localStorage.setItem('AETHERIA_COMMAND_MODE',direct?'direct':'decisions');}catch{}
    lastContext='';render();layout();
  }
  function render(){
    card.hidden=!director.enabled;if(!director.enabled)return;
    const snapshot=director.snapshot,context=director.context(army.phase,army.snapshot.view),key=context.id+'|'+context.actions.join('|');
    text('strategy-title',context.title);
    text('strategy-risk',army.inBattle&&snapshot.temple?`วิหาร ${snapshot.temple.hp}/${snapshot.temple.maxHp}`:'AI ลงมือให้');
    text('strategy-focus',army.focused?'กลับมุมเดิม':'ดูจุดรบ');el('strategy-focus').hidden=!army.inBattle&&!army.focused;
    text('strategy-status',`${snapshot.city==='balanced'?'เมืองอัตโนมัติ':STRATEGY_ACTIONS[snapshot.city].label+' · '+snapshot.cityCount+' คน'} · ${snapshot.military==='auto'?'กองทัพอัตโนมัติ':STRATEGY_ACTIONS[snapshot.military].label+' · '+snapshot.armyCount+' นาย'}`);
    text('strategy-receipt',snapshot.notice);
    if(key!==lastContext){lastContext=key;
      el('strategy-choices').replaceChildren(...context.actions.map(id=>{
        const b=d.createElement('button');b.className='strategy-choice';b.dataset.strategyAction=id;
        const label=d.createElement('strong'),detail=d.createElement('small');label.textContent=STRATEGY_ACTIONS[id].label;detail.textContent=STRATEGY_ACTIONS[id].detail;b.append(label,detail);return b;
      }));
    }
    for(const b of card.querySelectorAll('[data-strategy-action]')){
      const id=b.dataset.strategyAction,issue=director.issueProblem(id);
      b.setAttribute('aria-disabled',String(!!issue));b.title=issue||STRATEGY_ACTIONS[id].detail;
      b.setAttribute('aria-pressed',String(snapshot.city===id||snapshot.military===id));
    }
    const pending=!council.hidden;d.body.classList.toggle('strategy-question',pending);
    const signature=key+'|'+pending+'|'+snapshot.notice+'|'+snapshot.cityCount;
    if(lastLayout!==signature){lastLayout=signature;layout();}
  }
  card.addEventListener('click',e=>{const b=e.target.closest('[data-strategy-action]');if(b){director.choose(b.dataset.strategyAction);render();}});
  el('direct-control-mode').addEventListener('change',e=>setMode(e.target.checked));
  el('strategy-focus').addEventListener('click',()=>{if(army.focused)army.returnCity();else army.focusBattle();render();});
  let direct=false;try{direct=w.localStorage.getItem('AETHERIA_COMMAND_MODE')==='direct';}catch{}
  setMode(direct);
  return {render,setMode};
}
