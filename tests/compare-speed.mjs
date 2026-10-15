import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runSpeedScenario } from './helpers/speed-scenarios.js';
const source = process.env.SPEED_SOURCE ? await readFile(process.env.SPEED_SOURCE, 'utf8') : undefined;
const results = [];
for (const seed of [1234, 5678]) for (const speed of [1, 5]) {
  for (const scenario of ['soldier', 'tower', 'farmer', 'patrol', 'caravan-affordability']) {
    results.push({ seed, speed, scenario, ...runSpeedScenario(scenario, { seed, speed, source }) });
  }
}
await mkdir('docs/speed-review', { recursive: true });
await writeFile(process.env.SPEED_REPORT || 'docs/speed-review/after.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
