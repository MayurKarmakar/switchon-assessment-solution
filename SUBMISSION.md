# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

Paste your Loom (or equivalent) link here. 5–10 minutes.

**Link:** https://drive.google.com/file/d/1FkruPlWreMtl9D-Q2BB2eHoLI4biYZAD/view?usp=drive_link

---

## How to run it

Anything we need to know beyond "npm install && npm run dev".

Requires Node.js 20.11 or newer. No additional setup is required.

**Repository:** https://github.com/MayurKarmakar/switchon-assessment-solution

**Deployed app:** https://switchon-assessment-solution-production.up.railway.app/

The only added command is shown below. Run it after the existing
"npm run build" command.

```bash
npm start
```

The fresh-clone check was run on Macbook air. "npm install && npm run dev"
started the frontend and API from "main". The "/api/health" response reported
12,400 assets with "chaos:true" and "latency:true".

## Time spent

Approximately 13.5 focused hours before recording the walkthrough.

- Task 0 — baseline review and defect inventory (1 hour)
- Task 1 — search correctness (2 hours)
- Task 2 — scalable asset list (2.5 hours)
- Task 3 — bulk operations and conflict recovery (4 hours)
- Required performance measurements and final verification (2 hours)
- Deployment and delivery documentation (2 hours)

---

## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | A slower, earlier search response could replace results for the current query. | `src/features/assets/useAssets.ts` | Fixed |
| 2 | Requests that no longer mattered continued running. | `src/api/client.ts`, `src/features/assets/useAssets.ts` | Fixed |
| 3 | Every search keystroke triggered an API request, making the rate limit easy to hit. | `src/App.tsx` | Fixed |
| 4 | Identical concurrent queries started separate network requests. | `src/features/assets/useAssets.ts` | Fixed |
| 5 | Search, filter and sort state was not represented in the URL, so reloads and shared links lost the current view. | `src/features/assets/useAssetFilters.ts`, `src/lib/asset-query.ts` | Fixed |
| 6 | Kind and tag filtering required by the API contract had no controls or query-state integration. | `src/App.tsx`, `src/features/assets/useAssets.ts` | Fixed |
| 7 | Loading, empty and error states could overlap, so a failed request could look like a valid empty result. | `src/App.tsx`, `src/features/assets/AssetGrid.tsx` | Fixed |
| 8 | The API client reduced failures to strings and discarded status, error code, request ID and retry metadata. | `src/api/client.ts` | Fixed |
| 9 | The asset list ignored "nextCursor" and stopped after the first page. | `src/features/assets/useAssets.ts` | Fixed |
| 10 | The grid rendered every supplied asset, so its DOM would grow with every appended page. | `src/features/assets/AssetGrid.tsx` | Fixed |
| 11 | Changing one selection re-rendered every mounted card. | `src/App.tsx`, `src/features/assets/AssetGrid.tsx` | Fixed |
| 12 | Opening the detail panel changed the grid width and scroll geometry. | `src/styles.css` | Fixed |
| 13 | Thumbnails loaded eagerly, ignored "hasThumbnail", and had no stable fallback after failure. | `src/features/assets/AssetGrid.tsx`, `src/features/assets/AssetDetail.tsx` | Fixed |
| 14 | Bulk updates sent the full selection in one request, exceeding the 50-ID API limit. | `src/App.tsx` | Fixed |
| 15 | Selection had no loaded-set or Shift-click range behavior. | `src/App.tsx`, `src/features/assets/AssetCard.tsx` | Fixed |
| 16 | Bulk writes left list caches stale and reduced per-item failures to aggregate counts. | `src/App.tsx` | Fixed |
| 17 | Failed bulk items could not be identified, selectively rolled back, or retried by failure type. | `src/App.tsx` | Fixed |
| 18 | A detail "409 version_conflict" became a generic error with no safe recovery path. | `src/features/assets/AssetDetail.tsx` | Fixed |
| 19 | Transient "429", "503" and network failures have no capped exponential-backoff policy with jitter or "Retry-After" support. | `src/api/client.ts` | Knowingly left — Task 4 cut |
| 20 | The app does not pause requests or provide a dedicated recovery state when connectivity is lost. | `src/App.tsx`, `src/api/client.ts` | Knowingly left — Task 4 cut |
| 21 | A component render failure can blank the interface because there is no recovery error boundary. | `src/main.tsx` | Knowingly left — Task 4 cut |
| 22 | Asset cards and the virtualized grid have no roving keyboard model, and the detail panel does not manage focus. | `src/features/assets/AssetCard.tsx`, `src/features/assets/AssetGrid.tsx`, `src/features/assets/AssetDetail.tsx` | Knowingly left — Task 5 cut |
| 23 | Grid selection semantics, checkbox names and live announcements for results and outcomes are incomplete. | `src/App.tsx`, `src/features/assets/AssetCard.tsx`, `src/features/assets/AssetGrid.tsx` | Knowingly left — Task 5 cut |

---

## Key decisions

For each significant choice, explain what you did, what you rejected, and why.
Three to six of these is about right.

**Data fetching and caching**

I used TanStack Query and included the normalized filters in the cache key.
Task 1 uses that key to cancel obsolete work, share matching requests and stop a
late response from replacing the active results. Task 2 keeps the cursor pages
for one filter set together with "useInfiniteQuery". I rejected a custom promise
map and cursor accumulator because I would then own the cache, cancellation and
page lifecycle code. The libraries add dependencies and bundle weight. The
application still owns URL rules, debounce timing, retry policy and interface
states.

**Stale response handling**

Search waits 300 ms after typing stops before it starts a request. This avoids a
request for every key press without making the search feel delayed. When the
normalized query changes, the old fetch is cancelled with "AbortSignal". The
complete query is also part of the cache key, so a late response stays with its
original query and cannot replace the active view. While a search is pending,
the UI hides results from the previous query instead of showing them under the
new search text.

**Virtualization approach**

I used TanStack Virtual with responsive lanes, fixed card sizes and about two
rows of overscan. Only visible and nearby cards are mounted. Native lazy loading
limits image work inside that range. I rejected a custom virtualizer because I
would have to maintain resize handling, card placement, overscan and scroll
position myself. Task 2 increased the production JavaScript by 8.53 kB gzip.

**Optimistic updates and rollback**

I apply the requested status to the active TanStack Query cache before the
requests settle. First, I cancel list fetches that could overwrite that change.
The operation saves the original target assets, sends groups of at most 50
and runs two requests at a time. It keeps returned assets for successes and
restores only the failures. I rejected a component-local overlay because every list and detail
reader would need to merge a second state layer. When a status filter or
"updatedAt" ordering can change the result order, the active list resets to one
page and refetches. This gives up loaded depth to keep cursor boundaries correct.

**Retry and backoff policy**

Task 3 retries only items returned with a "conflict" result. Items returned as
"legal_hold" or "not_found" stay selected with their exact reasons. If a whole
request fails, its group is restored without removing successful changes from
other groups. I rejected undo because it would be another write that could also
fail. Automatic retries remain part of the cut Task 4 work, where attempt caps,
jitter, offline pausing and "Retry-After" need one shared policy.

**State placement and URL sync**

The committed "q", status, kind, tag and sort values live in the URL and pass
through one parser and normalizer. Search updates replace the current history
entry, so typing does not create a Back step for every character. Deliberate
filter and sort changes add history entries, which lets Back undo them. Only the
immediate search draft stays in component state. I used the History API instead
of adding a router because the application has one screen. Cursors stay inside
the normalized query cache, so a filter change starts without a cursor from an
older query.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser.

Measured on Macbook air in Chrome 153 with no CPU or network throttling. Task 2
scale measurements used a production build with "CHAOS=0" and "LATENCY=0" to
remove backend variability.

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | Not measurable because the starter stopped at 50 | 613 nodes, including 60 cards | Loaded 5,000 assets and counted document nodes and mounted cards through Chrome CDP. |
| Cards re-rendered when toggling one selection | Not reliably comparable because the starter had no card component boundary | 1 of 60. No unrelated cards | A React commit hook counted "AssetCard" renders for one checkbox change. |
| Longest task during sustained scroll | Not measurable at 5,000 because the starter stopped at 50 | 10.26 ms. No tasks over 50 ms | Worst of three 10-second Chrome CDP traces after 5,000 assets loaded, with no page requests. |
| Requests fired while typing a 6-character query | 6 | 1 | Typed "travel" in the original and updated builds and counted the resulting "/api/assets?q=…" requests in the Chrome CDP Network log. |
| Production bundle, gzipped | 48 kB reference supplied in the README | 70.87 kB | "npm run build". JavaScript gzip size from the Vite production output. |

What was the actual bottleneck, and how did you find it?

**Requests fired while typing a 6-character query**

The measured bottleneck was request amplification. Each search input event
started another "/api/assets" request. The Chrome CDP Network log showed one
request for every character in "travel". A 300 ms trailing debounce reduced the
six requests to one.

**Rendered DOM nodes at 5,000 rows loaded**

Source inspection found that the grid directly rendered every supplied asset,
so cursor pagination would increase its DOM on every page. Viewport
virtualization kept the measured result to 613 DOM nodes and 60 mounted cards
with 5,000 asset records loaded.

**Cards re-rendered when toggling one selection**

Source inspection showed that selection replaced the parent "Set" and rebuilt
card markup for the visible grid. A memoized card boundary, simple per-card
values and stable callbacks reduced the measured update to the changed card.

---

## Accessibility

- **Keyboard model.** Task 5 was deliberately cut, so I did not implement the
  requested virtual-grid keyboard model. Native inputs, selects, checkboxes and
  buttons retain their browser keyboard behaviour, but asset cards remain
  pointer-activated elements.
- **Testing.** I did not perform a screen-reader test or claim a complete
  keyboard-only acceptance pass. Feature verification exercised the native
  controls, not the unimplemented grid navigation model.
- **Known gaps.** The grid has no roving tab index, Arrow-key navigation,
  Enter-to-open, Space selection or Shift+Arrow range extension. Opening and
  closing the detail panel does not manage focus, and result and bulk updates do
  not have the requested live-region announcements.

---

## Interface decisions

The interface work focused on truthful request feedback, stable list geometry
and recoverable partial failure. Search and related filters stay together.
Pagination feedback leaves loaded assets usable. Bulk progress locks conflicting
controls while read-only inspection remains available. Outcome rows keep failed
assets and their recovery action close to the bulk controls.

- **Visual system.** Existing colour tokens, system typography and spacing remain
  in `src/styles.css`. Fixed card bodies and 16:10 thumbnail frames keep the
  virtual grid predictable, and bulk controls wrap at narrow widths.
- **Status treatment.** Cards, filters and status actions use text labels for all
  four statuses, so their meaning does not depend on colour. The selected target
  status is also stated in the bulk result.
- **States.** Initial loading, successful empty results and initial errors are
  mutually exclusive. Next-page failure preserves loaded cards. Bulk progress
  disables competing writes. Partial failure lists each asset and reason, keeps
  failures selected and offers conflict-only retry. A detail conflict loads the
  latest version before offering an explicit reapply. A dedicated offline state
  was cut with Task 4. Rejected requests use connection-specific failure copy.
- **Contrast.** WCAG relative-luminance calculations checked the modified text,
  feedback and focus colours. The lowest measured ratio was 5.26:1.
- **Copy.** Raw API failures were replaced with actionable messages. Bulk rows
  name the failed asset and reason. Detail conflicts distinguish “review and
  reapply” from “the latest version already matches.”

No repository screenshots are included. The deployed interface is linked above.

---

## Trade-offs and cuts

- I stopped after Task 3. Other interviews and take-home deadlines overlapped
  this one, and I did not want to move through the remaining tasks with AI faster
  than I could understand, test and defend the result. I followed the brief's
  priority order and kept the work I could explain and debug. Task 4 resilience,
  the Task 5 keyboard and screen-reader work, and the dedicated Task 6 visual
  pass were cut. With another day, I would take them in that order.
- The final JavaScript bundle is 70.87 kB gzip against the README's 48 kB
  reference. TanStack Query and TanStack Virtual replace custom request,
  pagination and viewport infrastructure, but the total delta also includes the
  Tasks 1–3 application code and is not attributed entirely to those libraries.
- Virtualization limits mounted cards, not records held in memory. Fetched pages
  remain cached, so memory grows with deliberate scrolling even though the DOM
  stays bounded. I would measure heap use before adding page eviction because it
  would also complicate cursor and scroll restoration.
- The detail panel overlays the right side of the grid while open. This preserves
  grid dimensions and scroll position at the cost of temporarily covering cards.
- Bulk requests use concurrency two. This accepts more waiting than a higher
  limit, but caps simultaneous server work at 100 IDs and reduces rate-limit and
  load pressure.
- Status-filter changes and "updatedAt" ordering reset the active list to page
  one after a successful write. This preserves cursor correctness at the cost of
  loaded depth and scroll position.
- Detail conflicts require review and an explicit reapply. With default
  deployment latency, the conflict message can take two to three seconds to
  appear while the latest version is reconciled. The wait and extra action keep
  a stale view from silently overwriting a newer decision.

## Critique of the API

Bulk writes return useful per-ID outcomes, but there is no idempotency key or
operation-status endpoint. If a write response is lost, the client cannot know
whether replay is safe without reading current state. I would add an idempotency
key and a retrievable operation result.

Status writes also change "updatedAt", while list pagination uses opaque cursors.
The contract does not expose a stable snapshot or a way to repair affected page
boundaries, so the client must discard loaded depth and refetch page one when a
write can change active membership or ordering.

## Anything you would like us to look at

The range-selection model in `App.tsx` works across unmounted virtual cards and
supports inward resizing from a stable anchor. `bulkAssetStatus.ts` bounds
request concurrency, while `assetCache.ts` keeps optimistic success, selective
rollback and cursor-safe reconciliation separate. The detail conflict flow is
also deliberate. It reloads the latest version before allowing reapplication.
