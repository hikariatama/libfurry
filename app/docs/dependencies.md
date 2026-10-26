# Dependency audit

This is a snapshot of `npm audit` from October 19, 2026. It does not establish that
the application or its future dependencies are free of vulnerabilities.

## Applied fixes

A compatible update using `npm audit fix --ignore-scripts` changed three development
packages and the lockfile without running lifecycle scripts or building the application:

- `concurrently`: 9.2.4 → 9.2.5.
- `shell-quote`: 1.9.0 → 1.12.0; addressed a possible
  [command injection](https://github.com/advisories/GHSA-pqg4-j6r4-53mv).
- `http-cache-semantics`: 4.2.0 → 4.3.0; addressed a
  [max-stale handling issue](https://github.com/advisories/GHSA-ch52-4w7c-c8xp).

After the update, `npm run check` passed on Node.js 26.12.0: ESLint, TypeScript
with `--noEmit` and 92 tests. Building, signing and launching the `.app` were not tested.
Node.js 22 and 24 checks were configured in GitHub Actions but were not part of that local run.

## Remaining limitation at the time of the audit

The full `npm audit` reported **8 moderate findings** in one development-tool chain
related to [a sprintf-js DoS](https://github.com/advisories/GHSA-hp3w-g68c-fv3c):

`electron-builder → app-builder-lib → @electron/get → global-agent → roarr → sprintf-js`.

The report also included `dmg-builder` and `electron-builder-squirrel-windows`.
These were eight affected packages, not eight separate vulnerabilities.
The audit did not list a fixed `sprintf-js` version. Its suggested
`npm audit fix --force` would replace pinned `electron-builder` 26.15.3 with 26.5.0.
That downgrade was not applied: packaging and local-signing compatibility require
separate authorized build verification.

`npm audit --omit=dev` reported **0 findings**. This covers the npm dependency tree
without devDependencies and does not establish the safety of the Electron binary.

To repeat the audit:

```sh
npm audit
npm audit --omit=dev
```

Do not use `--force` without assessing the dependency-tree change and verifying
packaging. Run `npm run check` after dependency updates; current audit results may
differ from this historical snapshot.
