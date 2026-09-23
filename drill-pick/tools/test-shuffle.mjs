import assert from 'node:assert/strict';
import * as core from '../wheel-core.js';

function spin(state, rng = Math.random) {
  const index = core.pick(state, rng);
  assert.notEqual(index, null);
  return [core.recordPick(state, index), index];
}

// No project can win twice within a completed round. This includes rounds
// that share a boundary with the previous round.
for (let seed = 1; seed <= 100; seed++) {
  let randomSeed = seed;
  const rng = () => {
    randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0;
    return randomSeed / 4294967296;
  };
  let state = core.createInitialState();
  let previous = null;
  for (let round = 0; round < 10; round++) {
    const seen = new Set();
    for (let n = 0; n < core.SPOT_COUNT; n++) {
      let index;
      [state, index] = spin(state, rng);
      assert.notEqual(index, previous, 'no immediate repeats across round boundaries');
      assert.equal(seen.has(index), false, 'a project must not repeat within a round');
      seen.add(index);
      previous = index;
    }
    assert.equal(seen.size, core.SPOT_COUNT);
    assert.deepEqual(state.remainingIds, [], 'bag is empty at round end');
  }
}

// A saved half-used bag must resume without bringing back already-picked spots.
{
  let state = core.createInitialState();
  const firstHalf = new Set();
  for (let i = 0; i < 3; i++) {
    let index;
    [state, index] = spin(state, () => 0);
    firstHalf.add(index);
  }
  const storage = new Map();
  const store = core.createStore({
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
  });
  assert.equal(store.save(state), true);
  state = store.load();
  assert.equal(state.remainingIds.length, 3);
  for (let i = 0; i < 3; i++) {
    let index;
    [state, index] = spin(state, () => 0);
    assert.equal(firstHalf.has(index), false, 'a reload must not refill the bag');
  }
  assert.deepEqual(state.remainingIds, []);
}

// Existing v1 users keep names and the last winner. The upgrade starts a new
// shuffle round rather than resetting projects or losing the no-repeat rule.
{
  const state = core.hydrate({
    version: 1,
    seeded: false,
    spots: [
      { id: 's1', name: 'One' },
      { id: 's2', name: 'Two' },
      { id: 's3', name: 'Three' },
      { id: 's4', name: 'Four' },
      { id: 's5', name: 'Five' },
    ],
    lastPickId: 's3',
  });
  assert.equal(state.version, core.SCHEMA_VERSION);
  assert.deepEqual(state.spots.map((spot) => spot.name), ['One', 'Two', 'Three', 'Four', 'Five', '']);
  assert.equal(state.lastPickId, 's3');
  assert.deepEqual(state.remainingIds, []);
  assert.equal(core.eligibleIndices(state).includes(2), false);
}

// Editing names resets the round, and blank spots never appear in the bag.
{
  let state = core.createInitialState();
  state = core.rename(state, 5, '');
  let index;
  [state, index] = spin(state, () => 0);
  assert.equal(state.remainingIds.length, 4);
  assert.equal(state.remainingIds.includes('s6'), false);
  const lastId = state.lastPickId;
  state = core.rename(state, 4, 'New project');
  assert.deepEqual(state.remainingIds, []);
  assert.equal(state.lastPickId, lastId);
  assert.equal(core.eligibleIndices(state).includes(index), false);
  state = core.rename(state, index, 'Another project');
  assert.equal(state.lastPickId, null);
  assert.equal(core.eligibleIndices(state).includes(index), true);
}

// Corrupted or stale IDs cannot make a saved wheel skip or duplicate projects.
{
  const state = core.createInitialState();
  const restored = core.hydrate({
    ...state,
    lastPickId: 's1',
    remainingIds: ['s2', 's2', 'missing', 's1', 's3'],
  });
  assert.deepEqual(restored.remainingIds, ['s2', 's3']);
  assert.deepEqual(core.eligibleIndices(restored), [1, 2]);
}

// One named project can still win; no named projects means no spin.
{
  let state = core.createInitialState();
  for (let i = 1; i < core.SPOT_COUNT; i++) state = core.rename(state, i, '');
  for (let i = 0; i < 5; i++) {
    let index;
    [state, index] = spin(state, () => 0);
    assert.equal(index, 0);
  }
  state = core.rename(state, 0, '');
  assert.equal(core.pick(state), null);
}

console.log('Shuffle bag checks passed (100 seeded runs × 10 rounds, plus edge cases)');
