# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

Paste your Loom (or equivalent) link here. 5–10 minutes.

**Link:**

---

## How to run it

Anything we need to know beyond `npm install && npm run dev`.

Requires Node.js 20.11 or newer. No additional setup is required.

## Time spent

Roughly, and how you split it.

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
| 9 | The asset list ignored `nextCursor` and stopped after the first page. | `src/features/assets/useAssets.ts` | Fixed |
| 10 | The grid rendered every supplied asset, so its DOM would grow with every appended page. | `src/features/assets/AssetGrid.tsx` | Fixed |
| 11 | Changing one selection re-rendered every mounted card. | `src/App.tsx`, `src/features/assets/AssetGrid.tsx` | Fixed |
| 12 | Opening the detail panel changed the grid width and scroll geometry. | `src/styles.css` | Fixed |
| 13 | Thumbnails loaded eagerly, ignored `hasThumbnail`, and had no stable fallback after failure. | `src/features/assets/AssetGrid.tsx`, `src/features/assets/AssetDetail.tsx` | Fixed |

---

## Key decisions

For each significant choice: what you did, what you rejected, and why. Three to
six of these is about right.

**Data fetching and caching**

I used TanStack Query with the normalized filters as the cache key. Task 1 uses
that key for cancellation, de-duplication and stale-response isolation; Task 2
keeps every cursor page under the same filter-specific key with
`useInfiniteQuery`. I rejected a custom promise map and cursor accumulator
because cache ownership, shared cancellation and cursor-page lifecycle would
all become application code. The costs are an added dependency, bundle weight
and retained page data; URL rules, debounce timing, retry policy and interface
states remain explicit application code.

**Stale response handling**

Search uses a 300 ms trailing debounce: short enough to remain responsive, but
long enough to collapse normal typing into one request. Changing the normalized
query cancels the obsolete fetch through `AbortSignal`. The complete query also
forms the cache key, so a response that finishes late remains attached to its
original query and cannot replace the active view. While a search is pending,
the UI hides results belonging to the previous query instead of pairing them
with the new search text.

**Virtualization approach**

I used TanStack Virtual with responsive lanes, fixed card geometry and roughly
two rows of overscan. Only visible and nearby cards are mounted, while native
lazy loading limits image work within that mounted range. I rejected a custom
virtualizer because resize measurement, lane placement, overscan and scroll
offset handling are correctness-sensitive and later keyboard navigation also
needs index-based scrolling. The measured cost of Task 2 was 8.53 kB gzip.

**Optimistic updates and rollback**

**Retry and backoff policy**

**State placement and URL sync**

Committed `q`, status, kind, tag and sort values live in the URL and pass through
one parser and normalizer. Search updates replace the current history entry, so
typing does not create a Back step per character; deliberate filter and sort
changes push entries, allowing Back to undo them. Only the immediate search
draft stays in component state. I used the History API instead of adding a
router because the application currently has one screen and no route model to
manage. Cursors remain internal page parameters under the normalized query key,
so a filter change starts from a null cursor instead of reusing one from another
query.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser.

Measured on Macbook air in Chrome 153 with no CPU or network throttling. Task 2
scale measurements used a production build with `CHAOS=0` and `LATENCY=0` to
remove backend variability.

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | Not measurable: the starter stopped at 50 | 613 nodes, including 60 cards | Loaded 5,000 assets and counted document nodes and mounted cards through Chrome CDP. |
| Cards re-rendered when toggling one selection | Not reliably comparable: the starter had no card component boundary | 1 of 60; 0 unrelated | A React commit hook counted rendered `AssetCard` fibers for one checkbox change. |
| Longest task during sustained scroll | Not measurable at 5,000: the starter stopped at 50 | 10.26 ms; 0 tasks over 50 ms | Worst of three 10-second Chrome CDP traces after 5,000 assets loaded, with no page requests. |
| Requests fired while typing a 6-character query | 6 | 1 | Typed `travel` in the original and updated builds and counted the resulting `/api/assets?q=…` requests in the Chrome CDP Network log. |
| Production bundle, gzipped | 48 kB reference supplied in the README | 67.89 kB | `npm run build`; JavaScript gzip size from the Vite production output. |

What was the actual bottleneck, and how did you find it?

**Requests fired while typing a 6-character query**

The measured bottleneck was request amplification: each search input event
started another `/api/assets` request. The Chrome CDP Network log showed one
request for each character in `travel`. A 300 ms trailing debounce was the
countermeasure and reduced the six requests to one.

**Rendered DOM nodes at 5,000 rows loaded**

Source inspection found that the grid directly rendered every supplied asset,
so cursor pagination would increase its DOM on every page. Viewport
virtualization kept the measured result to 613 DOM nodes and 60 mounted cards
with 5,000 asset records loaded.

**Cards re-rendered when toggling one selection**

Source inspection showed that selection replaced the parent `Set` and rebuilt
card markup for the visible grid. A memoized card boundary, primitive per-card
state and stable callbacks reduced the measured update to the changed card only.

---

## Accessibility

- Keyboard model you implemented, in one paragraph.
- How you tested it, including any screen reader.
- Known gaps.

---

## Interface decisions

The interface work focused on truthful request feedback and spatial stability as
the library grows. Search and related filters stay together, and the result area
shows one initial request state at a time. Pagination feedback remains local to
the list so already loaded assets stay usable, while reserved card geometry and
an overlaid detail panel prevent page loads or panel use from moving the grid.

- **Visual system.** Existing colour tokens, system typography and spacing remain
  in `src/styles.css`. Fixed card bodies and 16:10 thumbnail frames keep the
  virtual grid predictable, and controls wrap at the existing narrow breakpoint.
- **Status treatment.** Tasks 1–2 did not redesign status styling. Existing cards
  and filters continue to show text labels, so colour is not the only status cue.
- **States.** Initial loading, successful empty results and initial errors are
  mutually exclusive. Next-page loading or failure leaves existing cards in
  place and offers `Try again`; missing thumbnails use a same-size placeholder.
- **Contrast.** WCAG relative-luminance calculations checked the modified text,
  feedback and focus colours; the lowest measured ratio was 5.26:1.
- **Copy.** Raw API failures were replaced with short, actionable messages.
  Rate limiting asks the user to wait and retry, temporary unavailability asks
  them to retry, and the fallback suggests checking the connection.

Screenshots in the repo are welcome — link them here.

---

## Trade-offs and cuts

- TanStack Query and TanStack Virtual increased the JavaScript bundle from the
  README's 48 kB reference to 67.89 kB gzip. They replace custom request,
  pagination and viewport infrastructure with tested lifecycle primitives.
- Infinite-query pages remain cached, so rendered DOM stays bounded but loaded
  record memory grows with deliberate scrolling. With another day I would first
  profile heap use, then add bounded page eviction only if the measured cost
  justified the extra cursor and scroll-restoration complexity.
- The detail panel overlays the right side of the grid while open. This preserves
  grid dimensions and scroll position at the cost of temporarily covering cards.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

## Anything you would like us to look at

The normalized query key now owns cancellation and cursor pagination, while the
virtualized grid keeps selection updates and mounted card work local.
