# Developing libfurry

## Environment and commands

The main client is in `app/`; run the commands below there. Node.js >= 22.18.0 is
required because tests import `.ts` directly using Node's built-in type stripping.
The root `.nvmrc` selects Node.js 22. Install dependencies with `npm ci`.
`package-lock.json` is tracked and must be updated with dependency changes in
`package.json`. `private: true` prevents accidental npm publication; it does not
restrict publishing source code on GitHub.

| Command | Result |
| --- | --- |
| `npm run check` | Lint, type checks and all tests; no build or application launch |
| `npm run lint` | ESLint for the UI, Electron, tests and signing scripts |
| `npm run typecheck` | TypeScript with `--noEmit` |
| `npm test` | Isolated Node.js tests |
| `node --test tests/gallery.test.cjs` | One test suite |
| `npm run dev` | Vite server and a new Electron window |
| `npm run build` | Type checks and renderer output in `dist/` |
| `npm start` | Electron using the existing `dist/` |
| `npm run package:mac` | Build the renderer and package a `.app` in `release/` |
| `npm run package:mac:local` | Package, create a local certificate and sign |
| `npm run sign:mac:local` | Sign an existing `.app` with the local certificate |

`npm run check` does not verify packaging, signing, window rendering or real
account actions. Tests mock Electron and network responses, create their own
temporary directories and do not use the running application's profile.

GitHub Actions runs `npm ci` and `npm run check` on Linux with Node.js 22 and 24.
Electron binary downloads are disabled in these check jobs. After checks and
the secret scan pass, native macOS ARM64 and Intel jobs use Node.js 24 to build
DMG and ZIP packages. They use `macos-15` and `macos-15-intel`, verify the runner
architecture and package without publication:

```sh
npm exec -- electron-builder --mac dmg zip --arm64 --publish never
```

The Intel job uses `--x64` instead. These CI targets override the default `dir`
target; local `npm run package:mac` still produces a `.app`. Certificate discovery
is disabled and `mac.identity: null` remains set in `package.json`. No Developer
ID certificate or notarization is used.

`upload-artifact` stores distributions for 14 days as `libfurry-macos-arm64` and
`libfurry-macos-x64`, without extra compression. Missing packages fail the job.
CI runs on pushes, pull requests and manual dispatch. Main-branch and matching
version-tag runs then create or replace the version's Draft release using
`scripts/publish-draft.py`. Rebuilds replace all assets in the same draft and
include `SHA256SUMS.txt`. New releases start as drafts; rebuilding a published
version replaces its files without unpublishing it. Pull requests do not create releases.

## Browser fixture

The fixture replaces the preload API with synthetic data for grid testing
without Electron or a real account. It still starts a separate server; run it
only when server startup is authorized.

```sh
npm exec vite -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/tests/fixtures/grid.html`. Parameters can be combined:

| Parameter | Scenario |
| --- | --- |
| `failRestore=1` | One failed restoration of the first page |
| `accountIssue=1` | Saved-key access error |
| `storageIssue=1` | Corrupt local-settings message |
| `delayedAccount=1` / `earlyAccount=1` | Different account-confirmation timing |
| `accountDelay=10000` | Account-confirmation delay in milliseconds |
| `accountReaction=1` / `accountBlacklist=1` | Reactions and blacklist after account confirmation |
| `slowAccountSearch=1` | Delayed background search rebuild after login |
| `previewFailure=1` | A card with an unavailable preview |
| `partialPages=1&slowNextPage=1` | Incomplete Apple row and a 20-second next-page delay |
| `slowWatch=1` | Slow, cancellable watched-tag refresh |
| `slowBlacklist=1` | Delayed blacklist synchronization |
| `slowFavorite=1` / `slowUpvote=1` | Delayed reactions for repeated-click testing |
| `hiddenMiddlePage=1` | Viewer navigation across a fully hidden page |
| `resumeSession=1` | Persist the synthetic feed and position across fixture reloads |

For example, `?delayedAccount=1&accountDelay=10000&accountReaction=1&accountBlacklist=1`
allows scrolling before account confirmation and checking the resulting rebuild.
Use `slowAccountSearch=1` alongside account confirmation.

For `resumeSession=1`, scroll, wait 500 ms after stopping and reload the same page.
The fixture stores only its test session in `localStorage`, under
`e322-grid-session`; this is not the Electron profile. Delete that key in browser
devtools to reset it. The application atomically writes `session.json` through
the main process, including a final save during normal window close. Forced
termination restores the latest position that finished saving.

### Local real-preview fixture

The default fixture needs no e621 responses. For a separate network test, place
an array of post pages in `tests/fixtures/real-pages.local.json`:

```json
[
  [{ "id": 1, "width": 240, "height": 160, "preview_url": "https://…" }],
  [{ "id": 2, "width": 160, "height": 240, "preview_url": "https://…" }]
]
```

This illustrates nesting, not the complete post schema; see `Post` in
`src/types.ts`. Open the fixture with `?realMedia=1`; `&startPage=40` starts on
page 41. Real preview URLs make CDN requests. The fixture stays local and is
ignored by Git; do not commit profile exports, keys or search history.

## Code changes

Follow the existing style: two spaces, LF, TypeScript in `src/` and CommonJS
`.cjs` in Electron and tests. The package uses ESM for Vite and TypeScript
modules. Runtime `.ts` imports in Node-tested modules must include the extension.
Vite builds React components.

Update `E322Bridge` in `src/types.ts`, `electron/preload.cjs` and handlers in
`electron/main.cjs` together when changing the preload contract. Network,
filesystem and credential access remain in the main process.

Test observable behavior of affected logic. Race tests must control request
completion; file tests must use separate temporary directories. Do not use a
real account, Keychain or the user's download folder. Report browser and Electron
measurements separately, with the date, scenario and limits. Historical results
are in [performance.md](performance.md).

## Assets, packaging and publication

The application icon is included in `assets/`. `bash scripts/create-icon.sh`
regenerates `.icns` from `assets/AppIcon.png` using macOS tools; routine checks do
not require it.

`build.dmg` in `package.json` defines the DMG layout: a 654×422 pt visible
background, 140 pt icons centered at `(197, 195)` and `(473, 195)`, and 12 pt labels.
`assets/dmg-background.png` can be 654×422 px (1×) or 1308×844 px (2×); the current
source is 1308×844 px, preserving its detail in the Retina layer. After replacing
it, run `bash scripts/create-dmg-background.sh` to create a TIFF with standard
and Retina layers. A technical strip at the bottom compensates for the 22 pt
Finder title bar, which the packager includes in its background-derived window
size. The artwork itself does not move; the strip stays outside the visible
area. The TIFF is tracked, so CI does not regenerate it.

Do not commit `node_modules/`, `dist/`, `release/`, build caches, user data or
signing material. Local `.env`, `.npmrc` and `*.local.json` files are also ignored.
`.gitignore` does not remove files already in history. Before publication, check
`git status`, `git diff --check` and staged contents; do not force-add ignored files.

Keep `LICENSE` and `third_party/` at the repository root. The packager resolves
them through `../` and includes them in `Contents/Resources/licenses/`. Local
signing is for personal use. CI packages are distributed through Draft releases
until the maintainer publishes them.

See [dependencies.md](dependencies.md) for the historical dependency audit and its limits.
