/**
 * Shuffle-bag ("Until everyone has had a turn") checks:  node tools/test-shuffle.mjs
 */
import assert from 'node:assert/strict';
import * as core from '../wheel-core.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function spin(state, rng = Math.random) {
  const wheel = core.buildWheel(state);
  const pos = core.pick(state, rng);
  assert.notEqual(pos, null);
  return [core.recordPick(state, pos, wheel), wheel[pos]];
}

// Every name once per round, never twice in a row — at several wheel sizes.
for (const count of [2, 3, 6, 12]) {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seeded(seed * 31 + count);
    let state = core.updateSettings(core.createInitialState(), { count });
    for (let i = 0; i < count; i++) if (!state.spots[i].name) state = core.rename(state, i, 'P' + i);
    let previous = null;
    for (let round = 0; round < 8; round++) {
      const seen = new Set();
      for (let k = 0; k < count; k++) {
        let w;
        [state, w] = spin(state, rng);
        assert.notEqual(w.id, previous, 'no immediate repeats across round boundaries');
        assert.equal(seen.has(w.id), false, 'a project must not repeat within a round');
        seen.add(w.id);
        previous = w.id;
      }
      assert.equal(seen.size, count);
      assert.deepEqual(state.remainingKeys, [], 'bag is empty at round end');
    }
  }
}

// A doubled name gets two turns a round, but never back to back.
for (let seed = 1; seed <= 200; seed++) {
  const rng = seeded(seed);
  let state = core.updateSettings(core.createInitialState(), { count: 3, double: { on: true, ids: ['s1'] } });
  let previous = null;
  const tally = {};
  for (let k = 0; k < 40; k++) {
    let w;
    [state, w] = spin(state, rng);
    assert.notEqual(w.id, previous, 'a doubled name still sits out the next spin');
    tally[w.id] = (tally[w.id] || 0) + 1;
    previous = w.id;
  }
  assert.ok(tally.s1 > tally.s2 && tally.s1 > tally.s3, 'the doubled name wins more often');
}

// Spin again landings never use up anyone's turn.
{
  const rng = seeded(99);
  let state = core.updateSettings(core.createInitialState(), { again: { on: true, count: 3 } });
  let names = 0;
  const seen = new Set();
  while (names < core.DEFAULT_COUNT) {
    let w;
    [state, w] = spin(state, rng);
    if (w.kind === 'again') continue;
    assert.equal(seen.has(w.id), false);
    seen.add(w.id);
    names++;
  }
  assert.deepEqual(state.remainingKeys, []);
}

// A saved half-used bag resumes without bringing back already-picked spots.
{
  let state = core.createInitialState();
  const firstHalf = new Set();
  for (let i = 0; i < 3; i++) {
    let w;
    [state, w] = spin(state, () => 0);
    firstHalf.add(w.id);
  }
  const storage = new Map();
  const store = core.createStore({
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
  });
  assert.equal(store.save(state), true);
  state = store.load();
  assert.equal(state.remainingKeys.length, 3);
  for (let i = 0; i < 3; i++) {
    let w;
    [state, w] = spin(state, () => 0);
    assert.equal(firstHalf.has(w.id), false, 'a reload must not refill the bag');
  }
  assert.deepEqual(state.remainingKeys, []);
}

// v2 saves keep their half-used bag.
{
  const state = core.hydrate({
    version: 2,
    seeded: false,
    spots: ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({ id: 's' + (i + 1), name })),
    lastPickId: 's1',
    remainingIds: ['s2', 's2', 'missing', 's1', 's3'],
  });
  assert.equal(state.version, core.SCHEMA_VERSION);
  assert.deepEqual(state.remainingKeys, ['s2', 's3']);
  assert.deepEqual(core.eligibleIndices(state), [1, 2]);
}

// Editing names or changing options starts a fresh round.
{
  let state = core.createInitialState();
  [state] = spin(state, () => 0);
  assert.equal(state.remainingKeys.length, core.DEFAULT_COUNT - 1);
  assert.deepEqual(core.rename(state, 4, 'New project').remainingKeys, []);
  assert.deepEqual(core.updateSettings(state, { count: 7 }).remainingKeys, []);
  assert.equal(core.updateSettings(state, { again: { on: true } }).remainingKeys.length,
    core.DEFAULT_COUNT - 1, 'adding spin again spaces keeps the round');
  assert.equal(core.shuffle(state).remainingKeys.length, core.DEFAULT_COUNT - 1, 'shuffling keeps the round');
}

console.log('Shuffle bag checks passed (sizes 2–12, doubles, spin again, saves)');
