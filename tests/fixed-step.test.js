import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFixedStepper } from '../src/systems/fixed-step.js';

test('1x and 5x advance identical ticks for equal game time', () => {
  const clocks = [createFixedStepper(), createFixedStepper()], ticks = [[], []];
  for (let i = 0; i < 100; i++) clocks[0].advance(0.05, 1, (dt, time) => ticks[0].push([dt, time]));
  for (let i = 0; i < 20; i++) clocks[1].advance(0.05, 5, (dt, time) => ticks[1].push([dt, time]));
  assert.equal(ticks[0].length, 100); assert.deepEqual(ticks[0], ticks[1]);
});
test('pause drops fractional debt and never catches up missed wall time', () => {
  const clock = createFixedStepper();let ticks = 0;
  clock.advance(0.03, 1, () => ticks++);
  clock.advance(30, 0, () => ticks++);
  assert.equal(ticks, 0);assert.equal(clock.time, 0);
  clock.advance(0.05, 1, () => ticks++);assert.equal(ticks, 1);
  clock.advance(600, 5, () => ticks++);assert.equal(ticks, 6);
});
test('a pause inside a frame stops remaining ticks', () => {
  const clock = createFixedStepper();let ticks = 0;
  clock.advance(0.05, 5, () => { ticks++;return false; });
  assert.equal(ticks, 1);
  clock.advance(0.05, 1, () => ticks++);assert.equal(ticks, 2);
});
