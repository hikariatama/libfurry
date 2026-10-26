# Scrolling measurements

The current preview-request concurrency limit is 64. The measurements below
predate that change; the effect of the 64-request limit has not been measured.

Measurements on October 4, 2026 used `tests/fixtures/grid.html`, a 1280×720 window
and eight columns. The local, untracked `real-pages.local.json` contained
consecutive e621 response pages from `v2=true&mode=thumbnail`. Each scroll step
moved roughly 720 pixels, with an 850 ms pause between steps. These measured the
grid and network in a browser, not the installed Electron application.

| Scenario | Observation |
| --- | --- |
| 200 steps with synthetic images | Loaded 60 pages, about 9,600 posts; at most 120 cards in the DOM. Four `JSHeapUsedSize` samples: 30.5, 36.1, 17.0 and 17.3 MB. JavaScript time per approximately 44–50 second interval: 2.01, 1.95, 1.86 and 3.11 seconds. |
| Jump back after 60 pages | Old posts retained their positions and IDs; all 48 visible images restored within 3 seconds. |
| 50 steps through new WebP previews, queue size 12 | Visible cards had no ready images in 47 samples. The DOM stayed at or below 112 cards. |
| 50 steps through another new segment, queue size 24 | 44 samples had no ready visible image; higher concurrency did not demonstrate an improvement. |
| Direct visible `<img>` requests alongside preloading | 48 of 50 samples in a new segment had no ready images; this approach was rejected. |

During a separate jump, the network log showed about 20 CDN responses in five
seconds; 16 belonged to the current 40-card viewport. This suggests that new
previews arrived too slowly for that scrolling pace. Limited request preemption
added cancellations without improving the result and was reverted.

Caching changes results substantially: revisiting pages fills the grid much
faster. Comparisons therefore require new pages or controlled cache clearing.
Disabling the browser cache entirely does not represent normal operation because
it forces another image download after preloading.

Skeleton animation now pauses while scrolling and resumes after stopping. This
was checked in the DOM and visually; its GPU impact was not measured. Whole-app
load, account actions and a two-hour session remained unverified in those runs.

Another October 4 run spent about five minutes across 80 pages of real previews
in the same browser fixture. After 40 fast steps, it performed 300 steps with
850 ms pauses, moving about 720 pixels per step. At most 112 cards were mounted.
In the final three 50-step intervals, no preview was ready anywhere in the
viewport in 25, 45 and 36 samples respectively. JS memory at interval ends was
33, 38 and 49 MB; JS time per interval was 3.4, 3.6 and 4.2 seconds. Returning to
the top from about 245,000 pixels restored the original posts and images. This
predated batched page eviction, whose latency effect was not measured.

After batched eviction was introduced, a separate synthetic-image check reached
64 pages and about 154,000 pixels, then returned to the top. The first card kept
its original ID; all 48 visible images restored, with no error cards. An attempt
to execute 240 fast steps in one tool call exceeded the tool limit, so the exact
step count for that run was not established.

A separate built Electron `.app` run lasted 376 seconds. An isolated profile
opened `rating:safe male` and performed 320 downward steps with roughly 850 ms
pauses. Checkpoints every 40 steps showed 104–112 cards in the UI tree and
progressively decreasing post IDs. After 160, 240 and 320 steps, the viewport
was mostly skeletons; after stopping, those same cards gradually filled with
images. Cold-preview throughput limits were reproduced in Electron. Across
180 process measurements, combined RSS was 193–345 MiB (median 283 MiB,
95th percentile 318 MiB); combined CPU usage was 0–98% (median 62%, 95th percentile
83%). These include Electron processes and network activity and do not establish
the absence of a leak in a longer session.
