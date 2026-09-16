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

const ALL = core.LEGEND.map((_, i) => i);

test('starts with every spot in play', () => {
  const s = core.createInitialState();
  assert.equal(core.SPOT_COUNT, core.LEGEND.length);
  assert.equal(s.spots.length, core.SPOT_COUNT);
  assert.deepEqual(core.eligibleIndices(s), ALL);
  assert.equal(core.canSpin(s), true);
  assert.equal(s.spots.every((spot) => spot.name.trim() !== ''), true, 'every spot needs a starter');
});

test('the legend has no duplicate colours, symbols or codes', () => {
  for (const key of ['color', 'symbol', 'dmc']) {
    const values = core.LEGEND.map((entry) => entry[key]);
    assert.equal(new Set(values).size, values.length, 'duplicate ' + key);
  }
});

test('the last pick sits out the next spin', () => {
  let s = core.recordPick(core.createInitialState(), 2);
  assert.deepEqual(core.eligibleIndices(s), ALL.filter((i) => i !== 2));
  assert.equal(core.isSittingOut(s, 2), true);
  for (let i = 0; i < 400; i++) assert.notEqual(core.pick(s), 2);
});

test('every other spot stays reachable', () => {
  const s = core.recordPick(core.createInitialState(), 0);
  const seen = new Set();
  for (let i = 0; i < 4000; i++) seen.add(core.pick(s));
  assert.deepEqual([...seen].sort((a, b) => a - b), ALL.filter((i) => i !== 0));
});

test('pick never falls off the end of the pool', () => {
  const s = core.createInitialState();
  assert.equal(core.pick(s, () => 0.999999999), core.SPOT_COUNT - 1);
  assert.equal(core.pick(s, () => 0), 0);
});

test('blank spots are skipped', () => {
  let s = core.createInitialState();
  s = core.rename(s, 1, '');
  s = core.rename(s, 3, '   ');
  assert.deepEqual(core.eligibleIndices(s), ALL.filter((i) => i !== 1 && i !== 3));
});

test('a single named spot can still win, even as the last pick', () => {
  const last = core.SPOT_COUNT - 1;
  let s = core.createInitialState();
  ALL.filter((i) => i !== last).forEach((i) => { s = core.rename(s, i, ''); });
  s = { ...s, lastPickId: s.spots[last].id };
  assert.equal(core.canSpin(s), true);
  assert.equal(core.pick(s), last);
});

test('nothing named means nothing to spin', () => {
  let s = core.createInitialState();
  ALL.forEach((i) => { s = core.rename(s, i, ''); });
  assert.equal(core.canSpin(s), false);
  assert.equal(core.pick(s), null);
});

test('renaming a sitting-out spot releases it', () => {
  let s = core.recordPick(core.createInitialState(), 2);
  s = core.rename(s, 2, 'Lighthouse');
  assert.equal(s.lastPickId, null);
  assert.deepEqual(core.eligibleIndices(s), ALL);
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

test('a save from a smaller wheel keeps its names and leaves new spots empty', () => {
  // what an existing phone has stored from the five-wedge version
  const old = {
    version: 1,
    seeded: false,
    spots: [
      { id: 's1', name: 'Moonlit Wolf' },
      { id: 's2', name: 'Harbour Lights' },
      { id: 's3', name: 'Koi Pond' },
      { id: 's4', name: 'Stained Glass Owl' },
      { id: 's5', name: 'Aurora Cabin' },
    ],
    lastPickId: 's3',
  };
  const next = core.hydrate(old);
  assert.equal(next.spots.length, core.SPOT_COUNT);
  old.spots.forEach((spot, i) => assert.equal(next.spots[i].name, spot.name));
  for (let i = old.spots.length; i < core.SPOT_COUNT; i++) {
    assert.equal(next.spots[i].name, '', 'a new spot must not invent a name');
  }
  assert.equal(next.lastPickId, 's3', 'the sitting-out spot survives the upgrade');
  assert.equal(core.isSittingOut(next, 2), true);
});

test('hydrate repairs junk and keeps good saves', () => {
  assert.deepEqual(core.hydrate(null).spots.length, core.SPOT_COUNT);
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
  assert.equal(store.load().spots.length, core.SPOT_COUNT);
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
