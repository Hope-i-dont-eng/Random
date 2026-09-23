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

const COUNT = core.DEFAULT_COUNT;
const ALL = Array.from({ length: COUNT }, (_, i) => i);

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const idAt = (state, pos) => core.buildWheel(state)[pos].id;
const posOf = (state, id) => core.buildWheel(state).findIndex((w) => w.id === id);

test('starts with six named spots in play and every option at its default', () => {
  const s = core.createInitialState();
  assert.equal(core.activeSpots(s).length, COUNT);
  assert.equal(s.spots.length, core.MAX_SPOTS);
  assert.deepEqual(core.eligibleIndices(s), ALL);
  assert.equal(core.buildWheel(s).length, COUNT);
  assert.equal(core.canSpin(s), true);
  assert.deepEqual(s.settings, core.defaultSettings());
  assert.equal(core.activeSpots(s).every((spot) => spot.name.trim() !== ''), true);
});

test('the legend has no duplicate colours, symbols or codes', () => {
  for (const key of ['color', 'symbol', 'dmc']) {
    const values = core.LEGEND.map((entry) => entry[key]);
    assert.equal(new Set(values).size, values.length, 'duplicate ' + key);
  }
});

test('the last pick sits out the next spin', () => {
  const s = core.recordPick(core.createInitialState(), 2);
  assert.equal(core.isSittingOut(s, 2), true);
  for (let i = 0; i < 400; i++) assert.notEqual(core.pick(s), 2);
});

test('skip off: the last pick can win again', () => {
  let s = core.updateSettings(core.createInitialState(), { skip: { on: false } });
  s = core.recordPick(s, 2);
  assert.equal(core.isSittingOut(s, 2), false);
  assert.deepEqual(core.eligibleIndices(s), ALL);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(core.pick(s));
  assert.equal(seen.has(2), true);
});

test('skip "last 2 picks" holds back the two most recent winners', () => {
  let s = core.updateSettings(core.createInitialState(), { skip: { mode: 'last2' } });
  s = core.recordPick(s, 1);
  s = core.recordPick(s, 4);
  assert.deepEqual(core.eligibleIndices(s), [0, 2, 3, 5]);
  for (let i = 0; i < 400; i++) assert.ok(![1, 4].includes(core.pick(s)));
});

test('skip "last 2" with only two names falls back to skipping one', () => {
  let s = core.updateSettings(core.createInitialState(), { count: 2, skip: { mode: 'last2' } });
  s = core.recordPick(s, 0);
  s = core.recordPick(s, 1);
  assert.deepEqual(core.eligibleIndices(s), [0]);
});

test('the number of choices grows and shrinks, keeping hidden names', () => {
  let s = core.updateSettings(core.createInitialState(), { count: 9 });
  assert.equal(core.buildWheel(s).length, 9);
  assert.equal(core.activeSpots(s)[8].name, '', 'a new spot must not invent a name');
  s = core.rename(s, 8, 'Tiger Lily');
  s = core.updateSettings(s, { count: 3 });
  assert.equal(core.buildWheel(s).length, 3);
  assert.deepEqual(core.eligibleIndices(s), [0, 1, 2]);
  s = core.updateSettings(s, { count: 9 });
  assert.equal(core.activeSpots(s)[8].name, 'Tiger Lily');
  assert.equal(core.updateSettings(s, { count: 99 }).settings.count, core.MAX_SPOTS);
  assert.equal(core.updateSettings(s, { count: 0 }).settings.count, core.MIN_SPOTS);
});

test('a doubled name gets two wedges, spread apart, and about twice the wins', () => {
  let s = core.updateSettings(core.createInitialState(), {
    skip: { on: false },
    double: { on: true, ids: ['s3'] },
  });
  const wheel = core.buildWheel(s);
  assert.equal(wheel.length, COUNT + 1);
  const twins = wheel.map((w, p) => (w.id === 's3' ? p : -1)).filter((p) => p >= 0);
  assert.equal(twins.length, 2);
  const gap = Math.abs(twins[0] - twins[1]);
  assert.ok(Math.min(gap, wheel.length - gap) >= 3, 'twins should sit across the wheel');

  const rng = seeded(7);
  const wins = {};
  for (let i = 0; i < 14000; i++) {
    const id = wheel[core.pick(s, rng)].id;
    wins[id] = (wins[id] || 0) + 1;
  }
  const ratio = wins.s3 / wins.s1;
  assert.ok(ratio > 1.8 && ratio < 2.2, 'doubled odds, got ' + ratio.toFixed(2));
});

test('up to three names can be doubled; blanks and repeats are ignored', () => {
  let s = core.rename(core.createInitialState(), 4, '');
  s = core.updateSettings(s, { double: { on: true, ids: ['s1', 's1', 's5', 'nope', 's2'] } });
  assert.equal(s.settings.double.ids.length, core.MAX_DOUBLES);
  assert.deepEqual(core.doubledIds(s), ['s1']);
  s = core.updateSettings(s, { double: { ids: ['s1', 's2', 's3'] } });
  assert.deepEqual(core.doubledIds(s), ['s1', 's2', 's3']);
  assert.equal(core.buildWheel(s).length, COUNT + 3);
  s = core.updateSettings(s, { double: { on: false } });
  assert.equal(core.buildWheel(s).length, COUNT);
  assert.deepEqual(s.settings.double.ids, ['s1', 's2', 's3'], 'choices are kept while switched off');
});

test('spin again spaces are wedges that land without counting as a pick', () => {
  let s = core.updateSettings(core.createInitialState(), { again: { on: true, count: 2 } });
  const wheel = core.buildWheel(s);
  const again = wheel.map((w, p) => (w.kind === 'again' ? p : -1)).filter((p) => p >= 0);
  assert.equal(again.length, 2);
  const gap = Math.abs(again[0] - again[1]);
  assert.ok(Math.min(gap, wheel.length - gap) > 1, 'spin again spaces never touch');
  assert.equal(core.spinPool(s).length, COUNT + 2);

  s = core.recordPick(s, 0);
  const after = core.recordPick(s, again[0]);
  assert.equal(after, s, 'landing on spin again changes nothing');

  const seen = new Set();
  const rng = seeded(3);
  for (let i = 0; i < 3000; i++) seen.add(wheel[core.pick(s, rng)].kind);
  assert.deepEqual([...seen].sort(), ['again', 'spot']);
});

test('spin again alone is never enough to spin', () => {
  let s = core.createInitialState();
  for (let i = 0; i < COUNT; i++) s = core.rename(s, i, '');
  s = core.updateSettings(s, { again: { on: true, count: 3 } });
  assert.equal(core.canSpin(s), false);
  assert.equal(core.pick(s), null);
});

test('shuffle reorders names but winners follow their names', () => {
  let s = core.recordPick(core.createInitialState(), 2);
  const winner = s.history[0];
  const before = core.activeSpots(s).map((x) => x.name).join();
  s = core.shuffle(s, seeded(11));
  assert.notEqual(core.activeSpots(s).map((x) => x.name).join(), before);
  assert.deepEqual(core.activeSpots(s).map((x) => x.name).sort(),
    core.activeSpots(core.createInitialState()).map((x) => x.name).sort());
  const idx = core.activeSpots(s).findIndex((x) => x.id === winner);
  assert.equal(core.isSittingOut(s, idx), true);
  assert.equal(core.lastPickIndex(s), idx);
});

test('shuffle only touches the spots on the wheel', () => {
  let s = core.updateSettings(core.createInitialState(), { count: 4 });
  const hidden = s.spots.slice(4).map((x) => x.id).join();
  for (let i = 0; i < 20; i++) s = core.shuffle(s);
  assert.equal(s.spots.slice(4).map((x) => x.id).join(), hidden);
});

test('pick never falls off the end of the pool', () => {
  const s = core.createInitialState();
  assert.equal(core.pick(s, () => 0.999999999), COUNT - 1);
  assert.equal(core.pick(s, () => 0), 0);
});

test('blank spots are skipped', () => {
  let s = core.createInitialState();
  s = core.rename(s, 1, '');
  s = core.rename(s, 3, '   ');
  assert.deepEqual(core.eligibleIndices(s), ALL.filter((i) => i !== 1 && i !== 3));
});

test('a single named spot can still win, even as the last pick', () => {
  const last = COUNT - 1;
  let s = core.createInitialState();
  ALL.filter((i) => i !== last).forEach((i) => { s = core.rename(s, i, ''); });
  s = { ...s, history: [s.spots[last].id] };
  assert.equal(core.canSpin(s), true);
  assert.equal(core.pick(s), last);
});

test('renaming a sitting-out spot releases it', () => {
  let s = core.recordPick(core.createInitialState(), 2);
  s = core.rename(s, 2, 'Lighthouse');
  assert.equal(core.lastPickId(s), null);
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
  assert.equal(core.updateSettings(s, { count: COUNT }), s);
});

test('a v1 save from a five-wedge wheel keeps its names and last pick', () => {
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
  assert.equal(next.settings.count, COUNT);
  old.spots.forEach((spot, i) => assert.equal(next.spots[i].name, spot.name));
  assert.equal(next.spots[5].name, '', 'a new spot must not invent a name');
  assert.equal(core.lastPickId(next), 's3');
  assert.equal(core.isSittingOut(next, 2), true);
});

test('hydrate repairs junk and round-trips good saves', () => {
  assert.equal(core.hydrate(null).spots.length, core.MAX_SPOTS);
  assert.deepEqual(core.hydrate({ version: 99 }).history, []);
  assert.equal(core.hydrate({ version: 1, spots: 'nope' }).seeded, true);
  assert.deepEqual(core.hydrate({ version: 1, spots: [], lastPickId: 'ghost' }).history, []);

  const junk = core.hydrate({
    version: core.SCHEMA_VERSION,
    spots: [{ id: 's2', name: 'B' }, { id: 's2', name: 'dup' }, { id: 'x', name: 'bad' }, null],
    settings: { count: 'lots', skip: { on: 'yes', mode: 'forever' }, again: { on: true, count: 40 } },
    history: ['s2', 'ghost', 's2'],
    remainingKeys: ['s2~2', 's2~2', 's9', 7],
  });
  assert.equal(junk.spots.length, core.MAX_SPOTS);
  assert.equal(new Set(junk.spots.map((s) => s.id)).size, core.MAX_SPOTS);
  assert.equal(junk.spots[0].name, 'B');
  assert.equal(junk.settings.count, COUNT);
  assert.deepEqual(junk.settings.skip, { on: true, mode: 'round' });
  assert.equal(junk.settings.again.count, core.MAX_AGAIN);
  assert.deepEqual(junk.history, ['s2']);
  assert.deepEqual(junk.remainingKeys, ['s2~2']);

  let saved = core.rename(core.createInitialState(), 0, 'Lighthouse');
  saved = core.updateSettings(saved, { count: 8, double: { on: true, ids: ['s2'] }, again: { on: true, count: 2 } });
  saved = core.shuffle(saved, seeded(5));
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
  assert.equal(store.load().spots.length, core.MAX_SPOTS);
  assert.equal(store.save(core.createInitialState()), false);
});

test('a spin always turns forwards and parks the winner on the pointer, at every wheel size', () => {
  for (let total = 2; total <= core.MAX_SPOTS + core.MAX_DOUBLES + core.MAX_AGAIN; total++) {
    const angle = core.wedgeAngle(total);
    for (let pos = 0; pos < total; pos++) {
      for (let t = 0; t < 30; t++) {
        const from = Math.random() * 720 - 360;
        const to = core.spinTarget(from, pos, total, Math.random, 5);
        assert.ok(to > from, 'wheel must not spin backwards');
        assert.ok(to - from >= 5 * 360, 'wheel must complete its full turns');
        const resting = ((-to % 360) + 360) % 360;
        assert.equal(Math.floor(resting / angle) % total, pos);
      }
    }
  }
});

console.log('\n' + passed + ' checks passed');
