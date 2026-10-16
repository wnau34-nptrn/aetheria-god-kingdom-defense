import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGameHarness } from './helpers/game-harness.js';

if (!process.env.PLACEMENT_BASELINE_SOURCE) throw new Error('Set PLACEMENT_BASELINE_SOURCE to the exported 2790b18 game.js');
const source = readFileSync('src/legacy/game.js', 'utf8');
const before = createGameHarness({ source: readFileSync(process.env.PLACEMENT_BASELINE_SOURCE, 'utf8') });
const after = createGameHarness();
let checked = 0;
const differences = [];
try {
  for (const era of [1, 2, 3, 4]) {
    if (era > 1) { before.api.evolveToEra(era); after.api.evolveToEra(era); }
    for (let x = -80; x <= 80; x += 2) for (let z = -80; z <= 80; z += 2) {
      checked++;
      if (before.api.canPlaceBuildingAt(x, z) !== after.api.canPlaceBuildingAt(x, z)) differences.push({ era, x, z });
    }
  }
  const report = { baseline: '2790b180a9c91bc3d24b456c06420e8366ca18b3', sourceSHA256: createHash('sha256').update(source).digest('hex'), method: 'Actual geometry and simulation, jsdom, seed1234, eras1-4, 2-unit grid -80..80, no render pixels', checked, differences };
  writeFileSync(process.env.PLACEMENT_REPORT || '/tmp/aetheria-placement-compatibility.json', JSON.stringify(report, null, 2));
  console.log({ checked, differences });
  if (differences.length) process.exitCode = 1;
} finally { before.close(); after.close(); }
