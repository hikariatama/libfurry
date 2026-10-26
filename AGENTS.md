# Working on libfurry

## Project scope

The main application is Electron + React + TypeScript in `app/`; run npm commands there.
`landing/` is the static project page. Keep the repository focused on these two
components; do not add archived implementations or reference checkouts.

Read `README.md`, `app/docs/architecture.md` and `app/docs/development.md` before
changing the relevant application code. Application paths below are relative to `app/`.

`landing/` has no build step or dependencies: it contains HTML, CSS and JavaScript.
Its layout follows `app/src/styles.css`; update the landing page alongside substantial
interface changes. Artwork in `landing/media/posts/` belongs to its creators;
`landing/README.md` records the source of each image.

## Commands and boundaries

- Install dependencies with `npm ci`, using Node.js >= 22.18.0.
- Run `npm run check` to validate without building or launching the application.
- Individual checks: `npm run lint`, `npm run typecheck`, `npm test`.
- Tests use Node.js, mocked Electron/API responses and temporary directories.
  Preserve that isolation; do not use a real account, Keychain or application profile.
- Do not run `npm run dev`, `npm start`, builds, packaging, signing, browser fixtures
  without authorization for that action. Do not close or restart an open application.
- `npm run package:mac:local` creates a Keychain certificate and signs the `.app`.
  It changes the system and is not a source-only check.
- Preserve user instructions and existing uncommitted changes. Preparing a repository
  for publication does not authorize commits, pushes or GitHub releases.

## Code and responsibilities

- Use two spaces, LF and the existing file style. Do not add dependencies or reformat
  the whole project for a local change.
- The renderer (`src/`) must not access Node.js, the filesystem or API keys.
  System operations use the typed `E322Bridge` in `src/types.ts`, `electron/preload.cjs`
  and validated handlers in `electron/main.cjs`.
- Preserve `contextIsolation`, sandboxing, CSP, IPC sender validation and allowed
  HTTPS media URLs. Do not bypass the shared request queue in `e621.cjs`.
- Track request and account generations across account changes. A stale response
  must not restore old credentials or apply another account's reaction.
- Grid geometry, post IDs and scroll position must survive page eviction,
  snapshot restoration, filtering and column-count changes.
- Preserve atomic writes, download size/MD5 checks and damaged settings originals.
  Never silently report storage errors as success.
- Test observable behavior and contracts rather than implementation strings.
  Do not present browser-fixture measurements as installed-application measurements.

## Publication and documentation

- Keep README files, documentation, release descriptions and developer-facing messages in English.
- Never commit keys, cookies, account settings, real API responses, personal paths,
  certificates or local screenshots. Use synthetic test data; `*.local.json` stays local.
- Preserve `LICENSE`, `third_party/` attribution and required license comments.
  Record the source and license of each new third-party resource.
- Do not commit generated `dist/`, `release/`, `build/`, `.build/` or dependencies.
  Do not delete the `.app` from which a running application was launched.
- Report completed checks and unverified limits. Claim builds, launches, signing
  and real-account behavior only when actually verified.
- Do not announce the use of deslopify in user messages.
