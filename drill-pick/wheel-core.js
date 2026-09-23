/**
 * Drill Pick — core rules.
 *
 * Pure data and logic: no DOM, no browser globals, no imports. A React Native
 * shell can import this file unchanged; only the renderer and the storage
 * backend differ between platforms.
 */

export const SCHEMA_VERSION = 2;
export const MAX_NAME_LENGTH = 40;
// Keep the existing storage key so upgrading does not lose names or last pick.
export const STORAGE_KEY = 'drillpick.v1';

/**
 * The six wheel spots, in wheel order. Each carries a legend symbol and a DMC
 * code the way a real diamond painting canvas identifies its drill colours, so
 * a spot stays recognisable even when its wedge is too narrow for the name.
 */
export const LEGEND = [
  { symbol: '◆', dmc: '333',  color: '#7B4BC4', shade: 'Amethyst' },
  { symbol: '▲', dmc: '3812', color: '#1E8F8A', shade: 'Sea Teal' },
  { symbol: '●', dmc: '3805', color: '#D6456E', shade: 'Cyclamen' },
  { symbol: '■', dmc: '783',  color: '#E2A32B', shade: 'Topaz' },
  { symbol: '✦', dmc: '796',  color: '#2F5FD0', shade: 'Royal Blue' },
  { symbol: '★', dmc: '702',  color: '#3E9B44', shade: 'Kelly Green' },
];

/** The wheel takes its size from the legend, so adding an entry adds a wedge. */
export const SPOT_COUNT = LEGEND.length;

/** Placeholder projects shown on a first run, replaced as soon as one is renamed. */
export const STARTER_NAMES = [
  'Moonlit Wolf',
  'Sunflower Mandala',
  'Koi Pond',
  'Stained Glass Owl',
  'Aurora Cabin',
  'Hummingbird',
];

export function createInitialState() {
  return {
    version: SCHEMA_VERSION,
    seeded: true,
    spots: LEGEND.map((_, i) => ({ id: 's' + (i + 1), name: STARTER_NAMES[i] || '' })),
    lastPickId: null,
    // Unpicked project IDs in the current round. An empty bag starts a new round.
    remainingIds: [],
  };
}

/**
 * Every named project is picked once per round, in random order. During a round,
 * only projects remaining in the bag can win. At a round boundary, the previous
 * winner is excluded from the FIRST draw, but goes back into the new bag after
 * that draw so all named projects still get one turn in the new round.
 */
export function eligibleIndices(state) {
  const named = [];
  for (let i = 0; i < state.spots.length; i++) {
    if (state.spots[i].name.trim() !== '') named.push(i);
  }
  if (named.length <= 1) return named;

  if (Array.isArray(state.remainingIds) && state.remainingIds.length) {
    const remaining = new Set(state.remainingIds);
    const eligible = named.filter((i) => remaining.has(state.spots[i].id));
    if (eligible.length) return eligible;
  }

  // A new round cannot immediately repeat the previous round's final pick.
  return named.filter((i) => state.spots[i].id !== state.lastPickId);
}

/** True for a named spot that has already won this round (or the last winner). */
export function isSittingOut(state, index) {
  const spot = state.spots[index];
  return Boolean(spot && spot.name.trim() && !eligibleIndices(state).includes(index));
}

export function canSpin(state) {
  return eligibleIndices(state).length > 0;
}

export function lastPickIndex(state) {
  if (!state.lastPickId) return -1;
  return state.spots.findIndex((s) => s.id === state.lastPickId);
}

/** Choose a winning spot index uniformly from the current bag. */
export function pick(state, rng = Math.random) {
  const pool = eligibleIndices(state);
  if (!pool.length) return null;
  const roll = Math.floor(rng() * pool.length);
  return pool[Math.min(Math.max(roll, 0), pool.length - 1)];
}

/** Consume a winning project from the bag; begin a fresh bag when one is empty. */
export function recordPick(state, index) {
  const chosen = state.spots[index];
  if (!chosen) return state;
  const remainingIds = state.remainingIds && state.remainingIds.length
    ? state.remainingIds.filter((id) => id !== chosen.id)
    : state.spots
        .filter((spot) => spot.name.trim() !== '' && spot.id !== chosen.id)
        .map((spot) => spot.id);
  return { ...state, lastPickId: chosen.id, remainingIds };
}

/**
 * Editing a name changes the set of projects, so it starts a fresh round.
 * The previous winner still sits out the first draw unless it was renamed.
 */
export function rename(state, index, name) {
  const clean = String(name).slice(0, MAX_NAME_LENGTH);
  const changed = state.spots[index].name !== clean;
  if (!changed) return state;
  const spots = state.spots.map((s, i) => (i === index ? { ...s, name: clean } : s));
  const released = state.spots[index].id === state.lastPickId;
  return {
    ...state,
    spots,
    seeded: false,
    lastPickId: released ? null : state.lastPickId,
    remainingIds: [],
  };
}

/** Rebuild a trustworthy state from either the old or current saved schema. */
export function hydrate(raw) {
  const base = createInitialState();
  if (!raw || typeof raw !== 'object') return base;
  if ((raw.version !== 1 && raw.version !== SCHEMA_VERSION) || !Array.isArray(raw.spots)) return base;

  const spots = base.spots.map((spot, i) => {
    const saved = raw.spots[i];
    const name =
      saved && typeof saved.name === 'string' ? saved.name.slice(0, MAX_NAME_LENGTH) : '';
    return { id: spot.id, name };
  });
  const lastPickId = spots.some((s) => s.id === raw.lastPickId) ? raw.lastPickId : null;
  const namedIds = new Set(spots.filter((spot) => spot.name.trim()).map((spot) => spot.id));
  const remainingIds = [];
  if (raw.version === SCHEMA_VERSION && Array.isArray(raw.remainingIds)) {
    for (const id of raw.remainingIds) {
      if (namedIds.has(id) && id !== lastPickId && !remainingIds.includes(id)) {
        remainingIds.push(id);
      }
    }
  }

  return { version: SCHEMA_VERSION, seeded: raw.seeded === true, spots, lastPickId, remainingIds };
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

export const WEDGE_ANGLE = 360 / SPOT_COUNT;

/** Degrees clockwise from the pointer at 12 o'clock to the middle of a wedge. */
export function wedgeCenterAngle(index) {
  return index * WEDGE_ANGLE + WEDGE_ANGLE / 2;
}

/**
 * Absolute rotation that parks `index` under the pointer, always turning
 * forwards and landing off-centre so repeat wins don't look identical.
 */
export function spinTarget(currentRotation, index, rng = Math.random, turns = 5) {
  const spread = WEDGE_ANGLE / 2 - 8;
  const jitter = (rng() * 2 - 1) * spread;
  const want = -(wedgeCenterAngle(index) + jitter);
  let delta = (want - currentRotation) % 360;
  if (delta < 0) delta += 360;
  return currentRotation + delta + 360 * turns;
}
