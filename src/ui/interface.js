// DOM-only presentation: simulation, costs and world state remain in the runtime.
const paths = {
  crown: '<path d="m3 7 4 4 5-7 5 7 4-4-2 12H5Z"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z M9 3v16 M15 5v16"/>',
  scroll: '<path d="M6 3h14v18H6Z M6 3H4a2 2 0 0 0-2 2v3h4 M10 8h6 M10 12h6 M10 16h4"/>',
  menu: '<path d="M4 6h16 M4 12h16 M4 18h16"/>',
  close: '<path d="m6 6 12 12 M6 18 18 6"/>',
  pause: '<path d="M9 5v14 M15 5v14"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  rain: '<path d="M6 14a4 4 0 0 1 0-8 6 6 0 0 1 11-1 4.5 4.5 0 1 1 1 9 M8 17l-1 3 M13 17l-1 3 M18 17l-1 3"/>',
  mountain: '<path d="m2 20 8-16 6 11 3-6 4 11Z M7 10l3 3 3-3"/>',
  meteor: '<path d="m12 10 8-8 M15 12l7-5 M10 7l6-5"/><circle cx="7.5" cy="16.5" r="5.5"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',
  apple: '<path d="M12 7c-8-6-12 4-7 12 2 4 4 1 7 1s5 3 7-1c5-8 1-18-7-12Z M12 7c-1-4 1-5 4-5"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4 M16 4a3 3 0 0 1 0 6 M18 13a5 5 0 0 1 3 5v3"/>',
  swords: '<path d="m4 3 14 14 M3 3l4 1 13 13 M16 20l4-4 M18 18l3 3 M20 3 6 17 M21 3l-4 1L4 17 M8 20l-4-4 M6 18l-3 3"/>',
  plus: '<path d="M12 5v14 M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1"/><path d="M12 2v4 M12 18v4 M2 12h4 M18 12h4"/>'
};
export function initializeInterface() {
  document.querySelectorAll('[data-icon]').forEach(node => {
    node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[node.dataset.icon] || paths.spark}</svg>`;
  });
  const pairs = [['btn-toggle-left-hud','left-panel','hud-panel-hidden-left'],['btn-toggle-right-hud','right-panel','hud-panel-hidden-right'],['btn-menu','game-menu',null],...['faith','food','wood','ore'].map(r=>[`resource-${r}`,'economy-panel',null])];
  const scrim = document.getElementById('drawer-scrim');
  let active = null, returnFocus = null;
  function close(restore = true) {
    if (!active) return;
    const [buttonId,panelId,hiddenClass] = active;
    const panel = document.getElementById(panelId), button = document.getElementById(buttonId);
    if (hiddenClass) panel.classList.add(hiddenClass); else panel.hidden = true;
    button.classList.remove('active'); button.setAttribute('aria-expanded','false');
    scrim.hidden = true; active = null; document.body.classList.remove('drawer-open');
    if (restore && returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  }
  for (const pair of pairs) {
    const [buttonId,panelId,hiddenClass] = pair;
    const button=document.getElementById(buttonId), panel=document.getElementById(panelId);
    button.setAttribute('aria-controls',panelId); button.setAttribute('aria-expanded','false');
    button.classList.remove('active');
    // Side buttons have existing runtime listeners. Normalize their result here.
    button.addEventListener('click', () => {
      const wasOpen = active === pair;
      close(false);
      if (wasOpen) return;
      active = pair; returnFocus = button;
      if (hiddenClass) panel.classList.remove(hiddenClass); else panel.hidden = false;
      button.classList.add('active');button.setAttribute('aria-expanded','true');
      scrim.hidden = false;document.body.classList.add('drawer-open');
      window.dispatchEvent(new Event('aetheria:drawer-open'));
      panel.querySelector('[data-close-drawer]').focus({preventScroll:true});
    });
  }
  document.querySelectorAll('[data-close-drawer]').forEach(b=>b.addEventListener('click',()=>close()));
  scrim.addEventListener('click',()=>close());
  window.addEventListener('aetheria:close-drawer',()=>close(false));
  document.getElementById('btn-trigger-dilemma').addEventListener('click',()=>close(false));
  document.getElementById('btn-toggle-all-hud').addEventListener('click',()=>close(false));
  document.getElementById('btn-regen-island').addEventListener('click',()=>close());
  window.addEventListener('keydown',e=>{
    if (e.code==='KeyH') { close(false); return; }
    if (!active) return;
    if (e.code==='Escape') { e.preventDefault();e.stopImmediatePropagation();close();return; }
    // Prevent game hotkeys and held camera movement while operating a drawer.
    if (/^(Digit[1-6]|Key[WASDQE]|Arrow)/.test(e.code)) e.stopImmediatePropagation();
  },true);
  document.querySelectorAll('.power-btn').forEach(b=>b.setAttribute('aria-pressed',String(b.classList.contains('active'))));
  new MutationObserver(records=>{
    for(const {target} of records) target.setAttribute('aria-pressed',String(target.classList.contains('active')));
  }).observe(document.getElementById('god-dock'),{subtree:true,attributes:true,attributeFilter:['class']});
}
