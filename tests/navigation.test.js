import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameHarness, isolate } from './helpers/game-harness.js';

test('the initial river-bank worker can move, eat and survive the first daytime', () => {
  const h = createGameHarness();
  try {
    const worker = h.api.agents.find(a => a.id === 3);
    const start = { x: worker.x, z: worker.z };
    h.advance(88, 5);
    assert.ok(h.api.state.food > 0, 'food remains available in this reproduction');
    assert.ok(worker.alive, 'the worker must not starve while stuck at its spawn');
    assert.ok(Math.hypot(worker.x - start.x, worker.z - start.z) > 3);
    assert.ok(worker.hunger < 99.5, 'the worker must actually reach food');
  } finally { h.close(); }
});

for (const speed of [1, 5]) {
  test(`a hungry soldier can leave the east bridge landing and reach food at ${speed}x`, () => {
    const h = createGameHarness(), a = h.api;
    try {
      const soldier = a.agents.find(x => x.role === 'soldier');
      isolate(h, { agents: [soldier] });
      Object.assign(soldier, { x: 5.45, z: 13, hunger: 80 });
      a.state.food = 10;
      h.advance(10, speed);
      assert.equal(a.state.food, 9);
      assert.ok(soldier.hunger < 20);
    } finally { h.close(); }
  });

  for (const era of [1, 3]) test(`ore can be hauled across the ${era === 1 ? 'south' : 'north'} bridge at ${speed}x`, () => {
    const h = createGameHarness(), a = h.api;
    try {
      if (era === 3) a.evolveToEra(3);
      const worker = a.agents.find(x => x.role === 'villager');
      isolate(h, { agents: [worker] });
      Object.assign(worker, { x: -28, z: era === 1 ? 20 : -25, carryType: 'ore', carryAmount: 5 });
      a.state.ore = 0;
      h.advance(30, speed);
      assert.ok(a.state.ore >= 5, 'the carried ore must arrive at the central store');
    } finally { h.close(); }
  });
}
