import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameHarness } from './helpers/game-harness.js';

const plots = [
  [-5, 0, 'แม่น้ำ'], [0, 0, 'ถนน'], [-1, 0, 'ลาดชัน'],
  [-2, 1, 'ใกล้อาคาร'], [-3, 2, 'ระดับน้ำ'], [7, 22, 'สูงเกิน'], [500, 500, 'นอกพื้นที่']
];
test('blocked miracles explain the terrain restriction and preserve faith, towers and healing', () => {
  const h = createGameHarness(), a = h.api;
  try {
    h.click('[data-speed="0"]'); h.click('[data-power="miracle"]');
    const faith = a.state.faith, count = a.buildings.length;
    a.agents[0].hp = 17;
    for (const [x, z, reason] of plots) {
      assert.match(a.getBuildingPlacementIssue(x, z), new RegExp(reason));
      a.castMiracleBeam(x, z);
      assert.match(h.window.document.getElementById('placement-feedback').textContent, new RegExp(reason));
      assert.equal(a.state.faith, faith); assert.equal(a.buildings.length, count);
      assert.equal(a.agents[0].hp, 17);
    }
  } finally { h.close(); }
});

test('a valid plot requires 25 faith, builds once, then reports its occupied foundation', () => {
  const h = createGameHarness(), a = h.api;
  try {
    h.click('[data-speed="0"]'); h.click('[data-power="miracle"]');
    const count = a.buildings.length;
    assert.equal(a.getBuildingPlacementIssue(-3, -8), null);
    a.state.faith = 24; a.castMiracleBeam(-3, -8);
    assert.match(h.window.document.getElementById('placement-feedback').textContent, /ศรัทธาไม่พอ/);
    assert.equal(a.buildings.length, count); assert.equal(a.state.faith, 24);
    a.state.faith = 25; a.castMiracleBeam(-3, -8);
    assert.equal(a.buildings.length, count + 1); assert.equal(a.state.faith, 0);
    assert.match(h.window.document.getElementById('placement-feedback').textContent, /ใกล้อาคาร/);
    a.state.faith = 25; a.castMiracleBeam(-3, -8);
    assert.equal(a.buildings.length, count + 1); assert.equal(a.state.faith, 25);
    h.click('[data-power="observe"]');
    assert.equal(h.window.document.getElementById('placement-feedback').hidden, true);
  } finally { h.close(); }
});

for (const speed of [1, 5]) {
  test(`first-night guidance follows simulation time and pause at ${speed}x`, () => {
    const h = createGameHarness(), a = h.api, doc = h.window.document;
    try {
      a.state.timeOfDay = 17.99;
      h.play(0.2, speed);
      assert.match(doc.getElementById('night-guidance').textContent, /ก่อนคืนแรก/);
      assert.equal(doc.getElementById('kingdom-readout').dataset.threat, 'warning');
      const countdown = doc.getElementById('night-countdown').textContent;
      h.click('[data-speed="0"]'); for (let i = 0; i < 20; i++) h.frame();
      assert.equal(doc.getElementById('night-countdown').textContent, countdown);
      h.play(2, speed);
      assert.equal([...doc.querySelectorAll('.log-entry')].filter(e => e.textContent.includes('อีก 2 ชั่วโมงในเกม')).length, 1);
      a.state.timeOfDay = 19.99; h.play(0.2, speed);
      assert.doesNotMatch(doc.getElementById('night-guidance').textContent, /ก่อนคืนแรก/);
      assert.equal(Number(doc.getElementById('quick-enemies').textContent), a.monsters.filter(m => m.alive).length);
    } finally { h.close(); }
  });
}

test('compact HUD counts living people and enemies even with side panels hidden', () => {
  const h = createGameHarness(), a = h.api, doc = h.window.document;
  try {
    h.click('[data-speed="0"]'); h.click('#btn-toggle-left-hud'); h.click('#btn-toggle-right-hud');
    a.agents[0].alive = false; a.spawnMonster(1); a.spawnMonster(1); a.monsters[0].alive = false;
    a.state.food = 13.9; a.state.faith = 41.6; a.updateHUD();
    assert.equal(doc.getElementById('quick-pop').textContent, `${a.agents.filter(v => v.alive).length}`);
    assert.equal(doc.getElementById('quick-enemies').textContent, '1');
    assert.equal(doc.getElementById('quick-food').textContent, '13');
    assert.equal(doc.getElementById('quick-faith').textContent, '41');
  } finally { h.close(); }
});
