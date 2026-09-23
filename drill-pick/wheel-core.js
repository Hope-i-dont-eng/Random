/**
 * Drill Pick — core rules.
 *
 * Pure data and logic: no DOM, no browser globals, no imports. A React Native
 * shell can import this file unchanged; only the renderer and the storage
 * backend differ between platforms.
 *
 * Two layers:
 *   - spots:  the named projects, in legend order. `settings.count` of them are
 *             on the wheel; the rest are kept (names and all) for when the
 *             wheel grows again.
 *   - wedges: what is actually drawn and landed on. Built from the spots plus
 *             the options — a doubled name gets a second wedge, and "Spin
 *             again" spaces get wedges of their own. See `buildWheel`.
 */

export const SCHEMA_VERSION = 3;
export const MAX_NAME_LENGTH = 40;
// Keep the existing storage key so upgrading does not lose names or last pick.
export const STORAGE_KEY = 'drillpick.v1';

/**
 * The wheel spots, in legend order. Each carries a legend symbol and a DMC
 * code the way a real diamond painting canvas identifies its drill colours, so
 * a spot stays recognisable even when its wedge is too narrow for the name.
 * The length of this list is the most spots the wheel can hold.
 */
export const LEGEND = [
  { symbol: '◆', dmc: '333',  color: '#7B4BC4', shade: 'Amethyst' },
  { symbol: '▲', dmc: '3812', color: '#1E8F8A', shade: 'Sea Teal' },
  { symbol: '●', dmc: '3805', color: '#D6456E', shade: 'Cyclamen' },
  { symbol: '■', dmc: '783',  color: '#E2A32B', shade: 'Topaz' },
  { symbol: '✦', dmc: '796',  color: '#2F5FD0', shade: 'Royal Blue' },
  { symbol: '★', dmc: '702',  color: '#3E9B44', shade: 'Kelly Green' },
  { symbol: '♥', dmc: '321',  color: '#B8202F', shade: 'Christmas Red' },
  { symbol: '✚', dmc: '3843', color: '#1A9BD1', shade: 'Electric Blue' },
  { symbol: '◐', dmc: '947',  color: '#E0621C', shade: 'Burnt Orange' },
  { symbol: '♣', dmc: '915',  color: '#8A1F5E', shade: 'Dark Plum' },
  { symbol: '▼', dmc: '3371', color: '#5A4032', shade: 'Black Brown' },
  { symbol: '✿', dmc: '581',  color: '#86922A', shade: 'Moss Green' },
];

/** The "Spin again" space: one fixed look in both themes, like a drill colour. */
export const AGAIN = { symbol: '↻', color: '#2B2340', label: 'Spin again' };

export const MAX_SPOTS = LEGEND.length;
export const MIN_SPOTS = 2;
export const DEFAULT_COUNT = 6;
export const MAX_DOUBLES = 3;
export const MAX_AGAIN = 3;
/** How many recent winners are remembered (enough for the "last 2" mode). */
const HISTORY_LENGTH = 3;

/** @deprecated kept for older callers; the wheel size is now `settings.count`. */
export const SPOT_COUNT = MAX_SPOTS;

export const SKIP_MODES = [
  { value: 'round', label: 'Until everyone has had a turn' },
  { value: 'last1', label: 'Just the last pick' },
  { value: 'last2', label: 'The last 2 picks' },
];

/** Placeholder projects shown on a first run, replaced as soon as one is renamed. */
export const STARTER_NAMES = [
  'Moonlit Wolf',
  'Sunflower Mandala',
  'Koi Pond',
  'Stained Glass Owl',
  'Aurora Cabin',
  'Hummingbird',
];

const SPOT_IDS = LEGEND.map((_, i) => 's' + (i + 1));

export function defaultSettings() {
  return {
    count: DEFAULT_COUNT,
    // On by default: this is the behaviour the app has always had.
    skip: { on: true, mode: 'round' },
    double: { on: false, ids: [''] },
    again: { on: false, count: 1 },
  };
}

export function createInitialState() {
  return {
    version: SCHEMA_VERSION,
    seeded: true,
    spots: SPOT_IDS.map((id, i) => ({ id, name: STARTER_NAMES[i] || '' })),
    settings: defaultSettings(),
    // Most recent winner first. Spin-again landings are not winners.
    history: [],
    // Unused wedge keys in the current round (skip mode "round"). Empty = new round.
    remainingKeys: [],
  };
}

/* ---------- small helpers ---------- */

const isNamed = (spot) => Boolean(spot && spot.name.trim() !== '');
const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** The spots currently on the wheel, in legend order. */
export function activeSpots(state) {
  return state.spots.slice(0, state.settings.count);
}

/** The id of the most recent winner, or null. */
export function lastPickId(state) {
  return state.history.length ? state.history[0] : null;
}

/** Legend row of the last winner, or -1 when there is none on the wheel. */
export function lastPickIndex(state) {
  const id = lastPickId(state);
  if (!id) return -1;
  return activeSpots(state).findIndex((s) => s.id === id);
}

/** Named spot ids that get a second wedge, in the order they were chosen. */
export function doubledIds(state) {
  const { double } = state.settings;
  if (!double.on) return [];
  const named = new Set(activeSpots(state).filter(isNamed).map((s) => s.id));
  const out = [];
  for (const id of double.ids) {
    if (named.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export function againCount(state) {
  return state.settings.again.on ? state.settings.again.count : 0;
}

/* ---------- the wheel ---------- */

/**
 * The wedges in wheel order, clockwise from 12 o'clock. Each is either
 *   { kind: 'spot', key, id, index }   index = legend row, for colour and name
 *   { kind: 'again', key }
 * Extra wedges (second copies, spin-again spaces) are placed as far as possible
 * from their twins, so a doubled name sits across the wheel from itself and two
 * spin-again spaces never touch. The layout is deterministic, so it only moves
 * when the names, their order or the options change.
 */
export function buildWheel(state) {
  const wedges = activeSpots(state).map((spot, index) => ({
    kind: 'spot', key: spot.id, id: spot.id, index,
  }));

  const extras = [];
  for (const id of doubledIds(state)) {
    const index = wedges.findIndex((w) => w.id === id);
    extras.push({ kind: 'spot', key: id + '~2', id, index });
  }
  for (let k = 1; k <= againCount(state); k++) {
    extras.push({ kind: 'again', key: 'again' + k });
  }

  const group = (w) => (w.kind === 'again' ? '~again' : w.id);
  const isExtra = (w) => w.kind === 'again' || w.key.endsWith('~2');

  for (const extra of extras) {
    let best = 0;
    let bestScore = [-1, -1];
    for (let gap = 0; gap <= wedges.length; gap++) {
      const trial = wedges.slice(0, gap).concat(extra, wedges.slice(gap));
      const m = trial.length;
      let twin = Infinity;
      let spread = Infinity;
      trial.forEach((w, q) => {
        if (q === gap) return;
        const d = Math.min(Math.abs(q - gap), m - Math.abs(q - gap));
        if (group(w) === group(extra)) twin = Math.min(twin, d);
        if (isExtra(w)) spread = Math.min(spread, d);
      });
      // Distance from its twin first, then from the other extras.
      const score = [twin === Infinity ? m : twin, spread === Infinity ? m : spread];
      if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
        best = gap;
        bestScore = score;
      }
    }
    wedges.splice(best, 0, extra);
  }
  return wedges;
}

/**
 * Ids the skip rule is holding back this spin. Never holds back so much that
 * nothing named is left to win.
 */
function excludedIds(state, namedIds) {
  const { skip } = state.settings;
  if (!skip.on || namedIds.length <= 1) return new Set();
  const depth = skip.mode === 'last2' ? 2 : 1;
  const recent = state.history.filter((id) => namedIds.includes(id));
  for (let d = depth; d >= 1; d--) {
    const out = new Set(recent.slice(0, d));
    if (namedIds.some((id) => !out.has(id))) return out;
  }
  return new Set();
}

/**
 * Wheel positions of the name wedges that can win this spin.
 *
 * Skip off: every named wedge. A doubled name has two wedges, so twice the chance.
 * "last1"/"last2": every named wedge except the most recent winner(s).
 * "round": every wedge is used once per round, in random order — a doubled
 *   name gets two turns a round. The last winner still sits out the next spin,
 *   including across the round boundary.
 */
export function eligibleWedges(state, wheel = buildWheel(state)) {
  const named = [];
  wheel.forEach((w, pos) => {
    if (w.kind === 'spot' && isNamed(state.spots.find((s) => s.id === w.id))) named.push(pos);
  });
  if (!named.length) return [];

  const namedIds = [...new Set(named.map((pos) => wheel[pos].id))];
  const out = excludedIds(state, namedIds);
  const allowed = named.filter((pos) => !out.has(wheel[pos].id));

  if (state.settings.skip.on && state.settings.skip.mode === 'round' && state.remainingKeys.length) {
    const bag = new Set(state.remainingKeys);
    const inBag = allowed.filter((pos) => bag.has(wheel[pos].key));
    if (inBag.length) return inBag;
    // Only the last winner's second wedge is left: close the round early.
  }
  return allowed;
}

/** Every wedge the pointer may stop on: eligible names plus spin-again spaces. */
export function spinPool(state, wheel = buildWheel(state)) {
  const names = eligibleWedges(state, wheel);
  if (!names.length) return [];
  const again = [];
  wheel.forEach((w, pos) => { if (w.kind === 'again') again.push(pos); });
  return names.concat(again).sort((a, b) => a - b);
}

/** True for a named wedge that cannot win this spin. */
export function isWedgeOut(state, pos, wheel = buildWheel(state)) {
  const w = wheel[pos];
  if (!w || w.kind !== 'spot') return false;
  if (!isNamed(state.spots.find((s) => s.id === w.id))) return false;
  return !eligibleWedges(state, wheel).includes(pos);
}

/** True for a named legend row none of whose wedges can win this spin. */
export function isSittingOut(state, index) {
  const spot = activeSpots(state)[index];
  if (!isNamed(spot)) return false;
  const wheel = buildWheel(state);
  const eligible = new Set(eligibleWedges(state, wheel).map((pos) => wheel[pos].id));
  return !eligible.has(spot.id);
}

/** Names currently allowed to win, as legend rows (compat with older callers). */
export function eligibleIndices(state) {
  const wheel = buildWheel(state);
  const ids = new Set(eligibleWedges(state, wheel).map((pos) => wheel[pos].id));
  const out = [];
  activeSpots(state).forEach((s, i) => { if (ids.has(s.id)) out.push(i); });
  return out;
}

export function canSpin(state) {
  return eligibleWedges(state).length > 0;
}

/** Choose a wheel position uniformly from the spin pool. */
export function pick(state, rng = Math.random) {
  const pool = spinPool(state);
  if (!pool.length) return null;
  const roll = Math.floor(rng() * pool.length);
  return pool[Math.min(Math.max(roll, 0), pool.length - 1)];
}

/** Record where the wheel stopped. A spin-again space changes nothing. */
export function recordPick(state, pos, wheel = buildWheel(state)) {
  const w = wheel[pos];
  if (!w || w.kind !== 'spot') return state;

  const history = [w.id, ...state.history.filter((id) => id !== w.id)].slice(0, HISTORY_LENGTH);
  let remainingKeys = [];
  const { skip } = state.settings;
  if (skip.on && skip.mode === 'round') {
    if (state.remainingKeys.includes(w.key)) {
      remainingKeys = state.remainingKeys.filter((k) => k !== w.key);
    } else {
      // A fresh round: every named wedge except the one that just won.
      remainingKeys = wheel
        .filter((x) => x.kind === 'spot' && x.key !== w.key &&
          isNamed(state.spots.find((s) => s.id === x.id)))
        .map((x) => x.key);
    }
  }
  return { ...state, history, remainingKeys };
}

/**
 * Editing a name changes the set of projects, so it starts a fresh round.
 * A renamed spot is a new project, so it stops sitting out.
 */
export function rename(state, index, name) {
  const clean = String(name).slice(0, MAX_NAME_LENGTH);
  const target = state.spots[index];
  if (!target || target.name === clean) return state;
  const spots = state.spots.map((s, i) => (i === index ? { ...s, name: clean } : s));
  return {
    ...state,
    spots,
    seeded: false,
    history: state.history.filter((id) => id !== target.id),
    remainingKeys: [],
  };
}

/**
 * Shuffle the names on the wheel into a new order. Winners, the round in
 * progress and doubles all follow their names, so nothing is lost; only the
 * colours and positions change.
 */
export function shuffle(state, rng = Math.random) {
  const count = state.settings.count;
  const head = state.spots.slice(0, count);
  const tail = state.spots.slice(count);
  const before = head.map((s) => s.id).join();
  let next = head;
  // Keep trying for an order that actually looks different.
  for (let attempt = 0; attempt < 12; attempt++) {
    next = head.slice();
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    if (next.map((s) => s.id).join() !== before) break;
  }
  return { ...state, spots: next.concat(tail) };
}

/**
 * Change options. Accepts a partial patch:
 *   { count }, { skip: { on, mode } }, { double: { on, ids } }, { again: { on, count } }
 * Anything that changes which wedges exist starts a fresh round.
 */
export function updateSettings(state, patch) {
  const merged = {
    ...state.settings,
    ...('count' in patch ? { count: patch.count } : {}),
    skip: { ...state.settings.skip, ...(patch.skip || {}) },
    double: { ...state.settings.double, ...(patch.double || {}) },
    again: { ...state.settings.again, ...(patch.again || {}) },
  };
  const settings = cleanSettings(merged);
  if (JSON.stringify(settings) === JSON.stringify(state.settings)) return state;
  const onlyAgain =
    JSON.stringify({ ...settings, again: null }) === JSON.stringify({ ...state.settings, again: null });
  return { ...state, settings, remainingKeys: onlyAgain ? state.remainingKeys : [] };
}

function cleanSettings(raw) {
  const base = defaultSettings();
  const s = raw && typeof raw === 'object' ? raw : {};
  const skip = s.skip && typeof s.skip === 'object' ? s.skip : {};
  const double = s.double && typeof s.double === 'object' ? s.double : {};
  const again = s.again && typeof s.again === 'object' ? s.again : {};

  let ids = Array.isArray(double.ids) ? double.ids.slice(0, MAX_DOUBLES) : base.double.ids;
  ids = ids.map((id) => (SPOT_IDS.includes(id) ? id : ''));
  if (!ids.length) ids = [''];

  return {
    count: clampInt(s.count, MIN_SPOTS, MAX_SPOTS, base.count),
    skip: {
      on: typeof skip.on === 'boolean' ? skip.on : base.skip.on,
      mode: SKIP_MODES.some((m) => m.value === skip.mode) ? skip.mode : base.skip.mode,
    },
    double: { on: double.on === true, ids },
    again: { on: again.on === true, count: clampInt(again.count, 1, MAX_AGAIN, 1) },
  };
}

/** Rebuild a trustworthy state from any saved schema. */
export function hydrate(raw) {
  const base = createInitialState();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.spots)) return base;
  if (![1, 2, SCHEMA_VERSION].includes(raw.version)) return base;
  const nameOf = (saved) =>
    saved && typeof saved.name === 'string' ? saved.name.slice(0, MAX_NAME_LENGTH) : '';

  let spots;
  let settings;
  let history;
  let remainingKeys = [];

  if (raw.version === SCHEMA_VERSION) {
    // Order can be shuffled, so trust saved ids, then append any that are missing.
    spots = [];
    for (const saved of raw.spots) {
      if (saved && SPOT_IDS.includes(saved.id) && !spots.some((s) => s.id === saved.id)) {
        spots.push({ id: saved.id, name: nameOf(saved) });
      }
    }
    for (const id of SPOT_IDS) {
      if (!spots.some((s) => s.id === id)) spots.push({ id, name: '' });
    }
    settings = cleanSettings(raw.settings);
    history = [];
    for (const id of Array.isArray(raw.history) ? raw.history : []) {
      if (SPOT_IDS.includes(id) && !history.includes(id)) history.push(id);
    }
    history = history.slice(0, HISTORY_LENGTH);
    const named = new Set(spots.filter(isNamed).map((s) => s.id));
    for (const key of Array.isArray(raw.remainingKeys) ? raw.remainingKeys : []) {
      if (typeof key !== 'string') continue;
      const id = key.replace(/~2$/, '');
      if (named.has(id) && !remainingKeys.includes(key)) remainingKeys.push(key);
    }
  } else {
    // v1/v2: names by position, six-spot wheel, rounds on.
    spots = SPOT_IDS.map((id, i) => ({ id, name: nameOf(raw.spots[i]) }));
    settings = defaultSettings();
    if (raw.spots.length > DEFAULT_COUNT) settings.count = Math.min(raw.spots.length, MAX_SPOTS);
    const last = SPOT_IDS.includes(raw.lastPickId) ? raw.lastPickId : null;
    history = last ? [last] : [];
    const named = new Set(spots.filter(isNamed).map((s) => s.id));
    if (raw.version === 2 && Array.isArray(raw.remainingIds)) {
      for (const id of raw.remainingIds) {
        if (named.has(id) && id !== last && !remainingKeys.includes(id)) remainingKeys.push(id);
      }
    }
  }

  return { version: SCHEMA_VERSION, seeded: raw.seeded === true, spots, settings, history, remainingKeys };
}

/**
 * Persistence port. `backend` needs getItem/setItem — localStorage on the web,
 * anything key/value shaped elsewhere. Storage failures never break the app.
 */
export function createStore(backend, key = STORAGE_KEY) {
  return {
    load() {
      try {
        const raw = backend.getItem(key);
        return hydrate(raw ? JSON.parse(raw) : null);
      } catch (err) {
        return createInitialState();
      }
    },
    save(state) {
      try {
        backend.setItem(key, JSON.stringify(state));
        return true;
      } catch (err) {
        return false;
      }
    },
  };
}

/* ---- Wheel geometry: shared by any renderer ---- */

export function wedgeAngle(total) {
  return 360 / total;
}

/** Degrees clockwise from the pointer at 12 o'clock to the middle of a wedge. */
export function wedgeCenterAngle(pos, total) {
  const a = wedgeAngle(total);
  return pos * a + a / 2;
}

/**
 * Absolute rotation that parks wedge `pos` (of `total`) under the pointer,
 * always turning forwards and landing off-centre so repeat wins don't look
 * identical.
 */
export function spinTarget(currentRotation, pos, total, rng = Math.random, turns = 5) {
  const a = wedgeAngle(total);
  const spread = Math.max(0, a / 2 - Math.min(8, a * 0.2));
  const jitter = (rng() * 2 - 1) * spread;
  const want = -(wedgeCenterAngle(pos, total) + jitter);
  let delta = (want - currentRotation) % 360;
  if (delta < 0) delta += 360;
  return currentRotation + delta + 360 * turns;
}
