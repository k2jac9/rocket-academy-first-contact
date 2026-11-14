# Atlas episode overview — 2026-11-14

Step 1 of the [Atlas implementation plan](../atlas-implementation-plan.md) adds a read-only overview to Robot lab. It summarizes all complete `physics_episodes` through `GET /api/episodes/stats`; the existing history list remains limited to 20 until Step 2.

## Observed evidence

| Metric | Verified value |
| --- | --- |
| Complete physics episodes | 10 |
| Recorded simulation duration | 59.63 seconds; displayed as 59.6 |
| Recorded RGB/depth pairs | 258 |
| Bodies | Earth 2, Moon 2, Mars 6 |
| End reasons | Duration reached 9, rollover 1 |
| Model presence by episode | Husky 7, Jackal 7, legacy Scout 3, legacy Surveyor 3 |

The aggregation agreed with an independent metadata-only scan of the existing records. A uniquely named fixture collection checked an empty database, duplicate models within an episode, missing/unknown metadata, negative/fractional/non-finite counts, and exclusion of failed/persisting records. The fixture collection was dropped and its absence confirmed. Existing records and artifacts were not modified.

- 233 automated tests across 16 files passed, including the new API boundary cases. The production build and separate TypeScript check of the diagnostic script passed.
- Desktop 1440 × 1000 and mobile 390 × 844 layouts were inspected; the mobile document had no horizontal overflow.
- An initial live UI request reported Atlas unavailable. Manual Refresh recovered and displayed the verified totals. No uninterrupted-availability claim is made.
- Browser interception separately verified empty-state messaging, explicit HTTP 503 failure without zero metrics, and successful recovery after the interceptor was removed.
- The API rejects query parameters, retains the local host/origin restrictions and `no-store`, and passes cancellation into a fixed aggregation. Database execution is capped at five seconds with an eight-second aggregation deadline. The existing connection stage has its own limits.

No success rate, training-hours claim, image data, raw frames or artifact bytes are included in the response. Metric coverage counts identify incomplete duration/sample metadata. A robot model counts once per episode; robot-model totals can exceed episode totals when multiple models participated.

## Repeatable checks

```powershell
# Read-only comparison against up to 1,000 existing complete records.
node --env-file-if-exists=.env.local scripts/check_episode_stats.ts

# Also exercise a uniquely named, self-cleaning fixture collection.
node --env-file-if-exists=.env.local scripts/check_episode_stats.ts --fixtures
```

The fixture command does not drop any existing application collection. If interrupted during cleanup, it can leave a collection beginning with `episode_stats_check_`; its records are synthetic test data. Screenshots remain in ignored `test-results/`.
