# Working on libfurry

## Build and check

- The Electron/React/TypeScript application is in `app/`; run npm commands there. `landing/` is a static site without a build step.
- Use Node.js 22.18+ and `npm ci`. Keep `package.json` and its lockfile consistent. Run `npm run check` for lint, TypeScript and isolated Node tests.
- `npm run build` builds the renderer. Package with `npm exec -- electron-builder --mac dmg zip --arm64 --publish never` or `--x64`; ordinary packaging must not discover signing certificates.
- Local signing changes Keychain and requires explicit authorization. Never close or overwrite the application from which a running instance was launched.
- Tests must use mocked Electron/API responses and temporary directories, without a real account, Keychain or the user's downloads/profile. Browser fixtures and installed-app checks are different evidence.
- Use two spaces, LF and existing module conventions. Update `E322Bridge`, preload and main handlers together when changing IPC.

## Security and behavior

- Keep network, filesystem, dialogs and API keys in the main process. The renderer uses the typed preload bridge with context isolation, sandboxing and no Node integration.
- Preserve CSP, IPC sender/schema validation and denied unused Chromium permissions. API redirects stay on the allowed HTTPS origin; account mutations do not redirect. Validate each media redirect before connecting.
- Preserve the serial API scheduler and rate interval, bounded bodies/queues/caches, cancellation and visible saturation errors. Never bypass admission limits with an alternate request path.
- Store API keys with safeStorage. Serialize credential writes/deletes and validate account intent immediately before committing. Late work must not restore credentials or apply another account's reactions.
- Preserve search geometry, post IDs, scroll anchors and snapshot identity across eviction, account changes, filtering and layout changes. Do not substitute a changed API page for a missing original snapshot.
- Preserve saved-session snapshots until a replacement session is committed. Keep corrupt settings/history originals; block writes if preserving the original fails.
- Downloads use temporary files, size/MD5 validation and atomic finalization. Report download and account-action outcomes separately; account changes must stop stale authenticated actions.
- Preserve current app/profile/preload identifiers so existing accounts, settings and sessions remain usable. Identifier changes require an explicit data migration.
- The first launch uses `order:hot` and all ratings; keep the explicit Safe filter. Preserve existing controls and independent grid/viewer state.
- Keep landing visuals consistent with the application. Preserve `third_party/`, included license resources and artwork source attribution.

## Repository and releases

- Keep current development instructions in this file; do not add a documentation archive or a `docs/` directory.
- Keep README files concise and user-facing. Preserve licenses, third-party notices and asset attribution.
- Use synthetic fixtures. Never commit credentials, account data, private profiles, databases, local diagnostics, dependencies or build products.
- Keep one commit per version on `main`, named `vX.Y.Z`, with the matching version tag. Do not invent versions for repository maintenance.
- Published history, tags and assets may be replaced only with explicit owner authorization. Report source checks, builds, publication and deployed behavior separately.
- Keep deployment mirrors on the same reviewed source commit. A Git push does not authorize deployment or installation.
