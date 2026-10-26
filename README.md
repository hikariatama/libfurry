<img src="https://github.com/user-attachments/assets/b937aa26-7726-48a5-a8e0-017015e2af4c" width="200" alt="libfurry" />

![vibecoded](https://img.shields.io/badge/vibecoded-545454)
[![open-source](https://img.shields.io/badge/open--source-545454)](LICENSE)
[![release](https://img.shields.io/badge/release-tag--v0.0.1-377f86)](https://github.com/hikariatama/libfurry/releases/tag/v0.0.1)
[![CI](https://github.com/hikariatama/libfurry/actions/workflows/ci.yml/badge.svg)](https://github.com/hikariatama/libfurry/actions/workflows/ci.yml)
[![AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-545454)](LICENSE)

> An e621 gallery for macOS. Tag search, grid and media viewer in one window.

<img src="https://github.com/user-attachments/assets/fcc0c134-069f-4e23-b356-7acb1504123c" width="100%" alt="libfurry screenshot" />

## Download

<table>
  <thead><tr><th>Platform</th><th>Download</th></tr></thead>
  <tbody>
    <tr><td>macOS · Apple Silicon</td><td><a href="https://github.com/hikariatama/libfurry/releases/download/v0.0.1/libfurry-macos-arm64.dmg"><img alt="DMG Apple Silicon" src="https://img.shields.io/badge/DMG-Apple%20Silicon-377f86" /></a> <a href="https://github.com/hikariatama/libfurry/releases/download/v0.0.1/libfurry-macos-arm64.zip"><img alt="ZIP Apple Silicon" src="https://img.shields.io/badge/ZIP-Apple%20Silicon-545454" /></a></td></tr>
    <tr><td>macOS · Intel</td><td><a href="https://github.com/hikariatama/libfurry/releases/download/v0.0.1/libfurry-macos-x64.dmg"><img alt="DMG Intel" src="https://img.shields.io/badge/DMG-Intel-377f86" /></a> <a href="https://github.com/hikariatama/libfurry/releases/download/v0.0.1/libfurry-macos-x64.zip"><img alt="ZIP Intel" src="https://img.shields.io/badge/ZIP-Intel-545454" /></a></td></tr>
  </tbody>
</table>

CI replaces the draft for this version on rebuild. Before publication, maintainers can download it from [Releases](https://github.com/hikariatama/libfurry/releases). Checksums: `SHA256SUMS.txt`.


## Development

Requires Node.js 22.18+ and npm. Run commands in `app/`.

```sh
cd app
npm ci
npm run dev
```

## Checks

```sh
cd app
npm run check
```

## Packaging

```sh
cd app
npm run package:mac
```

The first launch opens `order:hot` with all ratings. Select **Safe** or add `rating:safe` to your query to filter results.

[Development](app/docs/development.md) · [Architecture](app/docs/architecture.md) · [Features](app/docs/reference.md) · [Third-party licenses](third_party/)
