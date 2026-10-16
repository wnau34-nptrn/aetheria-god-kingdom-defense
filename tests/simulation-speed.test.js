import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSpeedScenario } from './helpers/speed-scenarios.js';

function equivalent(actual, expected) {
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const key of Object.keys(expected)) {
    if (typeof expected[key] === 'number') assert.ok(Math.abs(actual[key] - expected[key]) < 1e-8, `${key}: ${actual[key]} vs ${expected[key]}`);
    else assert.equal(actual[key], expected[key]);
  }
}
for (const seed of [1234, 5678]) for (const scenario of ['soldier', 'tower', 'monster', 'meteor', 'farmer', 'fisherman', 'hauling', 'construction', 'repair', 'patrol']) {
  test(`${scenario} has the same result at 1x, 2.5x and 5x (seed ${seed})`, () => {
    const normal = runSpeedScenario(scenario, { seed, speed: 1 });
    for (const speed of [2.5, 5]) equivalent(runSpeedScenario(scenario, { seed, speed }), normal);
    if (scenario === 'tower') assert.equal(normal.damage, 252);
    if (scenario === 'meteor') assert.equal(normal.damage, 240);
    if (scenario === 'fisherman') assert.equal(normal.food, 8, 'fishing must actually produce four catches in 13 game seconds');
    if (scenario === 'hauling') assert.ok(normal.ore > 0, 'the worker must actually deposit ore');
    if (scenario === 'construction') assert.ok(normal.progress > 0.25 && normal.progress < 1);
    if (scenario === 'repair') assert.equal(normal.hp, 76);
  });
}
for (const scenario of ['tower', 'farmer', 'patrol', 'hauling']) {
  test(`${scenario} is independent of frame sizes up to the existing frame clamp`, () => {
    const normal = runSpeedScenario(scenario);
    for (const delta of [1 / 60, 0.033]) equivalent(runSpeedScenario(scenario, { speed: 5, delta }), normal);
  });
}
