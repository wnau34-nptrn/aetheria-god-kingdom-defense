import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameHarness, isolate } from './helpers/game-harness.js';

for (const speed of [1, 5]) {
  test(`a hungry worker eats nearby stored food instead of chasing a distant tree at ${speed}x`, () => {
    const h = createGameHarness(), a = h.api;
    try {
      const worker = a.agents.find(x => x.role === 'villager');
      isolate(h, { agents: [worker] });
      Object.assign(worker, { x: 3, z: 0, hunger: 70 }); a.state.food = 10;
      a.trees.splice(1); Object.assign(a.trees[0], { x: 80, z: 30, hasFruit: true, growth: 1 });
      h.play(1, speed);
      assert.equal(a.state.food, 8); assert.ok(worker.hunger < 3);
      assert.equal(a.trees[0].hasFruit, true);
    } finally { h.close(); }
  });

  test(`a hungry worker chooses nearby ripe fruit rather than generation order at ${speed}x`, () => {
    const h = createGameHarness(), a = h.api;
    try {
      const worker = a.agents.find(x => x.role === 'villager');
      isolate(h, { agents: [worker] });
      Object.assign(worker, { x: 8, z: 0, hunger: 70 }); a.state.food = 0;
      a.trees.splice(2);
      Object.assign(a.trees[0], { x: 80, z: 30, hasFruit: true, growth: 1 });
      Object.assign(a.trees[1], { x: 9, z: 0, hasFruit: true, growth: 1 });
      h.play(1, speed);
      assert.equal(a.state.food, 2); assert.ok(worker.hunger < 3);
      assert.equal(a.trees[0].hasFruit, true); assert.equal(a.trees[1].hasFruit, false);
    } finally { h.close(); }
  });
}

for (const seed of [11, 55]) test(`the tribe reaches the first evening without food-chasing deaths (seed ${seed})`, () => {
  const h = createGameHarness({ seed });
  try {
    h.play(107, 5);
    assert.equal(h.api.agents.filter(x => x.alive).length, 7);
    assert.ok(h.api.state.food > 0);
  } finally { h.close(); }
});
