import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createGameHarness } from './helpers/game-harness.js';

const baseline = '21b50a6';
let beforeSource;
if (process.env.FOOD_BASELINE_SOURCE) beforeSource = await readFile(process.env.FOOD_BASELINE_SOURCE, 'utf8');
else {
  try { beforeSource = execFileSync('git', ['show', `${baseline}:src/legacy/game.js`], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }); }
  catch { throw new Error('Cannot read the baseline with git; export it to a file and set FOOD_BASELINE_SOURCE.'); }
}
const variants = {
  before: beforeSource,
  after: await readFile(process.env.FOOD_SOURCE || 'src/legacy/game.js', 'utf8')
};
const results = [];
for (const seed of [11, 22, 33, 44, 55, 66, 77, 88, 99, 110]) for (const [variant, source] of Object.entries(variants)) {
  const h = createGameHarness({ seed, source }), a = h.api, deaths = [], known = new Set();
  try {
    h.click('[data-speed="5"]');
    while (a.simulationTime < 107 - 1e-8) {
      if (h.window.document.getElementById('dilemma-overlay').classList.contains('visible')) h.click('#btn-close-dilemma');
      h.frame();
      for (const unit of a.agents) if (!unit.alive && !known.has(unit.id)) {
        known.add(unit.id); deaths.push({ id: unit.id, food: a.state.food, time: a.simulationTime });
      }
    }
    results.push({ seed, variant, population: a.agents.filter(x => x.alive).length, food: a.state.food, deaths });
  } finally { h.close(); }
}
const report = {
  method: 'Controlled jsdom logic experiment at 5x; 107 game seconds; close natural events without choosing; paired seeds. Not a natural browser playthrough or proof of game balance.',
  baseline, sourceSha256: Object.fromEntries(Object.entries(variants).map(([k, s]) => [k, createHash('sha256').update(s).digest('hex')])), results
};
await writeFile(process.env.FOOD_REPORT || 'docs/balance-review/food-choice-trial.json', JSON.stringify(report, null, 2) + '\n');
console.log(results);
