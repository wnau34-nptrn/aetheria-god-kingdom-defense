import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createFixedStepper } from '../../src/systems/fixed-step.js';
import { chooseFoodTree } from '../../src/systems/food-target.js';
import { parseProgress, PROGRESS_KEY } from '../../src/systems/progress-save.js';

// Controlled clock + DOM integration harness. The actual game/geometry code runs;
// pixels/audio are stubbed. Browser tests separately exercise real WebGL and input.
export function createGameHarness({ seed = 1234, source } = {}) {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://aetheria.test/', runScripts: 'outside-only' });
  const w = dom.window;
  let randomState = seed >>> 0, wallSeconds = 0, frameDelta = 0, scheduled, frame;
  w.Math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 2 ** 32;
  };
  w.performance.now = () => wallSeconds * 1000;
  w.setTimeout = (callback, delay) => { if (delay === 42) scheduled = callback; return 1; };
  w.requestAnimationFrame = callback => { frame = callback; return 1; };
  w.HTMLCanvasElement.prototype.getContext = function (kind) {
    if (kind !== '2d') return null;
    const gradient = { addColorStop() {} };
    return new Proxy({ canvas: this, measureText: text => ({ width: String(text).length * 6 }),
      createLinearGradient: () => gradient, createRadialGradient: () => gradient }, {
      get(target, key) { return key in target ? target[key] : () => {}; },
      set(target, key, value) { target[key] = value; return true; }
    });
  };
  w.eval(readFileSync(new URL('../../src/legacy/webgl-engine.js', import.meta.url), 'utf8'));
  w.THREE.WebGLRenderer = class {
    constructor({ canvas }) { this.domElement = canvas; this.shadowMap = {}; }
    setSize(width, height) { this.domElement.width = width; this.domElement.height = height; }
    setPixelRatio() {}
    render() {}
  };
  w.THREE.Clock = class { getDelta() { return frameDelta; } };
  Object.assign(w, { parseProgress, PROGRESS_KEY, createFixedStepper, chooseFoodTree });
  w.eval((source ?? readFileSync(new URL('../../src/legacy/game.js', import.meta.url), 'utf8')).replace(/^import .+;\n/gm, ''));
  const api = w.AETHERIA_API;
  // Avoid unnecessary thought-bubble DOM churn; this does not change simulation.
  w.document.getElementById('btn-toggle-bubbles')?.click();
  return { window: w, api, click(selector) { const element = w.document.querySelector(selector); if (!element) throw new Error(`Missing ${selector}`); element.click(); },
    frame(delta = 0.05) { frameDelta = delta; wallSeconds += delta; scheduled(); frame(); },
    advance(seconds, speed, delta = 0.05) {
      this.click(`[data-speed="${speed}"]`);
      let remaining = seconds / speed;
      while (remaining > 1e-10) {
        const next = Math.min(delta, remaining);
        this.frame(next);
        remaining -= next;
      }
    },
    // Long navigation checks close natural event modals through their UI so
    // "seconds" means elapsed simulation time, including at 1x.
    play(seconds, speed, delta = 0.05) {
      if (speed <= 0) throw new Error('play requires a positive speed');
      const end = api.simulationTime + seconds;
      this.click(`[data-speed="${speed}"]`);
      while (api.simulationTime < end - 1e-8) {
        if (w.document.getElementById('dilemma-overlay').classList.contains('visible')) this.click('#btn-close-dilemma');
        this.frame(Math.min(delta, (end - api.simulationTime) / speed));
      }
    },
    close() { dom.window.close(); }
  };
}

export function isolate(harness, { agents = [], buildings = [], time = 12 } = {}) {
  const a = harness.api;
  const remove = entity => { if (entity.mesh?.parent) entity.mesh.parent.remove(entity.mesh); };
  for (const entity of a.agents) if (!agents.includes(entity)) { entity.alive = false; remove(entity); }
  a.agents.splice(0, a.agents.length, ...agents);
  for (const entity of a.buildings) if (!buildings.includes(entity)) remove(entity);
  a.buildings.splice(0, a.buildings.length, ...buildings);
  for (const entity of [...a.monsters, ...a.projectiles, ...a.wagons, ...a.livestock]) remove(entity);
  a.monsters.length = a.projectiles.length = a.wagons.length = a.livestock.length = 0;
  a.state.timeOfDay = time; a.state.isNight = time >= 20 || time < 5.5;
  a.state.siegeTriggeredTonight = a.state.secondWaveTonight = true;
  a.state.autoBuildCooldown = 1e6;
  for (const agent of agents) { agent.hunger = 0; agent.workTimer = 0; agent.targetObj = null; agent.carryAmount = 0; }
}

export function stationaryMonster(harness, x, z) {
  const a = harness.api; a.spawnMonster(1); const monster = a.monsters.at(-1);
  Object.assign(monster, { x, z, hp: 10000, maxHp: 10000, speed: 0, dmg: 0, alive: true });
  monster.mesh.position.set(x, harness.window._getTerrainHeightAt(x, z), z);
  return monster;
}
