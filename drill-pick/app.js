/**
 * Drill Pick — web renderer.
 *
 * All rules live in wheel-core.js; this file only draws them and handles input.
 */
import * as core from './wheel-core.js';

const R = 44;              // wedge radius in the 100x100 viewBox
const SPIN_MS = 4200;
const REDUCED_MS = 320;
const WHEEL_NAME_MAX = 12; // characters before the wedge label is clipped
const LABEL_DIST = 27;     // keeps the name clear of the hub and the rim
const SYMBOL_DIST = 41.2;
const OPTIONS_OPEN_KEY = 'drillpick.optionsOpen';

const reduceMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const storage = safeStorage();
const store = core.createStore(storage);
let state = store.load();
let rotation = 0;
let spinning = false;
let hasSpun = false;
let showing = { mode: 'idle', index: -1 };

/* ---------- storage ---------- */

function safeStorage() {
  try {
    const probe = '__drillpick__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (err) {
    // Private windows and blocked site data: stay usable for this visit.
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
    };
  }
}

/* ---------- helpers ---------- */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const n = (v) => Number(v.toFixed(2));

function polar(angle, radius) {
  const rad = (angle * Math.PI) / 180;
  return [50 + radius * Math.sin(rad), 50 - radius * Math.cos(rad)];
}

function wedgePath(a0, a1, radius) {
  const [x0, y0] = polar(a0, radius);
  const [x1, y1] = polar(a1, radius);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M50 50 L${n(x0)} ${n(y0)} A${radius} ${radius} 0 ${large} 1 ${n(x1)} ${n(y1)} Z`;
}

function trianglePath(points) {
  return 'M50 50 ' + points.map(([a, r]) => { const [x, y] = polar(a, r); return `L${n(x)} ${n(y)}`; }).join(' ') + ' Z';
}

/** Text laid along the radius, kept upright on the left half of the wheel. */
function radialText(angle, dist, content, className, size) {
  const flip = angle > 180;
  const rot = flip ? angle + 90 : angle - 90;
  const x = flip ? 50 - dist : 50 + dist;
  const style = size ? ` style="font-size:${n(size)}px"` : '';
  return (
    `<g transform="rotate(${n(rot)} 50 50)">` +
    `<text class="${className}"${style} x="${n(x)}" y="50" text-anchor="middle" dominant-baseline="central">${esc(content)}</text>` +
    `</g>`
  );
}

function wheelLabel(name) {
  const trimmed = name.trim();
  if (!trimmed) return '—';
  return trimmed.length > WHEEL_NAME_MAX ? trimmed.slice(0, WHEEL_NAME_MAX - 1) + '…' : trimmed;
}

const spotAt = (index) => core.activeSpots(state)[index];
const namedSpots = () => core.activeSpots(state).filter((s) => s.name.trim() !== '');

/* ---------- shell ---------- */

document.getElementById('app').innerHTML = `
  <div class="shell">
    <header class="masthead">
      <h1 class="wordmark"><span class="gem">◆</span> Drill Pick</h1>
      <p id="tagline"></p>
    </header>

    <div class="stage" id="stage">
      <div class="spinner" id="spinner"></div>
      <div class="hub"><span>◆</span></div>
      <div class="pointer">
        <svg viewBox="0 0 26 40" aria-hidden="true">
          <path d="M13 38 L2 13 A11 11 0 0 1 24 13 Z" fill="var(--tray)" stroke="var(--tray-rim)" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M13 30 L7 16 A6.6 6.6 0 0 1 19 16 Z" fill="var(--accent)" opacity="0.9"/>
          <circle cx="13" cy="13" r="2.4" fill="var(--tray-ink)" opacity="0.85"/>
        </svg>
      </div>
      <button class="stage__tap" id="stageTap" type="button" tabindex="-1" aria-hidden="true"></button>
    </div>

    <section class="verdict" id="verdict" aria-live="polite">
      <span class="verdict__eyebrow" id="verdictEyebrow"></span>
      <strong class="verdict__name" id="verdictName"></strong>
      <span class="verdict__note" id="verdictNote"></span>
    </section>

    <div class="actions">
      <button class="spin" id="spinBtn" type="button">Spin the wheel</button>
      <button class="shuffle" id="shuffleBtn" type="button" aria-label="Shuffle names on the wheel">
        <span aria-hidden="true">⇄</span> Shuffle
      </button>
    </div>

    <details class="options" id="options">
      <summary class="options__summary">
        <span class="options__title">Wheel options</span>
        <span class="options__peek" id="optionsPeek"></span>
      </summary>
      <div class="options__body" id="optionsBody"></div>
    </details>

    <section class="legend">
      <div class="legend__head">
        <h2 class="legend__title">Canvas legend</h2>
        <span class="legend__hint" id="legendHint"></span>
      </div>
      <ol id="legendList"></ol>
    </section>

    <p class="colophon">
      Saved on this device only — no account, no sync, nothing leaves your phone.
      Add it to your home screen to keep it one tap away.
    </p>
  </div>
`;

const stage = document.getElementById('stage');
const spinner = document.getElementById('spinner');
const spinBtn = document.getElementById('spinBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const stageTap = document.getElementById('stageTap');
const tagline = document.getElementById('tagline');
const options = document.getElementById('options');
const optionsBody = document.getElementById('optionsBody');
const optionsPeek = document.getElementById('optionsPeek');
const legendList = document.getElementById('legendList');
const legendHint = document.getElementById('legendHint');
const verdict = document.getElementById('verdict');
const verdictEyebrow = document.getElementById('verdictEyebrow');
const verdictName = document.getElementById('verdictName');
const verdictNote = document.getElementById('verdictNote');

/* ---------- wheel ---------- */

function paintWheel() {
  const wheel = core.buildWheel(state);
  const total = wheel.length;
  const angle = core.wedgeAngle(total);
  const eligible = new Set(core.eligibleWedges(state, wheel));
  // narrow wedges get slightly smaller type so labels don't touch
  const labelSize = total > 12 ? 3.2 : total > 9 ? 3.5 : null;

  const parts = [
    `<svg viewBox="0 0 100 100" role="img" aria-label="Wheel of ${total} spaces">`,
    `<defs><radialGradient id="dpSheen" cx="34%" cy="26%" r="78%">` +
      `<stop offset="0%" stop-color="#fff" stop-opacity="0.26"/>` +
      `<stop offset="55%" stop-color="#fff" stop-opacity="0.04"/>` +
      `<stop offset="100%" stop-color="#000" stop-opacity="0.16"/>` +
      `</radialGradient></defs>`,
  ];

  wheel.forEach((w, pos) => {
    const a0 = pos * angle;
    const a1 = a0 + angle;
    const mid = core.wedgeCenterAngle(pos, total);
    const isAgain = w.kind === 'again';
    const look = isAgain ? core.AGAIN : core.LEGEND[w.index];
    const spot = isAgain ? null : spotAt(w.index);
    const out = !isAgain && spot.name.trim() !== '' && !eligible.has(pos);

    parts.push(`<g class="wedge${out ? ' is-out' : ''}${isAgain ? ' is-again' : ''}">`);
    parts.push(`<path d="${wedgePath(a0, a1, R)}" fill="${look.color}"/>`);
    parts.push(`<path d="${trianglePath([[a0, R], [mid, R]])}" fill="#fff" opacity="0.13"/>`);
    parts.push(`<path d="${trianglePath([[mid, R], [a1, R]])}" fill="#000" opacity="0.17"/>`);
    parts.push(`<path d="${trianglePath([[a0, R * 0.42], [mid, R * 0.54], [a1, R * 0.42]])}" fill="#fff" opacity="0.1"/>`);
    if (out) {
      parts.push(`<path d="${wedgePath(a0, a1, R)}" fill="var(--ground)" opacity="0.66"/>`);
    }
    parts.push(radialText(mid, SYMBOL_DIST, look.symbol, 'wedge-symbol'));
    parts.push(radialText(mid, LABEL_DIST, isAgain ? core.AGAIN.label : wheelLabel(spot.name), 'wedge-label', labelSize));
    parts.push(`</g>`);
  });

  // drill border around the rim, coloured by the wedge behind it
  for (let i = 0; i < 45; i++) {
    const a = i * 8 + 4;
    const [x, y] = polar(a, R + 2.6);
    const w = wheel[Math.floor(a / angle) % total];
    const color = w.kind === 'again' ? '#8B8296' : core.LEGEND[w.index].color;
    parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="1.35" fill="${color}" opacity="0.8"/>`);
  }

  parts.push(`<circle cx="50" cy="50" r="${R}" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="0.7"/>`);
  parts.push(`<circle cx="50" cy="50" r="49" fill="none" stroke="var(--line-strong)" stroke-width="0.6"/>`);

  [[33, 29], [69, 57], [43, 73]].forEach(([cx, cy]) => {
    parts.push(
      `<path class="sparkle" transform="translate(${cx} ${cy})" fill="#fff" ` +
        `d="M0 -2.6 Q0.5 -0.5 2.6 0 Q0.5 0.5 0 2.6 Q-0.5 0.5 -2.6 0 Q-0.5 -0.5 0 -2.6 Z"/>`
    );
  });

  parts.push(`<circle cx="50" cy="50" r="${R}" fill="url(#dpSheen)" pointer-events="none"/>`);
  parts.push(`</svg>`);
  spinner.innerHTML = parts.join('');
  tagline.textContent = `${state.settings.count} WIPs, one spin`;
}

/* ---------- legend ---------- */

function paintLegend() {
  const doubled = new Set(core.doubledIds(state));
  legendList.innerHTML = core.activeSpots(state)
    .map((spot, i) => {
      const entry = core.LEGEND[i];
      const out = core.isSittingOut(state, i);
      const extra = (doubled.has(spot.id) ? ' · <em>2× on wheel</em>' : '') +
        (out ? ' · <em>sitting out</em>' : '');
      return (
        `<li class="row${out ? ' is-out' : ''}">` +
        `<span class="chip" style="--chip:${entry.color}" aria-hidden="true">${entry.symbol}</span>` +
        `<input class="name" id="spot-${i + 1}" type="text" value="${esc(spot.name)}" ` +
        `maxlength="${core.MAX_NAME_LENGTH}" placeholder="Empty spot" autocomplete="off" ` +
        `spellcheck="false" aria-label="Wheel spot ${i + 1}" data-index="${i}">` +
        `<span class="meta">DMC ${entry.dmc} · ${entry.shade}${extra}</span>` +
        `</li>`
      );
    })
    .join('');

  legendList.querySelectorAll('.name').forEach((input) => {
    input.readOnly = spinning;
    input.addEventListener('input', onRename);
    // the doubled-name pickers list names, so refresh them once typing settles
    input.addEventListener('change', () => paintOptions());
  });

  legendHint.textContent = hintText();
}

function hintText() {
  if (!core.canSpin(state)) return 'Name a spot to spin';
  if (state.seeded) return 'Starters — tap to rename';
  return '';
}

function onRename(event) {
  const index = Number(event.target.dataset.index);
  const before = state;
  const next = core.rename(state, index, event.target.value);
  if (next === state) return;
  state = next;
  store.save(state);
  paintWheel();
  if (showing.index === index || core.lastPickId(before) !== core.lastPickId(state)) {
    paintVerdict(showing.mode, showing.index);
  }
  // sitting-out marks and "2×" tags may have changed, so redraw the rows
  const active = document.activeElement;
  const caret = active && active.selectionStart;
  paintLegend();
  const restored = document.getElementById('spot-' + (index + 1));
  if (restored && active && active.classList.contains('name')) {
    restored.focus();
    if (caret != null) { try { restored.setSelectionRange(caret, caret); } catch (err) {} }
  }
  paintPeek();
  syncButtons();
}

/* ---------- options ---------- */

function selectHtml(id, choices, value, label, disabledValues = new Set()) {
  return (
    `<select class="select" id="${id}" aria-label="${esc(label)}">` +
    choices
      .map(([v, text]) =>
        `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}` +
        `${disabledValues.has(String(v)) && String(v) !== String(value) ? ' disabled' : ''}>${esc(text)}</option>`)
      .join('') +
    `</select>`
  );
}

function toggleHtml(id, on, title, sub) {
  return (
    `<label class="toggle" for="${id}">` +
    `<span class="toggle__text"><span class="toggle__title">${title}</span>` +
    `<span class="toggle__sub">${sub}</span></span>` +
    `<input type="checkbox" role="switch" class="switch" id="${id}"${on ? ' checked' : ''}>` +
    `</label>`
  );
}

const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

function paintOptions() {
  const { count, skip, double, again } = state.settings;
  const named = namedSpots();

  const countChoices = range(core.MIN_SPOTS, core.MAX_SPOTS).map((v) => [v, `${v} spots`]);

  const doubleCountChoices = range(1, core.MAX_DOUBLES).map((v) => [v, v === 1 ? '1 name' : `${v} names`]);
  const nameChoices = [['', named.length ? 'Choose a name…' : 'Name a spot first']]
    .concat(named.map((s) => [s.id, s.name.trim()]));
  const doublePickers = double.ids
    .map((id, k) => {
      const others = new Set(double.ids.filter((x, j) => j !== k && x));
      const live = named.some((s) => s.id === id) ? id : '';
      return `<div class="field">` +
        `<span class="field__label">${double.ids.length > 1 ? `Name ${k + 1}` : 'Name'}</span>` +
        selectHtml(`opt-double-${k}`, nameChoices, live, `Doubled name ${k + 1}`, others) +
        `</div>`;
    })
    .join('');

  const againChoices = range(1, core.MAX_AGAIN).map((v) => [v, v === 1 ? '1 space' : `${v} spaces`]);

  optionsBody.innerHTML =
    `<div class="opt">` +
      `<div class="field field--row">` +
        `<span class="toggle__text"><span class="toggle__title">Choices on the wheel</span>` +
        `<span class="toggle__sub">How many projects share the wheel</span></span>` +
        selectHtml('opt-count', countChoices, count, 'Number of choices on the wheel') +
      `</div>` +
    `</div>` +

    `<div class="opt${skip.on ? ' is-on' : ''}">` +
      toggleHtml('opt-skip', skip.on, 'Skip last pick', 'Recent winners sit out so you don’t get repeats') +
      (skip.on
        ? `<div class="opt__more"><div class="field"><span class="field__label">Sit out</span>` +
          selectHtml('opt-skip-mode', core.SKIP_MODES.map((m) => [m.value, m.label]), skip.mode, 'How long winners sit out') +
          `</div></div>`
        : '') +
    `</div>` +

    `<div class="opt${double.on ? ' is-on' : ''}">` +
      toggleHtml('opt-double', double.on, 'Double a name (2×)', 'Give a name two spots on the wheel — twice the chance') +
      (double.on
        ? `<div class="opt__more"><div class="field"><span class="field__label">How many</span>` +
          selectHtml('opt-double-count', doubleCountChoices, double.ids.length, 'How many names to double') +
          `</div>${doublePickers}</div>`
        : '') +
    `</div>` +

    `<div class="opt${again.on ? ' is-on' : ''}">` +
      toggleHtml('opt-again', again.on, 'Spin again space', 'Blank spaces that just mean “spin again”') +
      (again.on
        ? `<div class="opt__more"><div class="field"><span class="field__label">How many</span>` +
          selectHtml('opt-again-count', againChoices, again.count, 'How many spin again spaces') +
          `</div></div>`
        : '') +
    `</div>`;

  optionsBody.querySelectorAll('select, input').forEach((el) => {
    el.disabled = spinning;
    el.addEventListener('change', onOption);
  });
  paintPeek();
}

function paintPeek() {
  const { count, skip, again } = state.settings;
  const bits = [`${count} choices`];
  if (skip.on) bits.push(skip.mode === 'round' ? 'no repeats' : skip.mode === 'last2' ? 'skip last 2' : 'skip last');
  const doubles = core.doubledIds(state).length;
  if (doubles) bits.push(`${doubles}× doubled`);
  if (again.on) bits.push(`${again.count} spin again`);
  optionsPeek.textContent = bits.join(' · ');
}

function onOption(event) {
  const el = event.target;
  const id = el.id;
  const { double } = state.settings;
  let patch = null;

  if (id === 'opt-count') patch = { count: Number(el.value) };
  else if (id === 'opt-skip') patch = { skip: { on: el.checked } };
  else if (id === 'opt-skip-mode') patch = { skip: { mode: el.value } };
  else if (id === 'opt-double') {
    patch = { double: { on: el.checked } };
    // turning it on with nothing picked yet: preselect the first named spot
    if (el.checked && !core.doubledIds({ ...state, settings: { ...state.settings, double: { ...double, on: true } } }).length) {
      const first = namedSpots()[0];
      if (first) patch.double.ids = [first.id].concat(double.ids.slice(1));
    }
  } else if (id === 'opt-double-count') {
    const want = Number(el.value);
    const ids = double.ids.slice(0, want);
    while (ids.length < want) {
      const free = namedSpots().find((s) => !ids.includes(s.id));
      ids.push(free ? free.id : '');
    }
    patch = { double: { ids } };
  } else if (id.startsWith('opt-double-')) {
    const k = Number(id.slice('opt-double-'.length));
    const ids = double.ids.slice();
    ids[k] = el.value;
    patch = { double: { ids } };
  } else if (id === 'opt-again') patch = { again: { on: el.checked } };
  else if (id === 'opt-again-count') patch = { again: { count: Number(el.value) } };

  if (!patch) return;
  const next = core.updateSettings(state, patch);
  if (next === state) return;
  state = next;
  store.save(state);

  paintWheel();
  paintLegend();
  paintOptions();
  paintVerdict(showing.mode === 'again' ? 'idle' : showing.mode, showing.index);
  syncButtons();
  const back = document.getElementById(id);
  if (back) back.focus();
}

/* ---------- verdict ---------- */

function paintVerdict(mode, index) {
  if (mode === 'won' && !spotAt(index)) mode = 'idle';
  showing = { mode, index: mode === 'won' ? index : core.lastPickIndex(state) };

  if (mode === 'again') {
    verdict.classList.remove('is-waiting');
    verdict.style.setProperty('--verdict-color', 'var(--accent)');
    verdictEyebrow.textContent = 'Landed on';
    verdictName.textContent = 'Spin again!';
    verdictNote.textContent = `${core.AGAIN.symbol} Free spin — this one doesn’t count.`;
    return;
  }

  if (mode === 'won') {
    const entry = core.LEGEND[index];
    const spot = spotAt(index);
    verdict.classList.remove('is-waiting');
    verdict.style.setProperty('--verdict-color', entry.color);
    verdictEyebrow.textContent = 'Work on this next';
    verdictName.textContent = spot.name.trim() || 'Untitled spot';
    verdictNote.textContent = core.isSittingOut(state, index)
      ? `${entry.symbol} DMC ${entry.dmc} · sitting out your next spin`
      : `${entry.symbol} DMC ${entry.dmc}`;
    return;
  }

  const last = core.lastPickIndex(state);
  verdict.classList.add('is-waiting');
  if (last === -1) {
    verdict.style.setProperty('--verdict-color', 'var(--line-strong)');
    verdictEyebrow.textContent = 'Ready';
    verdictName.textContent = 'Spin to pick your next canvas';
    const count = namedSpots().length;
    verdictNote.textContent = count === 1 ? 'One spot is in play.' : `All ${count} named spots are in play.`;
  } else {
    const entry = core.LEGEND[last];
    verdict.style.setProperty('--verdict-color', entry.color);
    verdictEyebrow.textContent = 'Last pick';
    verdictName.textContent = spotAt(last).name.trim() || 'Untitled spot';
    verdictNote.textContent = core.isSittingOut(state, last)
      ? `${entry.symbol} DMC ${entry.dmc} · sitting out this spin`
      : `${entry.symbol} DMC ${entry.dmc}`;
  }
}

function syncButtons() {
  spinBtn.disabled = spinning || !core.canSpin(state);
  spinBtn.textContent = spinning
    ? 'Spinning…'
    : hasSpun
    ? 'Spin again'
    : 'Spin the wheel';
  shuffleBtn.disabled = spinning || namedSpots().length < 2;
}

function setBusy(busy) {
  legendList.querySelectorAll('.name').forEach((input) => { input.readOnly = busy; });
  optionsBody.querySelectorAll('select, input').forEach((el) => { el.disabled = busy; });
}

/* ---------- shuffling ---------- */

function shuffleNames() {
  if (spinning) return;
  const winnerId = showing.mode === 'won' ? spotAt(showing.index).id : null;
  state = core.shuffle(state);
  store.save(state);
  // the winner moved rows along with its name
  const idx = winnerId ? core.activeSpots(state).findIndex((s) => s.id === winnerId) : -1;

  paintWheel();
  paintLegend();
  paintOptions();
  paintVerdict(showing.mode, idx);
  syncButtons();

  const svg = spinner.querySelector('svg');
  if (svg && svg.animate && !reduceMotion) {
    svg.animate(
      [
        { transform: 'rotate(-40deg) scale(0.9)', opacity: 0.2 },
        { transform: 'rotate(0deg) scale(1)', opacity: 1 },
      ],
      { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
    );
  }
}

/* ---------- spinning ---------- */

function spin() {
  if (spinning) return;
  const wheel = core.buildWheel(state);
  const pos = core.pick(state);
  if (pos === null) return;

  spinning = true;
  hasSpun = true;
  stage.classList.add('is-spinning');
  syncButtons();
  setBusy(true);
  verdictEyebrow.textContent = 'Picking…';

  const duration = reduceMotion ? REDUCED_MS : SPIN_MS;
  rotation = core.spinTarget(rotation, pos, wheel.length, Math.random, reduceMotion ? 1 : 5);
  spinner.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.74, 0.14, 1.01)`;
  spinner.style.transform = `rotate(${n(rotation)}deg)`;

  window.setTimeout(() => land(pos, wheel), duration + 60);
}

function land(pos, wheel) {
  // keep the angle small so it never drifts toward float imprecision
  rotation = ((rotation % 360) + 360) % 360;
  spinner.style.transition = 'none';
  spinner.style.transform = `rotate(${n(rotation)}deg)`;

  spinning = false;
  stage.classList.remove('is-spinning');
  const w = wheel[pos];
  state = core.recordPick(state, pos, wheel);
  store.save(state);

  paintWheel();
  paintLegend();
  paintOptions();
  if (w.kind === 'again') {
    paintVerdict('again', -1);
    syncButtons();
    return;
  }
  paintVerdict('won', w.index);
  syncButtons();
  drillShower(core.LEGEND[w.index].color);
}

function drillShower(winnerColor) {
  if (reduceMotion || !document.body.animate) return;
  const box = stage.getBoundingClientRect();
  const originX = box.left + box.width / 2;
  const originY = box.top + 14;
  const palette = core.LEGEND.slice(0, state.settings.count).map((entry) => entry.color);

  for (let i = 0; i < 22; i++) {
    const drill = document.createElement('span');
    drill.className = 'drill';
    drill.style.setProperty('--drill', i % 3 === 0 ? winnerColor : palette[i % palette.length]);
    document.body.appendChild(drill);

    const drift = (Math.random() * 2 - 1) * 150;
    const fall = 150 + Math.random() * 240;
    const lift = 60 + Math.random() * 50;
    const animation = drill.animate(
      [
        { transform: `translate(${originX}px, ${originY}px) scale(0.4)`, opacity: 0 },
        { transform: `translate(${originX + drift * 0.35}px, ${originY - lift}px) scale(1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${originX + drift}px, ${originY + fall}px) scale(0.85)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 700, delay: Math.random() * 140, easing: 'cubic-bezier(0.22, 0.6, 0.36, 1)' }
    );
    animation.onfinish = () => drill.remove();
    animation.oncancel = () => drill.remove();
  }
}

/* ---------- boot ---------- */

spinBtn.addEventListener('click', spin);
stageTap.addEventListener('click', spin);
shuffleBtn.addEventListener('click', shuffleNames);

try { options.open = storage.getItem(OPTIONS_OPEN_KEY) === '1'; } catch (err) {}
options.addEventListener('toggle', () => {
  try { storage.setItem(OPTIONS_OPEN_KEY, options.open ? '1' : '0'); } catch (err) {}
});

paintWheel();
paintLegend();
paintOptions();
paintVerdict('idle');
syncButtons();
