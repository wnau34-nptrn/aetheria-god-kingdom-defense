import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { installCombatFixture, armCombatPause } from './helpers/combat-fixture.js';

const evidence = process.env.GAME_SMOKE_EVIDENCE || `/tmp/aetheria-production-${Date.now()}`;
await mkdir(evidence, { recursive: true });
const root = resolve('dist'), prefix = '/aetheria-god-kingdom-defense/';
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.ttf':'font/ttf', '.woff':'font/woff' };
let server, target = process.env.GAME_SMOKE_URL;
if (!target) {
  server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!path.startsWith(prefix)) { res.writeHead(404).end(); return; }
      const file = resolve(root, path.slice(prefix.length) || 'index.html');
      if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  target = `http://127.0.0.1:${server.address().port}${prefix}`;
}
target = target.endsWith('/') ? target : target + '/';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']
});
const runs = [];
try {
  for (const mobile of [false, true]) {
    const viewport = mobile ? { width:390,height:844 } : { width:1280,height:800 };
    const context = await browser.newContext({ viewport, hasTouch:mobile, isMobile:mobile });
    const page = await context.newPage(), errors = [], failures = [], assets = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', req => failures.push({url:req.url(),error:req.failure()?.errorText}));
    page.on('response', response => {
      if (new URL(response.url()).origin === new URL(target).origin) {
        assets.push({url:response.url(),status:response.status()});
        if (response.status() >= 400) failures.push({url:response.url(),status:response.status()});
      }
    });
    try {
      const response = await page.goto(target, {timeout:60000}); assert.equal(response.status(), 200);
      await page.waitForFunction(() => window.AETHERIA_API, null, {timeout:60000});
      assert.equal(await page.evaluate(()=>(()=>{const faces=[...document.fonts].filter(f=>f.family.includes('Aetheria Thai'));return faces.length===4&&faces.every(f=>f.status==='loaded');})()),true);
      await page.click('[data-speed="0"]');
      const read = () => page.evaluate(() => {
        const a = AETHERIA_API;
        return { time:a.simulationTime, speed:a.state.timeScale, faith:a.state.faith,
          power:a.state.activePower, wood:a.state.wood, ore:a.state.ore, autoBuild:a.state.autoBuild, people:a.agents.filter(v=>v.alive).length,
          soldiers:a.agents.filter(v=>v.alive&&v.role==='soldier').length,
          hudPeople:Number(document.getElementById('quick-pop').textContent) };
      });
      const speeds = [];
      for (const speed of [1,5]) {
        await page.click(`[data-speed="${speed}"]`); const before = await read();
        await page.waitForFunction(time => AETHERIA_API.simulationTime >= time + .2, before.time, {timeout:60000});
        await page.click('[data-speed="0"]'); const paused = await read();
        await page.waitForTimeout(600); assert.equal((await read()).time, paused.time);
        speeds.push({speed,before,paused});
      }
      await page.click('[data-power="miracle"]');
      assert.equal((await read()).power, 'miracle');
      assert.equal(await page.locator('#placement-feedback').isVisible(), true);
      await page.click('[data-power="rain"]');
      if (mobile) {
        const before = await read(); await page.touchscreen.tap(195,460); const after = await read();
        assert.equal(before.faith - after.faith, 15, 'one touch must spend one rain cost');
      }
      await page.click('[data-power="observe"]');
      // Important commands are available from the HUD, without a drawer.
      assert.equal(await page.locator('#left-panel').isVisible(), false);
      const beforeRecruit = await read();
      await page.click('[data-strategy-action="villager"]');
      const afterRecruit = await read();
      assert.equal(afterRecruit.people, beforeRecruit.people + 1);
      assert.ok(Math.abs(afterRecruit.faith - (beforeRecruit.faith - 20)) < 1e-6);
      await page.click('[data-strategy-action="soldier"]');
      const afterTraining = await read();
      assert.equal(afterTraining.soldiers, beforeRecruit.soldiers + 1);
      assert.ok(Math.abs(afterTraining.faith - (afterRecruit.faith - 25)) < 1e-6);
      assert.equal(await page.locator('#quick-soldiers').textContent(), String(afterTraining.soldiers));
      await page.click('#btn-trigger-dilemma');
      assert.equal(await page.locator('#decision-card').isVisible(), true);
      assert.equal(await page.locator('#dilemma-overlay').isVisible(), false);
      assert.equal(await page.locator('#decision-card .dl-choice-btn').count(), 3);
      // A failed random council plot keeps its choices; try another affordable decision.
      for (let choice=0;choice<3 && await page.locator('#decision-card').isVisible();choice++) {
        const button = page.locator(`#dl-choice-${choice}`);
        if (await button.getAttribute('aria-disabled') === 'false') await button.click();
      }
      assert.equal(await page.locator('#decision-card').isVisible(), false);
      // Exercise the economy entry point on the built/deployed version too.
      const beforeOrder = await read(); assert.equal(beforeOrder.autoBuild, false);
      await page.click('#resource-wood');
      await page.waitForFunction(() => document.getElementById('economy-stock').textContent === String(Math.floor(AETHERIA_API.state.wood)));
      assert.equal(await page.locator('#economy-panel').isVisible(), true);
      assert.match(await page.locator('#economy-source').textContent(), /ส่งคลังกลาง/);
      await page.click('#btn-economy-worker');
      assert.equal(await page.evaluate(() => AETHERIA_API.strategy.snapshot.city), 'wood');
      assert.equal(await page.evaluate(() => AETHERIA_API.state.selectedEntity), null);
      assert.equal(await page.evaluate(() => AETHERIA_API.economy.active), false);
      assert.equal(await page.evaluate(() => AETHERIA_API.strategy.enabled), true);
      assert.ok(await page.evaluate(() => AETHERIA_API.agents.some(a=>a.strategyAssignment?.kind==='wood')));
      const final = await read(); assert.equal(final.people, final.hudPeople);
      assert.equal(final.wood,beforeOrder.wood); assert.equal(final.ore,beforeOrder.ore);
      for (const id of ['#top-bar','#god-dock','#kingdom-readout']) {
        const box = await page.locator(id).boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, `${id} fits viewport`);
      }
      if (process.env.EXPECTED_GAME_COMMIT) {
        const url = new URL('version.json', target); url.searchParams.set('commit',process.env.EXPECTED_GAME_COMMIT);
        const version = await context.request.get(url.href); assert.equal(version.status(),200);
        assert.equal((await version.json()).commit, process.env.EXPECTED_GAME_COMMIT);
      }
      assert.ok(assets.some(v=>v.url.includes('/assets/')&&v.url.includes('.js')), 'bundled modules loaded');
      assert.deepEqual(failures,[]); assert.deepEqual(errors,[]);
      const run = {mobile,viewport,speeds,final,assets,errors,failures,capture:{status:'pending',startedAt:new Date().toISOString()}};
      runs.push(run);
      const report = () => writeFile(`${evidence}/summary.json`, JSON.stringify({target,mode:process.env.GAME_SMOKE_URL?'deployed':'local-production-subpath',expectedCommit:process.env.EXPECTED_GAME_COMMIT||null,runs},null,2));
      await report();
      try {
        await page.bringToFront();
        await page.screenshot({path:`${evidence}/${mobile?'mobile':'desktop'}.png`,animations:'disabled',timeout:90000});
        run.capture.status = 'passed';
        run.capture.finishedAt = new Date().toISOString();
      } catch (error) {
        run.capture.status = 'failed'; run.capture.error = error.message;
        await report(); throw error;
      }
      // Explicit duel fixture also runs against the built/public game, using
      // its actual animation loop rather than invoking damage functions.
      const combatBefore=await page.evaluate(installCombatFixture);
      await page.evaluate(armCombatPause,{kind:'contacts',value:combatBefore.contacts+1});
      await page.click('[data-speed="1"]');
      await page.waitForFunction(()=>window.__combatReached,null,{timeout:60000});
      run.combat=await page.evaluate(()=>({enemyHP:AETHERIA_API.monsters[0].hp,phase:AETHERIA_API.agents[0].combat.phase,feedback:AETHERIA_API.combatFeedback}));
      assert.equal(run.combat.enemyHP,476);assert.equal(run.combat.phase,'strike');assert.ok(run.combat.feedback.impacts>0);
      await page.screenshot({path:`${evidence}/combat-${mobile?'mobile':'desktop'}.png`,animations:'disabled',timeout:90000});
      assert.deepEqual(failures,[]); assert.deepEqual(errors,[]);
      await report();
    } finally { await context.close(); }
  }
  await writeFile(`${evidence}/summary.json`, JSON.stringify({target,mode:process.env.GAME_SMOKE_URL?'deployed':'local-production-subpath',expectedCommit:process.env.EXPECTED_GAME_COMMIT||null,runs},null,2));
  console.log(JSON.stringify({target,scenarios:runs.length,errors:0,evidence}));
} finally {
  await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}
