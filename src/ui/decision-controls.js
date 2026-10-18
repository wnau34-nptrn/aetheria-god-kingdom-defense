// One set of choice buttons moves between the immediate card and the full story.
// The runtime owns pause, affordability, effects and the pending decision.
export function createDecisionControls(window, handlers) {
  const d = window.document, el = id => d.getElementById(id);
  const card = el('decision-card'), overlay = el('dilemma-overlay'), choices = el('dl-choices');
  let previousFocus = null;
  function show({ compact, title, speaker, paused, resumeSpeed, takeFocus = true }) {
    if (card.hidden && !overlay.classList.contains('visible')) previousFocus = d.activeElement;
    el('decision-title').textContent = title;
    el('decision-speaker').textContent = speaker;
    card.hidden = !compact;
    overlay.classList.toggle('visible', !compact);
    el('btn-trigger-dilemma').setAttribute('aria-controls', compact ? 'decision-card' : 'dilemma-modal');
    el('btn-trigger-dilemma').setAttribute('aria-expanded', 'true');
    el(compact ? 'decision-choices' : 'dl-choices-host').append(choices);
    status(paused, resumeSpeed);
    if(takeFocus)(compact ? el('decision-title') : el('dl-title')).focus({ preventScroll: true });
  }
  function status(paused, resumeSpeed) {
    const text = paused ? 'รอคำตัดสิน · หยุดเวลาให้แล้ว' : 'คำถามยังรอคำตอบ · ตอบได้ทันที';
    if (el('decision-status').textContent !== text) el('decision-status').textContent = text;
    el('btn-decision-continue').hidden = !paused;
    el('btn-decision-continue').textContent = resumeSpeed > 0 ? 'เล่นต่อ · เก็บคำถามไว้' : 'เก็บคำถามไว้บนหน้าจอ';
  }
  function hide() {
    const restore = card.contains(d.activeElement) || overlay.contains(d.activeElement);
    card.hidden = true; overlay.classList.remove('visible');
    el('btn-trigger-dilemma').setAttribute('aria-expanded', 'false');
    el('dl-choices-host').append(choices);
    if (restore) (previousFocus?.isConnected ? previousFocus : el('btn-trigger-dilemma')).focus({ preventScroll: true });
  }
  el('btn-decision-details').addEventListener('click', handlers.details);
  el('btn-decision-continue').addEventListener('click', handlers.continue);
  window.addEventListener('keydown', e => {
    if (overlay.classList.contains('visible') && /^(Digit[1-6]|Key[WASDQE]|Arrow)/.test(e.code)) e.stopImmediatePropagation();
  }, true);
  return { show, status, hide };
}
