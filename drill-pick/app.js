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

const reduceMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = core.createStore(safeStorage());
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
  return `M50 50 L${n(x0)} ${n(y0)} A${radius} ${radius} 0 0 1 ${n(x1)} ${n(y1)} Z`;
}

function trianglePath(points) {
  return 'M50 50 ' + points.map(([a, r]) => { const [x, y] = polar(a, r); return `L${n(x)} ${n(y)}`; }).join(' ') + ' Z';
}

/** Text laid along the radius, kept upright on the left half of the wheel. */
function radialText(angle, dist, content, className) {
  const flip = angle > 180;
  const rot = flip ? angle + 90 : angle - 90;
  const x = flip ? 50 - dist : 50 + dist;
  return (
    `<g transform="rotate(${n(rot)} 50 50)">` +
    `<text class="${className}" x="${n(x)}" y="50" text-anchor="middle" dominant-baseline="central">${esc(content)}</text>` +
    `</g>`
  );
}

function wheelLabel(name) {
  const trimmed = name.trim();
  if (!trimmed) return '—';
  return trimmed.length > WHEEL_NAME_MAX ? trimmed.slice(0, WHEEL_NAME_MAX - 1) + '…' : trimmed;
}

/* ---------- shell ---------- */

document.getElementById('app').innerHTML = `
  <div class="shell">
    <header class="masthead">
      <h1 class="wordmark"><span class="gem">◆</span> Drill Pick</h1>
      <p>Five WIPs, one spin</p>
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

    <button class="spin" id="spinBtn" type="button">Spin the wheel</button>

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
const stageTap = document.getElementById('stageTap');
const legendList = document.getElementById('legendList');
const legendHint = document.getElementById('legendHint');
const verdict = document.getElementById('verdict');
const verdictEyebrow = document.getElementById('verdictEyebrow');
const verdictName = document.getElementById('verdictName');
const verdictNote = document.getElementById('verdictNote');

/* ---------- wheel ---------- */

function paintWheel() {
  const parts = [
    `<svg viewBox="0 0 100 100" role="img" aria-label="Wheel of five diamond painting projects">`,
    `<defs><radialGradient id="dpSheen" cx="34%" cy="26%" r="78%">` +
      `<stop offset="0%" stop-color="#fff" stop-opacity="0.26"/>` +
      `<stop offset="55%" stop-color="#fff" stop-opacity="0.04"/>` +
      `<stop offset="100%" stop-color="#000" stop-opacity="0.16"/>` +
      `</radialGradient></defs>`,
  ];

  state.spots.forEach((spot, i) => {
    const entry = core.LEGEND[i];
    const a0 = i * core.WEDGE_ANGLE;
    const a1 = a0 + core.WEDGE_ANGLE;
    const mid = core.wedgeCenterAngle(i);
    const out = core.isSittingOut(state, i);

    parts.push(`<g class="wedge${out ? ' is-out' : ''}">`);
    parts.push(`<path d="${wedgePath(a0, a1, R)}" fill="${entry.color}"/>`);
    parts.push(`<path d="${trianglePath([[a0, R], [mid, R]])}" fill="#fff" opacity="0.13"/>`);
    parts.push(`<path d="${trianglePath([[mid, R], [a1, R]])}" fill="#000" opacity="0.17"/>`);
    parts.push(`<path d="${trianglePath([[a0, R * 0.42], [mid, R * 0.54], [a1, R * 0.42]])}" fill="#fff" opacity="0.1"/>`);
    if (out) {
      parts.push(`<path d="${wedgePath(a0, a1, R)}" fill="var(--ground)" opacity="0.66"/>`);
    }
    parts.push(radialText(mid, SYMBOL_DIST, entry.symbol, 'wedge-symbol'));
    parts.push(radialText(mid, LABEL_DIST, wheelLabel(spot.name), 'wedge-label'));
    parts.push(`</g>`);
  });

  // drill border around the rim, coloured by the wedge behind it
  for (let i = 0; i < 45; i++) {
    const angle = i * 8 + 4;
    const [x, y] = polar(angle, R + 2.6);
    const entry = core.LEGEND[Math.floor(angle / core.WEDGE_ANGLE) % core.SPOT_COUNT];
    parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="1.35" fill="${entry.color}" opacity="0.8"/>`);
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
}

/* ---------- legend ---------- */

function paintLegend() {
  legendList.innerHTML = state.spots
    .map((spot, i) => {
      const entry = core.LEGEND[i];
      const out = core.isSittingOut(state, i);
      return (
        `<li class="row${out ? ' is-out' : ''}">` +
        `<span class="chip" style="--chip:${entry.color}" aria-hidden="true">${entry.symbol}</span>` +
        `<input class="name" id="spot-${i + 1}" type="text" value="${esc(spot.name)}" ` +
        `maxlength="${core.MAX_NAME_LENGTH}" placeholder="Empty spot" autocomplete="off" ` +
        `spellcheck="false" aria-label="Wheel spot ${i + 1}" data-index="${i}">` +
        `<span class="meta">DMC ${entry.dmc} · ${entry.shade}${out ? ' · <em>sitting out</em>' : ''}</span>` +
        `</li>`
      );
    })
    .join('');

  legendList.querySelectorAll('.name').forEach((input) => {
    input.readOnly = spinning;
    input.addEventListener('input', onRename);
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
  const next = core.rename(state, index, event.target.value);
  if (next === state) return;
  const released = Boolean(state.lastPickId && !next.lastPickId);
  state = next;
  store.save(state);
  paintWheel();
  if (showing.index === index || released) paintVerdict(showing.mode, showing.index);
  if (released || hintText() !== legendHint.textContent) {
    // a released spot changes the sitting-out marks, so redraw the rows
    const active = document.activeElement;
    const caret = active && active.selectionStart;
    paintLegend();
    const restored = document.getElementById('spot-' + (index + 1));
    if (restored && active && active.classList.contains('name')) {
      restored.focus();
      if (caret != null) { try { restored.setSelectionRange(caret, caret); } catch (err) {} }
    }
  }
  syncSpinButton();
}

/* ---------- verdict ---------- */

function paintVerdict(mode, index) {
  showing = { mode, index: mode === 'won' ? index : core.lastPickIndex(state) };
  if (mode === 'won') {
    const entry = core.LEGEND[index];
    const spot = state.spots[index];
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
    verdictNote.textContent = 'All five spots are in play.';
  } else {
    const entry = core.LEGEND[last];
    verdict.style.setProperty('--verdict-color', entry.color);
    verdictEyebrow.textContent = 'Last pick';
    verdictName.textContent = state.spots[last].name.trim() || 'Untitled spot';
    verdictNote.textContent = core.isSittingOut(state, last)
      ? `${entry.symbol} DMC ${entry.dmc} · sitting out this spin`
      : `${entry.symbol} DMC ${entry.dmc}`;
  }
}

function syncSpinButton() {
  spinBtn.disabled = spinning || !core.canSpin(state);
  spinBtn.textContent = spinning
    ? 'Spinning…'
    : hasSpun
    ? 'Spin again'
    : 'Spin the wheel';
}

/* ---------- spinning ---------- */

function spin() {
  if (spinning) return;
  const index = core.pick(state);
  if (index === null) return;

  spinning = true;
  hasSpun = true;
  stage.classList.add('is-spinning');
  syncSpinButton();
  verdictEyebrow.textContent = 'Picking…';
  legendList.querySelectorAll('.name').forEach((input) => { input.readOnly = true; });

  const duration = reduceMotion ? REDUCED_MS : SPIN_MS;
  rotation = core.spinTarget(rotation, index, Math.random, reduceMotion ? 1 : 5);
  spinner.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.74, 0.14, 1.01)`;
  spinner.style.transform = `rotate(${n(rotation)}deg)`;

  window.setTimeout(() => land(index), duration + 60);
}

function land(index) {
  // keep the angle small so it never drifts toward float imprecision
  rotation = ((rotation % 360) + 360) % 360;
  spinner.style.transition = 'none';
  spinner.style.transform = `rotate(${n(rotation)}deg)`;

  spinning = false;
  stage.classList.remove('is-spinning');
  state = core.recordPick(state, index);
  store.save(state);

  paintWheel();
  paintLegend();
  paintVerdict('won', index);
  syncSpinButton();
  drillShower(core.LEGEND[index].color);
}

function drillShower(winnerColor) {
  if (reduceMotion || !document.body.animate) return;
  const box = stage.getBoundingClientRect();
  const originX = box.left + box.width / 2;
  const originY = box.top + 14;
  const palette = core.LEGEND.map((entry) => entry.color);

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

paintWheel();
paintLegend();
paintVerdict('idle');
syncSpinButton();
