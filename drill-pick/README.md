# Drill Pick

A spinning wheel that picks which diamond painting to work on next,
and (unless you switch it off) never hands you the same one twice in a row.

Built to live on a phone home screen: no account, no network, no build step.
Everything you type stays in that phone's own storage.

## How it works

- One wedge per work-in-progress (six to start). Tap **Spin the wheel** (or the wheel itself).
- The winner is announced under the wheel and remembered as **Last pick**.
- That winner then **sits out the next spin** — its wedge greys out and its legend
  row is marked, so the exclusion is visible rather than feeling rigged.
- Rename any spot in the canvas legend. Renaming the spot that's sitting out
  releases it, because a new name means a different project.
- Blank spots are skipped. With only one spot named, it can win every time —
  there's nothing to rotate against.

### Wheel options

Open **Wheel options** under the spin button. Each switch shows its dropdowns
once it's turned on, and everything is saved on the phone.

- **Choices on the wheel** — 2 to 12 spots. Shrinking the wheel hides the extra
  spots but keeps their names for when you grow it again.
- **Skip last pick** — on by default. Pick how long a winner sits out:
  *until everyone has had a turn* (the original rounds), *just the last pick*,
  or *the last 2 picks*. Off means any name can win any spin.
- **Double a name (2×)** — choose how many names (1–3), then which ones. Each gets
  a second wedge across the wheel from the first, so twice the chance. In
  rounds mode a doubled name gets two turns per round, never back to back.
- **Spin again space** — 1–3 dark ↻ wedges. Landing on one doesn't count as a
  pick; just spin again.

The **Shuffle** button next to Spin rearranges the names around the wheel.
Winners, sitting-out marks and doubles follow their names.

Each spot carries a legend symbol and a DMC code the way a real canvas legend
identifies a drill colour, so a wedge stays recognisable when the name is too
long to fit on it.

## Running it

Any static file server works. From this folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

It needs to be served over http/https rather than opened as a `file://` path,
because the code is split into ES modules.

### Putting it on a phone

1. Host the folder anywhere static — GitHub Pages, Netlify, a Raspberry Pi on
   your LAN. For GitHub Pages: push the repo, then Settings → Pages → deploy
   from the branch, and the app lives at `<user>.github.io/<repo>/drill-pick/`.
2. Open that URL on the phone.
3. **iPhone:** Share → Add to Home Screen. **Android:** menu → Install app.

After the first load the service worker caches everything, so it opens and
spins with no signal at all.

### Updating an installed copy

No reinstall. The app's own files are fetched network-first, so a merge to
`main` reaches an installed phone on its next launch with signal; the cache is
only the offline fallback. Changing `sw.js` itself takes one extra launch: the
first opens with the old worker still in charge and installs the new one, the
second shows the new version.

## Files

| File | Purpose |
| --- | --- |
| `wheel-core.js` | All the rules: spot state, the no-repeat pick, persistence, wheel geometry. No DOM, no browser globals. |
| `app.js` | Web renderer — draws the wheel, handles taps, runs the spin animation. |
| `app.css` | Design tokens and layout, light and dark. |
| `index.html` | Page shell and service worker registration. |
| `sw.js` | Offline cache, network-first for the app's own files. |
| `manifest.webmanifest` | Home-screen install metadata. |
| `tools/make-icons.py` | Regenerates the app icons. Pure Python, no image library. |
| `tools/test-core.mjs` | Rule checks for `wheel-core.js`. |

## Checks

```bash
node tools/test-core.mjs
node tools/test-shuffle.mjs
```

Covers the no-repeat rule, blank and single-spot edge cases, rename-releases-exclusion,
storage failures, save/load round-tripping, upgrading a save from a smaller wheel,
and that the wedge parked under the pointer is genuinely the wedge that was picked.

## Going native later

`wheel-core.js` is deliberately free of DOM and browser APIs, so a React Native
or Expo shell can import it unchanged and only reimplement the drawing. The one
thing to swap is the storage backend passed to `createStore` — it expects
`getItem`/`setItem`, so an async store needs hydrating once at startup.

## Changing the wheel

The colours, symbols and DMC codes live in the `LEGEND` array in
`wheel-core.js`, and its length is the most spots the wheel can hold — add an
entry and the **Choices** dropdown goes one higher. A phone that already has saved names keeps them and shows the new
spot empty, rather than inventing a name the owner never typed.
