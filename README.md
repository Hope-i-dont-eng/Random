# Drill Pick

A six-spot spinning wheel that picks which diamond painting to work on next,
and never hands you the same one twice in a row.

Built to live on a phone home screen: no account, no network, no build step.
Everything you type stays in that phone's own storage.

## How it works

- Six wedges, one per work-in-progress. Tap **Spin the wheel** (or the wheel itself).
- The winner is announced under the wheel and remembered as **Last pick**.
- That winner then **sits out the next spin** — its wedge greys out and its legend
  row is marked, so the exclusion is visible rather than feeling rigged.
- Rename any spot in the canvas legend. Renaming the spot that's sitting out
  releases it, because a new name means a different project.
- Blank spots are skipped. With only one spot named, it can win every time —
  there's nothing to rotate against.

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
`wheel-core.js`, and the wheel takes its size from that array — add an entry
and you get another wedge, with the geometry, the renderer and the rules all
following. A phone that already has saved names keeps them and shows the new
spot empty, rather than inventing a name the owner never typed.
