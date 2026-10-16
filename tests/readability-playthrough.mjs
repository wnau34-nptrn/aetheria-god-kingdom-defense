import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const out = process.env.READABILITY_EVIDENCE || `/tmp/aetheria-readability-${Date.now()}`;
mkdirSync(out, { recursive: true });
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(`${out}/metadata.json`, JSON.stringify({
  started: new Date().toISOString(), sourceSHA256: hash('src/legacy/game.js'),
  cssSHA256: hash('src/styles/game.css'), htmlSHA256: hash('index.html'),
  viewport: { width: 400, height: 300 },
  method: 'One continuous UI-only mixed-speed observe run. 5x approach, 1x across18:00 and20:00, 5x between/after. Read-only snapshots; normal wheel zoom2200; close natural events; pause for screenshots. No RNG, world or clock overrides. Software WebGL. Not two full runs or a balance comparison.'
}, null, 2), { flag: 'wx' });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void browser.close().catch(() => {}); });
const context = await browser.newContext({ viewport: { width: 400, height: 300 } });
const page = await context.newPage(), errors = [], checkpoints = [], speedChanges = [];
page.on('pageerror', e => errors.push(e.message));
const sample = () => page.evaluate(() => {
  const a = AETHERIA_API, d = document;
  return {
    simulationTime: a.simulationTime, day: a.state.day, time: a.state.timeOfDay, speed: a.state.timeScale,
    people: a.agents.filter(v => v.alive).length, enemies: a.monsters.filter(v => v.alive).length,
    faith: a.state.faith, food: a.state.food,
    countdown: d.getElementById('night-countdown').textContent,
    guidance: d.getElementById('night-guidance').textContent,
    quickEnemies: Number(d.getElementById('quick-enemies').textContent),
    quickPeople: Number(d.getElementById('quick-pop').textContent),
    event: d.getElementById('dilemma-overlay').classList.contains('visible')
  };
});
async function speed(value) {
  await page.click(`[data-speed="${value}"]`);
  speedChanges.push({ speed: value, at: await sample() });
}
async function capture(label, entry) {
  await speed(0);
  const paused = await sample(); await page.waitForTimeout(800);
  const after = await sample();
  assert.equal(after.simulationTime, paused.simulationTime);
  assert.equal(after.countdown, paused.countdown);
  await page.screenshot({ path: `${out}/${label}-400.png` });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.screenshot({ path: `${out}/${label}-800.png` });
  await page.setViewportSize({ width: 400, height: 300 });
  checkpoints.push({ label, entry, paused });
  console.log(JSON.stringify({ label, entry }));
  await speed(5);
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5174');
  await page.waitForFunction(() => window.AETHERIA_API);
  await speed(0); await page.click('#btn-toggle-bubbles');
  await page.keyboard.press('KeyH'); await page.mouse.move(200, 150); await page.mouse.wheel(0, 2200); await page.keyboard.press('KeyH');
  await speed(5);
  const start = Date.now();
  let warningApproach = false, nightApproach = false, warned = false, night = false, eventCount = 0;
  let warningFast = false, nightFast = false, warningAt = 0, nightAt = 0;
  while (Date.now() - start < 600000) {
    let s = await sample();
    if (s.event) { await page.click('#btn-close-dilemma'); eventCount++; s = await sample(); }
    appendFileSync(`${out}/timeline.jsonl`, JSON.stringify(s) + '\n');
    assert.equal(s.quickEnemies, s.enemies); assert.equal(s.quickPeople, s.people);
    if (!warningApproach && s.time >= 17.8) { await speed(1); warningApproach = true; }
    if (!warned && s.time >= 18 && s.time < 20) {
      assert.equal(s.speed, 1); assert.match(s.guidance, /ก่อนคืนแรก/);
      warned = true; warningAt = s.simulationTime; await capture('warning-1x', s);
    }
    if (warned && !warningFast && s.simulationTime >= warningAt + 2) {
      assert.equal(s.speed, 5); assert.match(s.guidance, /ก่อนคืนแรก/);
      warningFast = true; await capture('warning-5x', s);
    }
    if (!nightApproach && s.time >= 19.8) { await speed(1); nightApproach = true; }
    if (!night && s.time >= 20) {
      assert.equal(s.speed, 1); assert.ok(s.enemies > 0);
      night = true; nightAt = s.simulationTime; await capture('night-1x', s);
    }
    if (night && !nightFast && s.simulationTime >= nightAt + 2) {
      assert.equal(s.speed, 5); nightFast = true; await capture('night-5x', s);
    }
    if (nightFast) break;
    await page.waitForTimeout(s.time >= 17 ? 250 : 1000);
  }
  assert.ok(warned && warningFast && night && nightFast, 'all four speed/phase checkpoints must complete');
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/summary.json`, JSON.stringify({ checkpoints, speedChanges, final: await sample(), eventCount, errors, wallSeconds: (Date.now() - start) / 1000 }, null, 2));
  console.log(out);
} finally { await context.close(); await browser.close(); }
