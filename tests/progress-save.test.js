import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgress } from '../src/systems/progress-save.js';
const valid = {day:1,timeOfDay:8.2,civEra:1,civProgress:0,food:35,wood:20,ore:15,faith:60};
test('accepts existing V1 checkpoints and zero resources',()=>{
  assert.deepEqual(parseProgress(JSON.stringify(valid)),valid);
  assert.equal(parseProgress(JSON.stringify({...valid,food:0,faith:0})).food,0);
});
test('rejects malformed or incomplete checkpoints',()=>{
  for (const raw of ['{','null','[]','{}',JSON.stringify({civEra:1})]) assert.equal(parseProgress(raw),null);
});
test('rejects unsafe values before they can change the world',()=>{
  for (const [key,value] of [['day',0],['day',1.5],['civEra',2.5],['civEra',5],['food',-5],['wood','20'],['ore',1e10],['faith',201],['timeOfDay',24],['civProgress',101]]) {
    assert.equal(parseProgress(JSON.stringify({...valid,[key]:value})),null,`${key}=${value}`);
  }
  assert.equal(parseProgress(JSON.stringify(valid).replace('35','1e999')),null);
});
test('does not copy unexpected fields into game state',()=>{
  assert.deepEqual(parseProgress(JSON.stringify({...valid,timeScale:999,selectedEntity:{}})),valid);
});
