import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGameHarness, isolate } from './helpers/game-harness.js';

const source = await readFile(process.env.NAV_SOURCE || 'src/legacy/game.js', 'utf8');
const results = { sourceSha256: createHash('sha256').update(source).digest('hex'), method: 'Controlled jsdom logic integration, seed 1234; geometry/game logic run; pixels/audio stubbed. Not a natural browser playthrough.', cases: [] };
for (const speed of [1, 5]) for (const scenario of ['initial-worker', 'bridge-meal', 'south-haul', 'north-haul']) {
  const h = createGameHarness({ source }), a = h.api;
  try {
    let seconds, agent;
    if (scenario === 'initial-worker') { agent = a.agents.find(x => x.id === 3); seconds = 88; }
    else if (scenario === 'bridge-meal') {
      agent = a.agents.find(x => x.role === 'soldier'); isolate(h, { agents: [agent] });
      Object.assign(agent, { x: 5.45, z: 13, hunger: 80 }); a.state.food = 10; seconds = 10;
    } else {
      if (scenario === 'north-haul') a.evolveToEra(3);
      agent = a.agents.find(x => x.role === 'villager'); isolate(h, { agents: [agent] });
      Object.assign(agent, { x: -28, z: scenario === 'south-haul' ? 20 : -25, carryType: 'ore', carryAmount: 5 });
      a.state.ore = 0; seconds = 30;
    }
    const start = { x: agent.x, z: agent.z };
    const startTime = a.simulationTime;
    h.play(seconds, speed);
    results.cases.push({ scenario, speed, seconds, elapsedGameSeconds: a.simulationTime - startTime, start, alive: agent.alive, hp: agent.hp, hunger: agent.hunger, x: agent.x, z: agent.z, food: a.state.food, ore: a.state.ore });
  } finally { h.close(); }
}
await writeFile(process.env.NAV_REPORT || 'docs/balance-review/navigation-after.json', JSON.stringify(results, null, 2) + '\n');
console.log(results);
