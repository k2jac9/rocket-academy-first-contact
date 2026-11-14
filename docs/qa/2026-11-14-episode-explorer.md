# Episode Explorer — 2026-11-14

Step 2 of the [Atlas implementation plan](../atlas-implementation-plan.md) replaces the latest-20 history with filtered, cursor-paginated discovery. Robot lab has an Episode Explorer shortcut, applied filters, matching overview totals, Previous/Next controls, replay and direct MCAP downloads. Existing UUID detail/download routes and recording bytes are unchanged.

## Verified behavior

- Live Atlas: all 10 complete physics episodes matched an independent metadata scan across 23 filter combinations. Earth + Husky yielded two episodes; adding rollover yielded the single Amboy Crater recording (0.63 seconds, four RGB/depth pairs). The unfiltered overview remained 10 episodes, 59.63 seconds and 258 pairs.
- An isolated temporary collection held 34 complete synthetic records plus one unfinished record. Twenty-six shared the same timestamp. All pages matched an independently sorted reference without missing or duplicate IDs. Tests covered missing/non-string dates, missing and unknown categories, malformed scalar arrays, legacy models, inclusive UTC day boundaries, empty results and exclusion of unfinished records.
- A newer insertion between pages did not shift the ongoing traversal. Starting again included the new record. The temporary collection was dropped and its absence confirmed. No saved application records or artifacts were modified.
- Browser: Earth/Husky/rollover filters, contradictory filters, future/reversed dates, reset, five-per-page navigation across all ten unique records, return to the first page, matching overview totals, Amboy replay and MCAP download passed. Reopening a recording retains the applied filters.
- A simulated list HTTP 503 displayed an explicit error rather than an empty library. Refresh recovered after interception was removed. Desktop (1440 × 1000) and mobile (390 × 844) layouts were inspected; controls fit and the mobile document had no horizontal overflow. Screenshots and the downloaded recording remain in ignored `test-results/`.

Browser testing exposed a shared-health defect: cancelling an obsolete overview request could put Atlas into its five-second outage backoff. Repository operations now distinguish the caller's exact cancellation reason from database failures and internal deadlines. Regression tests cover both list and overview cancellation, immediate subsequent reads and genuine timeout handling. Filter changes passed again in the browser after this fix; this does not establish uninterrupted availability.

## API and resource boundaries

The list retains the `episodes` array and adds `nextCursor`, site identity and model metadata. The default page size remains 20; the maximum is 50. Fixed filter compilation rejects raw query operators, duplicate/unsupported parameters, invalid dates and cursors belonging to different filters. Statistics use the same filter compiler and reject pagination parameters. Local host/origin restrictions and `no-store` remain in effect.

Reads project only summary metadata. No frame/image payload, raw document or artifact bytes appear in either response. Aggregation execution is capped at five seconds with an eight-second operation deadline; connection establishment retains its separate limits. Page sorting disables disk spill and fetches one extra result to determine whether another page exists. The return bound does not mean constant database work.

## Query-plan evidence and limits

`explain('executionStats')` for unfiltered, Earth and Husky list queries used the existing state index. Each examined 10 keys and 10 documents in this corpus and performed a blocking sort. Normalizing missing/non-string timestamps before ordering supports legacy records but prevents the existing date index from providing the sort. No speculative index was added. The schema audit should establish a canonical timestamp contract before migrating to a fully index-supported ordering strategy; benchmark representative larger corpora before making scaling claims.

Cursor ordering uses descending timestamp plus unique episode ID. It is stable for immutable completed records and accommodates newer arrivals through Refresh. It is not a database snapshot or frozen selection. Separate list/stat reads can briefly disagree under concurrent writes. Administrative updates/deletions remain outside that stability guarantee. Training eligibility and immutable dataset manifests remain later plan steps.

## Repeatable verification

```powershell
npm test
npm run build
# Read-only scan of at most 1,000 complete episodes, filter comparisons and explain.
node --env-file-if-exists=.env.local scripts/check_episode_explorer.ts
# Also create and remove a uniquely named episode_explorer_check_* fixture collection.
node --env-file-if-exists=.env.local scripts/check_episode_explorer.ts --fixtures
```

An interruption during fixture cleanup can leave the uniquely named test collection; the script never drops an application collection. The script also passed a separate strict TypeScript check. The final suite passed 266 tests across 17 files and the production build. Vite's existing large-chunk warning remains; no dependencies were changed.
