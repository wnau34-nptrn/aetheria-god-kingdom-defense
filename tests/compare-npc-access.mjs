import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGameHarness, isolate } from './helpers/game-harness.js';
import { runSpeedScenario } from './helpers/speed-scenarios.js';

if (!process.env.ACCESS_BASELINE_SOURCE) throw new Error('Set ACCESS_BASELINE_SOURCE to game.js exported from commit 0dec70f.');
const variants = { before: await readFile(process.env.ACCESS_BASELINE_SOURCE, 'utf8'), after: await readFile('src/legacy/game.js', 'utf8') };
const hashes = Object.fromEntries(Object.entries(variants).map(([k, s]) => [k, createHash('sha256').update(s).digest('hex')]));
const fishing = [], shelter = [];
for (const seed of [1234, 5678]) for (const speed of [1, 2.5, 5]) fishing.push({ seed, speed,
  before: runSpeedScenario('fisherman', { seed, speed, source: variants.before }),
  after: runSpeedScenario('fisherman', { seed, speed, source: variants.after }) });
for (const [variant, source] of Object.entries(variants)) for (const speed of [1, 5]) {
  const h = createGameHarness({ source }), a = h.api;
  try {
    const worker = a.agents.find(x => x.role === 'villager'), houses = a.buildings.filter(x => x.type === 'house').slice(0, 2);
    isolate(h, { agents: [worker], buildings: houses, time: 21 }); Object.assign(worker, { id: 0, x: 0, z: 0 });
    h.play(15, speed);
    shelter.push({ variant, speed, visible: worker.mesh.visible, state: worker.state, x: worker.x, z: worker.z, houses: houses.map(b => ({ x: b.x, z: b.z })) });
  } finally { h.close(); }
}
const common = { baseline: '0dec70f', sourceSha256: hashes, method: 'Controlled jsdom logic/geometry; stubbed pixels/audio; not a natural browser playthrough.' };
await writeFile('docs/balance-review/fishing-check.json', JSON.stringify({ ...common, gameSeconds: 13, results: fishing }, null, 2) + '\n');
await writeFile('docs/balance-review/shelter-check.json', JSON.stringify({ ...common, gameSeconds: 15, results: shelter }, null, 2) + '\n');
console.log({ fishing, shelter });
