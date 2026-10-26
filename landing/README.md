# libfurry landing page

A static project page using HTML, CSS and JavaScript, with English copy and no
build step or dependencies. It fits on one screen: a header with download and
GitHub links, a noninteractive application window with a Masonry grid, and a footer.
The window follows `app/src/styles.css`; grid spacing and radii follow `app/src/gridLayout.ts`.

**Download for macOS** opens the [latest release](https://github.com/hikariatama/libfurry/releases/latest),
which contains DMG and ZIP packages for Apple Silicon and Intel.

## Preview

Relative paths require a static server, for example:

```sh
python3 -m http.server 4321 --bind 127.0.0.1 --directory landing
```

Open `http://127.0.0.1:4321/`. To publish, serve the contents of `landing/` as they are.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Header, application-window markup and footer |
| `styles.css` | Page styles and adapted application styles |
| `main.js` | Masonry layout and artwork aspect ratios |
| `media/` | App icon, logos, interface icons and artwork |

## Sources

The logo and `media/icons/` were copied from `app/public/`.
`media/icon.png` is a reduced copy of `app/assets/AppIcon.png`;
`media/avx.svg` is the avx.so logo. Hugeicons are used under MIT;
see `third_party/` for attribution.

Artwork in `media/posts/` consists of sample images from e621 posts matching
`rating:safe drunk_ferret -tarot`, retrieved on October 26, 2026 and resized to 960 px.
The artist retains the rights; the source does not specify a reuse license.
Before publishing, confirm the artist's permission or replace the images.

| File | Post | Artist |
| --- | --- | --- |
| `6345112.jpg` | [e621.net/posts/6345112](https://e621.net/posts/6345112) | drunk_ferret |
| `4855031.jpg` | [e621.net/posts/4855031](https://e621.net/posts/4855031) | drunk_ferret |
| `5349222.jpg` | [e621.net/posts/5349222](https://e621.net/posts/5349222) | drunk_ferret |
| `4776847.jpg` | [e621.net/posts/4776847](https://e621.net/posts/4776847) | drunk_ferret |
| `4750735.jpg` | [e621.net/posts/4750735](https://e621.net/posts/4750735) | drunk_ferret |
| `4712169.jpg` | [e621.net/posts/4712169](https://e621.net/posts/4712169) | drunk_ferret |
| `4720198.jpg` | [e621.net/posts/4720198](https://e621.net/posts/4720198) | drunk_ferret |
| `4659316.jpg` | [e621.net/posts/4659316](https://e621.net/posts/4659316) | drunk_ferret |
| `4136320.jpg` | [e621.net/posts/4136320](https://e621.net/posts/4136320) | drunk_ferret |
| `4477910.jpg` | [e621.net/posts/4477910](https://e621.net/posts/4477910) | drunk_ferret |
| `4322983.jpg` | [e621.net/posts/4322983](https://e621.net/posts/4322983) | drunk_ferret |
| `4066634.jpg` | [e621.net/posts/4066634](https://e621.net/posts/4066634) | drunk_ferret |
| `3019615.jpg` | [e621.net/posts/3019615](https://e621.net/posts/3019615) | drunk_ferret |
| `4062855.jpg` | [e621.net/posts/4062855](https://e621.net/posts/4062855) | drunk_ferret |
| `4112137.jpg` | [e621.net/posts/4112137](https://e621.net/posts/4112137) | drunk_ferret |
| `6704736.jpg` | [e621.net/posts/6704736](https://e621.net/posts/6704736) | drunk_ferret |
| `4590276.jpg` | [e621.net/posts/4590276](https://e621.net/posts/4590276) | drunk_ferret |
| `4068435.jpg` | [e621.net/posts/4068435](https://e621.net/posts/4068435) | drunk_ferret |
| `4108245.jpg` | [e621.net/posts/4108245](https://e621.net/posts/4108245) | drunk_ferret |
| `5232738.jpg` | [e621.net/posts/5232738](https://e621.net/posts/5232738) | drunk_ferret |
