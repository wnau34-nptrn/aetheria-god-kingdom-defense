import { createGameHarness, isolate, stationaryMonster } from './game-harness.js';
export function runSpeedScenario(scenario, { seed = 1234, speed = 1, delta = 0.05, source } = {}) {
  const h = createGameHarness({ seed, source }), a = h.api;
  try {
    let measure, seconds = 13;
    if (scenario === 'soldier' || scenario === 'patrol') {
      const soldier = a.agents.find(x => x.role === 'soldier');
      isolate(h, { agents: [soldier], time: scenario === 'soldier' ? 21 : 12 });
      if (scenario === 'soldier') {
        const monster = stationaryMonster(h, soldier.x, soldier.z);
        measure = () => ({ damage: 10000 - monster.hp, hunger: soldier.hunger });
      } else measure = () => ({ x: soldier.x, z: soldier.z });
    } else if (scenario === 'tower') {
      const tower = a.buildings.find(x => x.type === 'tower');
      isolate(h, { buildings: [tower], time: 21 });
      const monster = stationaryMonster(h, tower.x + 10, tower.z);
      measure = () => ({ damage: 10000 - monster.hp, shotsInFlight: a.projectiles.length });
    } else if (scenario === 'farmer' || scenario === 'fisherman') {
      a.evolveToEra(2); const agent = a.agents.find(x => x.role === scenario);
      isolate(h, { agents: [agent] });
      if (scenario === 'farmer') {
        a.cropFields.splice(1); agent.id = 0; agent.x = a.cropFields[0].x; agent.z = a.cropFields[0].z;
      }
      a.state.food = 0;
      measure = () => ({ food: a.state.food, carried: agent.carryAmount, x: agent.x, z: agent.z });
    } else if (scenario === 'hauling') {
      const agent = a.agents.find(x => x.role === 'villager');
      isolate(h, { agents: [agent] });
      agent.id = 1; agent.x = 8; agent.z = 0;
      a.ores.splice(1); Object.assign(a.ores[0], { x: 8, z: 0, oreAmount: 500 });
      a.state.ore = 0;
      measure = () => ({ ore: a.state.ore, carried: agent.carryAmount, x: agent.x, z: agent.z, hunger: agent.hunger });
    } else if (scenario === 'construction' || scenario === 'repair') {
      const agent = a.agents.find(x => x.role === 'villager'), house = a.buildings.find(x => x.type === 'house');
      isolate(h, { agents: [agent], buildings: [house] });
      agent.x = house.x; agent.z = house.z; a.state.wood = 10;
      if (scenario === 'construction') house.progress = 0.25;
      else house.hp = 20;
      seconds = 2;
      measure = () => ({ progress: house.progress, hp: house.hp, wood: a.state.wood, state: agent.state });
    } else if (scenario === 'monster') {
      const house = a.buildings.find(x => x.type === 'house');
      isolate(h, { buildings: [house], time: 21 });
      house.hp = house.maxHp = 10000;
      const monster = stationaryMonster(h, house.x, house.z); monster.dmg = 10;
      measure = () => ({ damage: 10000 - house.hp });
    } else if (scenario === 'meteor') {
      isolate(h, { time: 21 }); const monster = stationaryMonster(h, 40, 40);
      a.state.faith = 200; a.castMeteorStrike(40, 40); seconds = 1.5;
      measure = () => ({ damage: 10000 - monster.hp, shotsInFlight: a.projectiles.length });
    } else if (scenario === 'caravan-affordability') {
      a.state.faith = a.state.wood = a.state.food = 0;
      a.openInteractiveDilemma(2); h.click('#dl-choice-0');
      measure = () => ({ food: a.state.food, wagons: a.wagons.length, modalOpen: h.window.document.getElementById('dilemma-overlay').classList.contains('visible') });
    } else throw new Error(`Unknown scenario: ${scenario}`);
    if (scenario !== 'caravan-affordability') h.advance(seconds, speed, delta);
    return measure();
  } finally { h.close(); }
}
