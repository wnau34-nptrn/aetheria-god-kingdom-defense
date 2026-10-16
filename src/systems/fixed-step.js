// A bounded simulation clock: 1x and 5x execute the same 50ms game ticks.
// Preserve the existing 50ms frame clamp so background tabs do not fast-forward.
export function createFixedStepper({ step = 0.05, maxFrameDelta = 0.05, maxSteps = 8 } = {}) {
  let accumulator = 0, time = 0;
  return {
    get time() { return time; },
    advance(delta, scale, update) {
      if (!Number.isFinite(delta) || delta < 0 || !Number.isFinite(scale) || scale <= 0) {
        accumulator = 0;
        return 0;
      }
      accumulator += Math.min(delta, maxFrameDelta) * Math.min(scale, 5);
      let steps = 0;
      while (accumulator + 1e-9 >= step && steps < maxSteps) {
        accumulator = Math.max(0, accumulator - step);
        time += step;
        steps++;
        if (update(step, time) === false) { accumulator = 0; break; }
      }
      // A bounded budget cannot accumulate a catch-up burst for a later frame.
      if (steps === maxSteps) accumulator = 0;
      return steps;
    }
  };
}
