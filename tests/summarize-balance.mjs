import { readFile, writeFile } from 'node:fs/promises';

const root = process.env.BALANCE_EVIDENCE || 'docs/balance-review';
const runs = [];
for (const phase of ['before-food-fix', 'after-npc-fix']) {
  try {
    const phaseRuns = JSON.parse(await readFile(`${root}/${phase}/summary.json`, 'utf8'));
    runs.push(...phaseRuns.map(run => ({ ...run, phase, directory: `${phase}/${run.id}` })));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (!runs.length) {
  const flatRuns = JSON.parse(await readFile(`${root}/summary.json`, 'utf8'));
  runs.push(...flatRuns.map(run => ({ ...run, phase: 'current', directory: run.id })));
}
const count = (items, key) => items.reduce((r, x) => (r[x[key]] = (r[x[key]] || 0) + 1, r), {});
const compact = s => s ? { gameSeconds: s.simulationTime, day: s.day, time: s.time, era: s.era, progress: s.progress, population: s.population, roles: s.roles, resources: s.resources, structures: count(s.buildings, 'type'), monsters: s.monsters.length } : null;
const metrics = [];
const series = [];
for (const run of runs) {
  const rows = (await readFile(`${root}/${run.directory}/timeline.jsonl`, 'utf8')).trim().split('\n').map(x => JSON.parse(x));
  const snapshots = rows.filter(x => x.type === 'snapshot');
  if (snapshots.some((s, i) => i && s.simulationTime < snapshots[i - 1].simulationTime - 1e-8)) throw new Error(`Simulation clock reset during ${run.directory}; do not treat a reload as a continuous playthrough.`);
  const logs = [...new Set(snapshots.flatMap(s => s.log))];
  const firstEra = snapshots.filter(s => s.era === 1);
  const firstNight = snapshots.find(s => s.day === 1 && s.night);
  const firstDawn = snapshots.find(s => s.day === 2 && s.time >= 6 && s.time < 20);
  // Potential travel stalls only: hunger high, visible FORAGE, food in stock,
  // and all sampled positions remain within 1.5 world units for >= 10 game seconds.
  const tracks = new Map(), stalled = new Map();
  for (const s of firstEra) {
    const eligible = new Set();
    for (const u of s.units) {
      if (u.state !== 'FORAGE' || u.hunger < 65 || !u.visible || s.resources.food < 2) continue;
      eligible.add(u.id); let t = tracks.get(u.id);
      if (!t || Math.hypot(u.x - t.x, u.z - t.z) > 1.5) t = { x: u.x, z: u.z, start: s.simulationTime, hp: u.hp };
      tracks.set(u.id, t);
      const seconds = s.simulationTime - t.start;
      if (seconds >= 10 && seconds > (stalled.get(u.id)?.seconds || 0)) stalled.set(u.id, { id: u.id, role: u.role, seconds, from: t.start, to: s.simulationTime, x: t.x, z: t.z, hpStart: t.hp, hpEnd: u.hp });
    }
    for (const id of tracks.keys()) if (!eligible.has(id)) tracks.delete(id);
  }
  metrics.push({
    id: run.directory, phase: run.phase, strategy: run.strategy, repeat: run.repeat, gameSeconds: run.gameSeconds, wallSeconds: run.wallSeconds, stopReason: run.stopReason,
    initial: compact(run.initial), firstNight: compact(firstNight), firstDawn: compact(firstDawn), final: compact(run.final),
    minPopulationInEra1: Math.min(...firstEra.map(s => s.population)),
    peakMonstersInEra1: Math.max(...firstEra.map(s => s.monsters.length)),
    maxHiddenCiviliansAtNight: Math.max(0, ...firstEra.filter(s => s.night).map(s => s.units.filter(u => u.role !== 'soldier' && u.state === 'SHELTER' && !u.visible).length)),
    firstWaveBosses: firstNight?.monsters.filter(x => x.boss).length,
    starvationDeaths: logs.filter(x => x.includes('สิ้นใจจากความอดอยาก')),
    combatDeaths: logs.filter(x => x.includes('พ่ายแพ้ในการปกป้องหมู่บ้าน')),
    construction: logs.filter(x => x.includes('ก่อสร้าง')),
    eraTransitions: rows.filter(x => x.type === 'era-transition').map(x => ({ before: compact(x.before), after: compact(x.after) })),
    potentialForageStalls: [...stalled.values()], events: run.events, actions: run.actions,
    pageErrors: run.errors, inputErrors: run.inputErrors
  });
  const version = run.phase === 'before-food-fix' ? 'before' : run.phase === 'after-npc-fix' ? 'after' : 'current';
  series.push({ id: `${run.strategy}-${version}`, phase: run.phase, strategy: run.strategy, samples: snapshots.map(s => ({ gameSeconds: s.simulationTime - run.initial.simulationTime, population: s.population, food: s.resources.food, faith: s.resources.faith, era: s.era, monsters: s.monsters.length })) });
}
await writeFile(`${root}/metrics.json`, JSON.stringify(metrics, null, 2) + '\n');
await writeFile(`${root}/series.json`, JSON.stringify(series, null, 2) + '\n');
console.table(metrics.map(m => ({ run: m.id, gameSeconds: Math.round(m.gameSeconds), dawnPeople: m.firstDawn?.population, dawnFood: m.firstDawn?.resources.food, starved: m.starvationDeaths.length, combatDeaths: m.combatDeaths.length, errors: m.pageErrors.length, inputErrors: m.inputErrors.length })));
