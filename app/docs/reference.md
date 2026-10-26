# libfurry

An [e621](https://e621.net/) gallery for macOS, built with Electron, React and
TypeScript. Tag search, a virtualized grid and media viewing share one window,
with mouse, trackpad and keyboard controls.

The first launch opens `order:hot` with all ratings. Later launches restore the
last query and feed position. Results may include adult content. Select **Safe**
in the rating filter or add `rating:safe` to your query to filter results.

## Features

- Tag suggestions, search history, disk cache and pagination; query and scroll
  position persist across launches. **To the top**, beside **Downloads**, returns to the start.
- Apple, Squares and Masonry layouts with adjustable column counts. Geometry is
  calculated before previews load; distant pages are evicted and restored on return.
- Images with zoom, MP4/WebM playback and GIF/APNG animations started with **Play**;
  tags, pools, link copying and opening posts in the browser.
- Watched tags with unread-post counts.
- Account blacklist synchronization and temporary local disabling of rules.
- Username/API-key login, upvotes and favorites.
- Original downloads to a selected folder, with a queue, progress, cancellation,
  size/MD5 validation and history. **Save +** downloads, upvotes and favorites,
  reporting each step separately.
- System, light and dark themes.

Browsing and downloads work without an account. Posts you upvoted or favorited
are hidden from ordinary search; positive `votedup:`, `upvote:`, `fav:` and
`favoritedby:` conditions explicitly include them.

## Running from source

Requires macOS, Node.js **22.18.0 or later** and npm. CI packages Apple Silicon
and Intel builds; other operating systems are not verified for this application.
The Electron version does not require Homebrew, Xcode or libmpv. Run commands
inside `app/`:

```sh
cd app
npm ci
npm run dev
```

`npm run dev` starts Vite on `127.0.0.1:5173` and opens Electron. Restart development
mode after changing the main process or preload.

## Checks

```sh
npm run check
```

This runs ESLint, TypeScript with `--noEmit` and Node.js tests. It does not build
or open the application and does not access a real account or Keychain. GitHub
Actions runs these checks on Node.js 22 and 24.

Packaging-tool audit findings and their historical limits are documented in
[dependencies.md](dependencies.md). See [development.md](development.md) for the
fixture, individual checks and contribution workflow.

## macOS packaging

```sh
npm run package:mac
```

Output: `app/release/mac-arm64/libfurry.app`. This produces a local ARM64 build
without developer-certificate signing, notarization or publication. `npm start`
opens the existing `app/dist/`; it does not build it.

After checks pass, GitHub Actions builds DMG and ZIP packages on native Apple
Silicon and Intel runners. Download `libfurry-macos-arm64` or `libfurry-macos-x64`
from the CI run's **Artifacts** section; artifacts are retained for 14 days.
Pushes, pull requests and manual workflow runs build packages. Missing packages
fail the build. Main-branch and matching version-tag runs create or replace a
Draft release with those files and `SHA256SUMS.txt`. Pull requests do not release.

These packages have no Developer ID signature or notarization, so macOS may
block a downloaded application. Drafts are available to maintainers until publication.

For repeat builds on your own Mac, optional local signing is available:

```sh
npm run package:mac:local
```

This builds the application, creates a self-signed **e322 Local Signing**
certificate in the user's Keychain and signs the `.app`. The private key stays
in Keychain. The fingerprint is saved in
`~/Library/Application Support/e322/local-signing.sha1`. The script refuses to
silently replace a missing or changed certificate. To sign an existing build,
run `npm run sign:mac:local`.

Local signing is for personal use, does not enable Hardened Runtime and does
not replace Developer ID distribution signing. A signature change can cause
macOS to request access to the saved API key again.

## Controls

| Keys | Action |
| --- | --- |
| Arrow keys | Select a card; previous/next post in the viewer |
| Enter / Space | Open the selected post |
| Space / Esc | Close the viewer |
| ⌘L / ⌘R | Search / refresh results |
| ⌘B / ⌘T | Blacklist / watched tags |
| ⌘D / ⌘U / ⌘F | Download / upvote / favorite |
| ⌘S | Download, upvote and favorite |
| ⌘J / ⌘/ | Downloads / keyboard shortcuts |
| C in the viewer | Copy the post link |

## Data and access

Settings, download history, search cache and page snapshots live in the application
data directory, usually `~/Library/Application Support/e322/` on macOS.
`session.json` stores the query, search-field text, rating filter, snapshot
references and visible post with its offset. Position is saved after scrolling
stops and before normal window close; images are not stored in this file.
The directory retains the `e322` name so existing accounts, settings, caches and
sessions survive the rename. Electron `safeStorage` encrypts the API key there
using system Keychain. The renderer never receives the key.

Corrupt settings and history files are preserved with a `.damaged-…` suffix.
If preserving the original fails, writes to that file are blocked. Errors appear
in settings. User data, real API responses and certificates must not enter Git;
`.gitignore` includes rules for them.

## Structure and development

| Path | Purpose |
| --- | --- |
| `app/` | Electron application, package metadata and build/check configuration |
| `app/src/` | React UI, search session, grid, viewer and state logic |
| `app/electron/main.cjs`, `app/electron/preload.cjs` | Window, menus and IPC between UI and system |
| `app/electron/services/` | e621 API, download queue, settings and credentials |
| `app/tests/` | Isolated tests and a browser fixture with synthetic posts |
| `app/public/`, `app/assets/` | UI assets and application icon |
| `app/scripts/` | Icon generation and local signing |
| `app/docs/` | Architecture, development, measurements and dependency audit |
| `landing/` | Static project page without a build step or dependencies |
| `third_party/` | Third-party sources and licenses |

See [architecture](architecture.md) for processes, cache and virtualization;
[performance measurements](performance.md) for observations and limits.
Agent instructions are in [AGENTS.md](../../AGENTS.md).

Run `npm run check` in `app/` before making changes. Bug reports should include
macOS version, architecture, application version, reproduction steps and the
error text. Remove API keys, account names, personal paths and history from logs.

## License and third-party resources

libfurry is licensed under **AGPL-3.0-only**; see [LICENSE](../../LICENSE).

Visual treatments were inspired by [Room237](https://github.com/hikariatama/room237).
`app/public/bg.png` comes from that project under AGPL-3.0;
see [source and attribution](../../third_party/Room237.md). The libfurry grid is
implemented independently using `@tanstack/react-virtual`.

Hugeicons Core Free Icons are used under MIT;
see [license and attribution](../../third_party/Hugeicons.md).
