# libfurry architecture

## Processes and data

The product is named `libfurry`. For compatibility with existing installations,
it retains `appId: local.e322.mac`, the `e322` data directory, the `window.e322`
preload API and the existing `e322 Local Signing` identity. Renaming the product
does not create a new profile or move user files.

The Electron main process creates the window and system menu. The renderer uses
`nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`. Files,
credentials, system dialogs and APIs are available only through `electron/preload.cjs`.

`electron/services/e621.cjs` sends API requests sequentially, at least 1.1 seconds
apart. Search responses are cached as JSON on disk. Guest searches use ETag;
a temporary network failure or a 5xx response may fall back to the last saved
response. Cache fallback does not hide authorization, invalid-request, response-format
or disk-write errors. The request and cache account are fixed when a search starts,
even if login or logout happens before the response arrives. Authenticated searches
refresh upvote and favorite states. Each received page has a separate snapshot for
restoration after memory eviction. Search responses are pruned above 512 MiB or
30 days; old page snapshots are pruned separately.

Settings live in the application data directory. API keys are encrypted through
Electron `safeStorage`, backed by macOS Keychain. Key writes and deletions are
serialized; a later login or logout invalidates an older result. New account
actions are blocked during an account change. A stable application signature
prevents repeated macOS key-access prompts across builds. The default local build
is not signed with a developer certificate.

The gallery starts without waiting for Keychain or account validation. Account
restoration starts after the first search response, or after three seconds if no
search has started. Credentials are applied to API requests only after successful
profile validation. The main process reports the result to the renderer. Near the
top of the grid, search refreshes immediately. After a long scroll, open pages are
rebuilt in the background for the new account; the old search stops loading pages
until this completes. The grid returns to the same post or the nearest surviving
post. The viewer receives fresh data if its post remains in the results. If a
reaction or blacklist hides the open post, account actions remain disabled in
the viewer until it closes. A failed refresh can be retried by searching manually.

If settings or download-history JSON cannot be read, the original file is moved
to `.damaged-…`. The application then uses defaults and displays the backup path.
If that move fails, writes for that data type stay blocked until file access is
repaired. Runtime write errors also appear in settings and clear after a successful save.

## Search and grid

`electron/services/search-session.cjs` stores the search session separately in
`session.json`: committed query, search-field draft, rating, account ID, cursors,
page-snapshot keys, card geometry, local reactions and a scroll anchor (post ID
and offset). It does not duplicate full posts or media. On the next launch the
grid restores geometry immediately and loads visible and adjacent page data
from existing snapshots. This also preserves position across window-width changes.
Missing snapshots use the existing search retry/refresh path.

Writes are atomic and serialized, debounced by 500 ms after scrolling or state
changes stop. On close, the window requests the latest session from the renderer
and waits for the write. If the renderer does not respond within two seconds,
the window closes with the last saved session. Corrupt files are preserved as
`.damaged-…`, with an error in settings. Saved-session snapshots are protected
from pruning independently of current-grid snapshots; protection changes only
after a new session is saved successfully. Account changes rebuild results using
the existing mechanism without transferring the old account's local reactions.
**To the top** cancels pending position restoration and saves the start of the feed.

`src/App.tsx` holds the query, cursors, pages, selected post and panel state.
The initial query is `order:hot`. `order:` sorting uses numbered pages up to
e621's limit, except `order:id_desc`, which uses the `b<ID>` cursor like ordinary
search. `order:id` sorts ascending and also uses numbered pages. Tag suggestions
are requested by prefix; repeated prefixes are cached briefly in memory.

`src/GalleryGrid.tsx` virtualizes rows for Apple and Squares layouts, and items
across multiple columns for Masonry. Geometry is derived from post aspect ratios
before images arrive. In Apple layout, an incomplete final row stays a skeleton
until the next page fills it or the search ends, so visible images do not resize
when cards are added. Next-page metadata is requested about 75 rows before the
end; evicted page data is restored within 75 rows above and below the viewport.
Previews are prepared only within 25 rows above and below. One queue loads at most
64 images concurrently, prioritizing the viewport and scroll direction. Visible
cards show skeletons until previews are ready, then fade in their images.
Skeleton animation pauses during scrolling.

Watched-tag refresh searches by descending ID (`order:id_desc`), collects IDs
newer than the last checkpoint, and stops at that checkpoint. IDs viewed between
checks are tracked separately, preventing them from being counted as unread
without skipping other new posts. Old viewed IDs are removed after a check;
older settings are migrated from an ID list to a checkpoint. Existing watched
tags have no preset page limit. Closing the panel cancels refresh. A newly
watched tag starts from the first search page.

During long scrolls, full post objects are evicted from distant pages after
24 loaded pages accumulate. Batched eviction reduces rebuilding of the combined
card array during scrolling. IDs, aspect ratios, reaction states and snapshot
keys remain in memory. Current-session snapshots are protected from cache pruning.
Returning restores pages from disk. A corrupt snapshot can be recovered from the
search cache or API only if its contents match the original. A changed page is
not substituted: the application asks the user to refresh search. Failed
restoration shows a retry action on the card. Normal page-body eviction and
restoration do not rebuild row layout or the post index. Layout and column-count
changes preserve the visible post. Blacklist changes refilter saved pages and
return to the visible post. Watched-tag refresh stops when its panel closes.

## Viewer and actions

`src/Viewer.tsx` displays images, tags, pools and details in the same window.
`src/detailLoader.ts` fetches full details and cancels stale requests. MP4 and
WebM use Electron's video element; GIF and APNG start after **Play**. Image zoom
is anchored to the gesture position; dragging pans the image.

`electron/services/downloads.cjs` runs up to two downloads concurrently. The
original is written to a temporary `.part` in the selected folder, checked
against its expected size and MD5 when available, then atomically linked to its
final filename. Repeated downloads validate the existing file in the same way.
Cancellation removes the temporary file; after a crash, remaining `.part` files
are cleaned on the next launch. The latest 100 completed jobs are stored on disk;
interrupted jobs are marked as errors after restart. Combined actions report
download, upvote and favorite results separately.

A combined action captures the account generation at launch and checks it before
each account operation. If the account changes during saving, the file is kept,
while upvote and favorite are skipped with separate errors.

## Verification limits

`tests/fixtures/grid.html` reproduces scrolling and grid resizing with synthetic
posts. It also covers restoration failures and unavailable-key messages. On
October 3, 2026, a static build scrolled continuously for 5 minutes 23 seconds,
reaching 142 pages without reloading. It ended with 112 cards and 391 DOM nodes;
the first card restored after returning to the top. This did not measure real
e621 images. Tests cover filtering, caching, page restoration, cancellation and
file saving. Real upvotes and favorites modify an account and require a selected
test post. Signing requires a macOS code-signing certificate.
