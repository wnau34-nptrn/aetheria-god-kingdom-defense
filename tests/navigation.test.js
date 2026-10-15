import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameHarness, isolate } from './helpers/game-harness.js';

test('the initial river-bank worker can move, eat and survive the first daytime', () => {
  const h = createGameHarness();
  try {
    const worker = h.api.agents.find(a => a.id === 3);
    const start = { x: worker.x, z: worker.z };
    h.play(88, 5);
    assert.ok(h.api.state.food > 0, 'food remains available in this reproduction');
    assert.ok(worker.alive, 'the worker must not starve while stuck at its spawn');
    assert.ok(Math.hypot(worker.x - start.x, worker.z - start.z) > 3);
    assert.ok(worker.hunger < 99.5, 'the worker must actually reach food');
  } finally { h.close(); }
});

for (const speed of [1, 5]) {
  test(`a civilian chooses an accessible house instead of the blocked river house at ${speed}x`, () => {
    const h = createGameHarness(), a = h.api;
    try {
      const worker = a.agents.find(x => x.role === 'villager'), houses = a.buildings.filter(x => x.type === 'house').slice(0, 2);
      isolate(h, { agents: [worker], buildings: houses, time: 21 });
      Object.assign(worker, { id: 0, x: 0, z: 0 });
      h.play(15, speed);
      assert.equal(worker.state, 'SHELTER'); assert.equal(worker.mesh.visible, false);
      assert.ok(Math.hypot(worker.x - houses[1].x, worker.z - houses[1].z) < 2.2);
    } finally { h.close(); }
  });

  test(`a civilian returns to the temple when its remaining house is inaccessible at ${speed}x`, () => {
    const h = createGameHarness(), a = h.api;
    try {
      const worker = a.agents.find(x => x.role === 'villager');
      const temple = a.buildings.find(x => x.type === 'temple'), blocked = a.buildings.find(x => x.type === 'house');
      isolate(h, { agents: [worker], buildings: [temple, blocked], time: 21 });
      Object.assign(worker, { id: 0, x: 8, z: 0 }); const faith = a.state.faith;
      h.play(15, speed);
      assert.ok(Math.hypot(worker.x, worker.z) < 2.2);
      assert.equal(worker.state, 'SHELTER'); assert.equal(worker.mesh.visible, true);
      assert.ok(a.state.faith > faith + 15 * 0.45 + 2, 'sheltering at the temple must contribute faith');
    } finally { h.close(); }
  });

  test(`a hungry soldier can leave the east bridge landing and reach food at ${speed}x`, () => {
    const h = createGameHarness(), a = h.api;
    try {
      const soldier = a.agents.find(x => x.role === 'soldier');
      isolate(h, { agents: [soldier] });
      Object.assign(soldier, { x: 5.45, z: 13, hunger: 80 });
      a.state.food = 10;
      h.play(10, speed);
      assert.equal(a.state.food, 9);
      assert.ok(soldier.hunger < 20);
    } finally { h.close(); }
  });

  test(`a worker can reach ore on the opposite bank at ${speed}x`, () => {
    const h = createGameHarness(), a = h.api;
    try {
      const worker = a.agents.find(x => x.role === 'villager');
      isolate(h, { agents: [worker] });
      Object.assign(worker, { id: 1, x: 8, z: 0 });
      a.ores.splice(1); Object.assign(a.ores[0], { x: -28, z: 20, oreAmount: 500 });
      a.state.ore = 0;
      h.play(35, speed);
      assert.ok(worker.carryAmount > 0 || a.state.ore > 0, 'the worker must cross west and actually mine');
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
      h.play(30, speed);
      assert.ok(a.state.ore >= 5, 'the carried ore must arrive at the central store');
    } finally { h.close(); }
  });
}
