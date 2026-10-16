// Observational browser playthrough: UI-only actions, read-only game snapshots.
// This is a playtest driver, not a balance assertion or deterministic simulation.
import { chromium } from '@playwright/test';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const base = process.env.PLAYTEST_URL || 'http://127.0.0.1:5173';
const root = process.env.BALANCE_EVIDENCE || `/tmp/aetheria-balance-${Date.now()}`;
const strategies = (process.env.BALANCE_STRATEGIES || 'observe,economy,defense').split(',');
const repeats = Number(process.env.BALANCE_REPEATS || 2);
const duration = Number(process.env.BALANCE_SECONDS || 240);
const viewport = { width: Number(process.env.BALANCE_WIDTH || 400), height: Number(process.env.BALANCE_HEIGHT || 300) };
const screenshotViewport = { width: 800, height: 600 };
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const results = [];
await mkdir(root, { recursive: true });
const metadata = {
  startedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  gameSourceSha256: createHash('sha256').update(await readFile('src/legacy/game.js')).digest('hex'),
  viewport, screenshotViewport, renderer: 'Chromium ANGLE/SwiftShader', strategies, repeats, targetGameSeconds: duration,
  method: 'Fresh browser context per run; default terrain seed 42026 and naturally randomized props/units/enemies; 5x UI speed; zoom out via mouse wheel to the normal maximum; actual WebGL; no API writes, forced events, era/day jumps, clock/RNG overrides or render stubs.',
  policy: {
    observe: 'No powers/recruitment; close naturally occurring events.',
    economy: 'Recruit two workers before night; rain near workers at most once per 45 game seconds while faith >= 30 and food < 65 or mean hunger > 45; choose affordable economic options in natural events.',
    defense: 'Train two soldiers; attempt one extra tower on visibly accessible free ground before night; use lightning on a visible enemy cluster at most once per 12 game seconds while faith >= 25; choose affordable defensive options in natural events.',
    common: `Stop at ${duration} game seconds; record automatic era transition if reached; do not force progression. Input may pause via the visible pause button for aiming/screenshots. Policies are simple scripted play styles, not expert human players.`
  }
};
await writeFile(`${root}/metadata.json`, JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
console.log(`Evidence: ${root}`);

try {
  for (let repeat = 1; repeat <= repeats; repeat++) for (const strategy of strategies) {
    const id = `${strategy}-${repeat}`, dir = `${root}/${id}`;
    await mkdir(`${dir}/screenshots`, { recursive: true });
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const started = Date.now(), errors = [], inputErrors = [], shots = new Set(), events = [], actions = [];
    let trained = 0, recruited = 0, towerAttempts = 0, lastRain = -100, lastLightning = -100, lastStatus = 0;
    let initial, previous, stopReason = 'target game time reached';
    const log = async (type, data) => appendFile(`${dir}/timeline.jsonl`, JSON.stringify({ wallSeconds: (Date.now() - started) / 1000, type, ...data }) + '\n');
    page.on('pageerror', error => { errors.push(error.message); });
    page.on('console', m => { if (m.type() === 'error') log('console-error', { message: m.text().slice(0, 300) }); });
    const click = async selector => {
      const cityAction = selector === '#btn-spawn-villager' || selector === '#btn-train-soldier';
      if (cityAction) await page.locator('#btn-toggle-left-hud').click();
      try { await page.locator(selector).click(); }
      finally { if (cityAction) await page.locator('#btn-toggle-left-hud').click(); }
    };
    const sample = () => page.evaluate(() => {
      const a = AETHERIA_API, s = a.state, alive = a.agents.filter(x => x.alive);
      const round = n => Math.round(n * 1000) / 1000;
      return {
        simulationTime: round(a.simulationTime), day: s.day, time: round(s.timeOfDay), night: s.isNight,
        era: s.civEra, progress: round(s.civProgress), speed: s.timeScale,
        resources: Object.fromEntries(['food', 'wood', 'ore', 'faith'].map(k => [k, round(s[k])])),
        population: alive.length, roles: alive.reduce((r, x) => (r[x.role] = (r[x.role] || 0) + 1, r), {}),
        units: alive.map(x => ({ id: x.id, role: x.role, state: x.state, hp: round(x.hp), hunger: round(x.hunger), x: round(x.x), z: round(x.z), visible: x.mesh.visible, carryType: x.carryType, carryAmount: x.carryAmount })),
        buildings: a.buildings.map(x => ({ type: x.type, name: x.name, x: round(x.x), z: round(x.z), hp: round(x.hp), maxHp: x.maxHp, progress: x.progress })),
        monsters: a.monsters.filter(x => x.alive).map(x => ({ name: x.name, boss: x.isBoss, x: round(x.x), z: round(x.z), hp: round(x.hp) })),
        event: document.getElementById('dilemma-overlay').classList.contains('visible') ? {
          category: document.getElementById('dl-category').textContent,
          choices: [...document.querySelectorAll('.dl-choice-btn')].map(x => ({ id: x.id, text: x.innerText, disabled: x.getAttribute('aria-disabled') === 'true' }))
        } : null,
        log: [...document.querySelectorAll('.log-entry')].map(x => x.textContent),
        hudHidden: document.body.classList.contains('hud-hidden')
      };
    });
    const record = async s => { await log('snapshot', s); await writeFile(`${dir}/latest.json`, JSON.stringify(s, null, 2) + '\n'); };
    const screenshot = async (name, s) => {
      if (shots.has(name)) return; shots.add(name);
      const running = !s.event && s.speed > 0;
      if (running) await click('[data-speed="0"]');
      await page.setViewportSize(screenshotViewport);
      if (s.hudHidden) await page.keyboard.press('KeyH');
      await page.screenshot({ path: `${dir}/screenshots/${name}.png` });
      await log('screenshot', { name });
      if (s.hudHidden) await page.keyboard.press('KeyH');
      await page.setViewportSize(viewport);
      if (running) await click('[data-speed="5"]');
    };
    const action = async (label, callback) => {
      const before = await sample();
      try {
        if (!before.event) await click('[data-speed="0"]');
        await callback();
        const after = await sample(); const entry = { label, before, after };
        actions.push({ label, simulationTime: before.simulationTime, before: before.resources, after: after.resources });
        await log('action', entry);
      } catch (error) { inputErrors.push({ label, message: error.message }); await log('input-error', { label, message: error.message }); }
      if (!before.event) await click('[data-speed="5"]');
    };
    async function project(x, z) {
      return page.evaluate(({ x, z }) => {
        const c = AETHERIA_API.camCtrl, t = c.target, r = c.radius;
        const eye = [t.x + r * Math.sin(c.phi) * Math.sin(c.theta), t.y + r * Math.cos(c.phi), t.z + r * Math.sin(c.phi) * Math.cos(c.theta)];
        const f = [t.x - eye[0], t.y - eye[1], t.z - eye[2]], fl = Math.hypot(...f); for (let i = 0; i < 3; i++) f[i] /= fl;
        const right = [-f[2], 0, f[0]], rl = Math.hypot(...right); for (let i = 0; i < 3; i++) right[i] /= rl;
        const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
        const p = [x - eye[0], window._getTerrainHeightAt(x, z) - eye[1], z - eye[2]], dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
        const depth = dot(p, f), tan = Math.tan(24 * Math.PI / 180);
        const sx = (dot(p, right) / (depth * tan * innerWidth / innerHeight) + 1) * innerWidth / 2;
        const sy = (1 - dot(p, up) / (depth * tan)) * innerHeight / 2;
        return { x: sx, y: sy, depth, hit: document.elementFromPoint(sx, sy)?.id };
      }, { x, z });
    }
    async function cast(key, x, z) {
      await page.keyboard.press('KeyH'); // Clear the HUD for aiming, using the game's control.
      try {
        const p = await project(x, z);
        if (p.depth <= 0 || p.x < 0 || p.x > viewport.width || p.y < 0 || p.y > viewport.height || p.hit !== 'game-canvas') throw new Error(`Aim blocked/outside viewport: ${JSON.stringify(p)}`);
        await page.keyboard.press(key); await page.mouse.click(p.x, p.y); await page.keyboard.press('Digit1');
        await log('aim', { key, world: { x, z }, screen: p });
      } finally { await page.keyboard.press('KeyH'); }
    }
    try {
      await page.goto(base); await page.waitForFunction(() => window.AETHERIA_API);
      await click('[data-speed="0"]'); initial = await sample(); await record(initial); await screenshot('00-start', initial);
      await page.keyboard.press('KeyH');
      await page.mouse.move(viewport.width / 2, viewport.height / 2); await page.mouse.wheel(0, 2200);
      await page.keyboard.press('KeyH'); await log('input', { label: 'zoom out', deltaY: 2200 });
      await click('[data-speed="5"]');
      while (true) {
        const s = await sample(); await record(s);
        if (s.simulationTime - initial.simulationTime >= duration) { previous = s; break; }
        if (Date.now() - started > 12 * 60 * 1000) { stopReason = '12 minute wall-time cap'; previous = s; break; }
        if (s.night && !shots.has('first-night')) await screenshot('first-night', s);
        if (s.day >= 2 && s.time >= 0.5 && s.time < 5.5 && !shots.has('reinforcements')) await screenshot('reinforcements', s);
        if (s.day >= 2 && s.time >= 6 && !shots.has('first-dawn')) await screenshot('first-dawn', s);
        if (previous && s.era !== previous.era) { await log('era-transition', { before: previous, after: s }); await screenshot(`era-${s.era}`, s); }
        if (s.event) {
          await screenshot(`event-${events.length + 1}`, s);
          const category = s.event.category;
          let preferences = [];
          if (strategy === 'economy') preferences = category.includes('Petition') ? [0, 1] : category.includes('Council') ? [0] : category.includes('Caravan') ? [0, 1] : category.includes('Relic') ? [1] : [2];
          if (strategy === 'defense') preferences = category.includes('Military') ? (s.monsters.length ? [0, 1, 2] : [1, 2]) : category.includes('Council') ? [1] : category.includes('Caravan') ? [2] : category.includes('Relic') ? [0] : [0, 1];
          const choice = preferences.map(i => s.event.choices[i]).find(x => x && !x.disabled);
          await action(choice ? `natural event: ${category} -> ${choice.id}` : `close natural event: ${category}`, async () => {
            await click(choice ? `#${choice.id}` : '#btn-close-dilemma');
            // A blocked plot must not trap the automated player in the modal.
            if ((await sample()).event) await click('#btn-close-dilemma');
          });
          events.push({ simulationTime: s.simulationTime, category, choice: choice?.id ?? 'close' });
        } else if (s.era === 1) {
          if (strategy === 'economy' && recruited < 2 && !s.night && s.resources.faith >= 35) {
            await action('recruit worker', () => click('#btn-spawn-villager')); recruited++;
          } else if (strategy === 'economy' && s.resources.faith >= 30 && s.simulationTime - lastRain >= 45 && (s.resources.food < 65 || s.units.reduce((n, x) => n + x.hunger, 0) / Math.max(1, s.population) > 45)) {
            const workers = s.units.filter(x => x.visible && x.role !== 'soldier');
            const target = workers[0] || { x: 0, z: 0 };
            await action('rain near worker', () => cast('Digit2', target.x, target.z)); lastRain = s.simulationTime;
          } else if (strategy === 'defense' && trained < 2 && !s.night && s.resources.faith >= 25) {
            await action('train soldier', () => click('#btn-train-soldier')); trained++;
          } else if (strategy === 'defense' && towerAttempts < 4 && !s.night && s.resources.faith >= 30 && s.simulationTime > 35) {
            const candidates = [[18, -15], [24, -8], [12, -18], [30, -15]];
            const target = candidates[towerAttempts++];
            await action('attempt extra tower', () => cast('Digit6', ...target));
            const after = await sample();
            if (after.buildings.filter(x => x.type === 'tower').length > s.buildings.filter(x => x.type === 'tower').length) towerAttempts = 4;
          } else if (strategy === 'defense' && s.monsters.length && s.resources.faith >= 25 && s.simulationTime - lastLightning >= 12) {
            // Choose a cluster; all aim commands still pass through the canvas.
            const target = [...s.monsters].sort((a, b) => s.monsters.filter(m => Math.hypot(m.x - b.x, m.z - b.z) < 10).length - s.monsters.filter(m => Math.hypot(m.x - a.x, m.z - a.z) < 10).length)[0];
            await action('lightning on enemy cluster', () => cast('Digit5', target.x, target.z)); lastLightning = s.simulationTime;
          }
        }
        if (Date.now() - lastStatus > 20000) { console.log(JSON.stringify({ id, wallSeconds: Math.round((Date.now() - started) / 1000), gameSeconds: s.simulationTime, day: s.day, time: s.time, era: s.era, population: s.population, food: s.resources.food, enemies: s.monsters.length })); lastStatus = Date.now(); }
        previous = s; await page.waitForTimeout(750);
      }
      await click('[data-speed="0"]'); const final = await sample(); await record(final); await screenshot('final', final);
      await page.setViewportSize(screenshotViewport);
      if ((await page.locator('#left-panel').getAttribute('class')).includes('hud-panel-hidden-left')) await click('#btn-toggle-left-hud');
      await page.locator('#stat-food').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${dir}/screenshots/final-city-status.png` });
      await log('screenshot', { name: 'final-city-status' });
      const summary = { id, strategy, repeat, wallSeconds: (Date.now() - started) / 1000, gameSeconds: final.simulationTime - initial.simulationTime, stopReason, initial, final, events, actions, errors, inputErrors };
      await writeFile(`${dir}/summary.json`, JSON.stringify(summary, null, 2) + '\n'); results.push(summary);
      await writeFile(`${root}/summary.json`, JSON.stringify(results, null, 2) + '\n');
      console.log(`COMPLETE ${id}: ${final.population} people, era ${final.era}, ${final.resources.food} food; ${errors.length} page errors; ${inputErrors.length} input errors`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
