/**
 * Rule checks for wheel-core.js. No dependencies:  node tools/test-core.mjs
 */
import assert from 'node:assert/strict';
import * as core from '../wheel-core.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

test('starts with all five spots in play', () => {
  const s = core.createInitialState();
  assert.equal(s.spots.length, core.SPOT_COUNT);
  assert.deepEqual(core.eligibleIndices(s), [0, 1, 2, 3, 4]);
  assert.equal(core.canSpin(s), true);
});

test('the last pick sits out the next spin', () => {
  let s = core.recordPick(core.createInitialState(), 2);
  assert.deepEqual(core.eligibleIndices(s), [0, 1, 3, 4]);
  assert.equal(core.isSittingOut(s, 2), true);
  for (let i = 0; i < 400; i++) assert.notEqual(core.pick(s), 2);
});

test('every other spot stays reachable', () => {
  const s = core.recordPick(core.createInitialState(), 0);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(core.pick(s));
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4]);
});

test('pick never falls off the end of the pool', () => {
  const s = core.createInitialState();
  assert.equal(core.pick(s, () => 0.999999999), 4);
  assert.equal(core.pick(s, () => 0), 0);
});

test('blank spots are skipped', () => {
  let s = core.createInitialState();
  s = core.rename(s, 1, '');
  s = core.rename(s, 3, '   ');
  assert.deepEqual(core.eligibleIndices(s), [0, 2, 4]);
});

test('a single named spot can still win, even as the last pick', () => {
  let s = core.createInitialState();
  [0, 1, 2, 3].forEach((i) => { s = core.rename(s, i, ''); });
  s = { ...s, lastPickId: s.spots[4].id };
  assert.equal(core.canSpin(s), true);
  assert.equal(core.pick(s), 4);
});

test('nothing named means nothing to spin', () => {
  let s = core.createInitialState();
  [0, 1, 2, 3, 4].forEach((i) => { s = core.rename(s, i, ''); });
  assert.equal(core.canSpin(s), false);
  assert.equal(core.pick(s), null);
});

test('renaming a sitting-out spot releases it', () => {
  let s = core.recordPick(core.createInitialState(), 2);
  s = core.rename(s, 2, 'Lighthouse');
  assert.equal(s.lastPickId, null);
  assert.deepEqual(core.eligibleIndices(s), [0, 1, 2, 3, 4]);
});

test('renaming a different spot leaves the exclusion alone', () => {
  let s = core.recordPick(core.createInitialState(), 2);
  s = core.rename(s, 0, 'Lighthouse');
  assert.equal(core.isSittingOut(s, 2), true);
  assert.equal(s.seeded, false);
});

test('names are capped and no-op renames change nothing', () => {
  const s = core.createInitialState();
  const long = core.rename(s, 0, 'x'.repeat(200));
  assert.equal(long.spots[0].name.length, core.MAX_NAME_LENGTH);
  assert.equal(core.rename(s, 0, s.spots[0].name), s);
});

test('hydrate repairs junk and keeps good saves', () => {
  assert.deepEqual(core.hydrate(null).spots.length, 5);
  assert.deepEqual(core.hydrate({ version: 99 }).lastPickId, null);
  assert.equal(core.hydrate({ version: 1, spots: 'nope' }).seeded, true);
  assert.equal(core.hydrate({ version: 1, spots: [], lastPickId: 'ghost' }).lastPickId, null);

  let saved = core.rename(core.createInitialState(), 0, 'Lighthouse');
  saved = core.recordPick(saved, 1);
  const back = core.hydrate(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(back, saved);
});

test('storage failures never break the app', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const store = core.createStore(broken);
  assert.equal(store.load().spots.length, 5);
  assert.equal(store.save(core.createInitialState()), false);
});

test('a spin always turns forwards and parks the winner on the pointer', () => {
  for (let i = 0; i < core.SPOT_COUNT; i++) {
    for (let t = 0; t < 60; t++) {
      const from = Math.random() * 720 - 360;
      const to = core.spinTarget(from, i, Math.random, 5);
      assert.ok(to > from, 'wheel must not spin backwards');
      assert.ok(to - from >= 5 * 360, 'wheel must complete its full turns');

      // the wedge under the pointer at the resting angle must be the winner
      const resting = (((-to % 360) + 360) % 360);
      const landed = Math.floor(resting / core.WEDGE_ANGLE) % core.SPOT_COUNT;
      assert.equal(landed, i);
    }
  }
});

console.log('\n' + passed + ' checks passed');
