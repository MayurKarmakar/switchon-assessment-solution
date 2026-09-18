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

---

## Key decisions

For each significant choice: what you did, what you rejected, and why. Three to
six of these is about right.

**Data fetching and caching**

I used TanStack Query with the normalized asset query as the cache key. A custom
hook could cover Task 1 with an `AbortController`, request counter and promise
map, but the same request ownership and cache must also support cursor pages,
optimistic updates and retry policy later in the brief. TanStack Query provides
that lifecycle consistently; the trade-off is added bundle weight and another
abstraction to understand. URL rules, debounce timing, error classification and
user-visible states remain application code, and automatic retries are disabled
until their policy is implemented deliberately.

**Stale response handling**

Search uses a 300 ms trailing debounce: short enough to remain responsive, but
long enough to collapse normal typing into one request. Changing the normalized
query cancels the obsolete fetch through `AbortSignal`. The complete query also
forms the cache key, so a response that finishes late remains attached to its
original query and cannot replace the active view. While a search is pending,
the UI hides results belonging to the previous query instead of pairing them
with the new search text.

**Virtualization approach**

**Optimistic updates and rollback**

**Retry and backoff policy**

**State placement and URL sync**

Committed `q`, status, kind, tag and sort values live in the URL and pass through
one parser and normalizer. Search updates replace the current history entry, so
typing does not create a Back step per character; deliberate filter and sort
changes push entries, allowing Back to undo them. Only the immediate search
draft stays in component state. I used the History API instead of adding a
router because the application currently has one screen and no route model to
manage.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser.

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | | | |
| Cards re-rendered when toggling one selection | | | |
| Longest task during sustained scroll | | | |
| Requests fired while typing a 6-character query | 6 | 1 | Chrome 153 CDP Network log on an Apple MacBook; typed `travel` into a settled page on baseline commit `cecf873` and the Task 1 working tree, then counted only the resulting `/api/assets?q=…` requests. |
| Production bundle, gzipped | | | |

What was the actual bottleneck, and how did you find it?

---

## Accessibility

- Keyboard model you implemented, in one paragraph.
- How you tested it, including any screen reader.
- Known gaps.

---

## Interface decisions

Task 1 focused on making the active query and request state immediately clear.
Search, sort and related filters stay together, while selected tags become
visible, removable chips. The result area presents one request state at a time,
so current controls are never paired with results known to belong to an older
query. Existing tokens and native controls keep these additions consistent with
the starting interface.

- **Visual system.** Colour tokens, system typography, borders and spacing live
  in `src/styles.css`. The same system now covers labelled search and sort
  controls, grouped filters, tag chips and centred request states; controls wrap
  at the existing mobile breakpoint instead of overflowing.
- **Status treatment.** Status filters follow the workflow order: Draft, In
  review, Approved and Archived. Cards and filters always show the status as
  text; the card-pill background is a secondary cue rather than the only way to
  identify a status.
- **States.** Search loading, successful empty results and request failures are
  mutually exclusive. A pending search hides cards from the previous query;
  an empty message appears only after a successful zero-result response; and a
  failure keeps its own error state with a retry action. These paths were
  manually verified after implementation.
- **Contrast.** A WCAG relative-luminance calculation checked the text and
  feedback colours used by this work. Muted text is 5.69:1 on white and 5.26:1
  on the soft background; the blue focus indicator is 5.61:1 on white; and
  error text is 6.90:1 on white.
- **Copy.** Raw API failures were replaced with short, actionable messages.
  Rate limiting asks the user to wait and retry, temporary unavailability asks
  them to retry, and the fallback suggests checking the connection. Each error
  state provides a `Try again` action.

Screenshots in the repo are welcome — link them here.

---

## Trade-offs and cuts

What you deliberately did not do, and what you would do with another day.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
