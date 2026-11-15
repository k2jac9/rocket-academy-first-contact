# Atlas semantic-search verification — November 14, 2026

Environment: local Windows/Node 26, application MongoDB driver 7.9.0, Atlas MongoDB 9.0.7, AWS M10 in US West with disk auto-scaling enabled.

- `npm test`: 293 tests passed across 19 files. New coverage includes factual summaries, unknown/legacy metadata, unsafe inputs, exact prefilters, canonical result checks, bounded/idempotent reconciliation, stale removals, cancellation, readiness, provider rate limits and local-origin enforcement.
- `npm run build`: passed. Existing large-client-chunk warning remains.
- CLI management inspection: authenticated profile found outside PATH; application connection matched the inspected cluster; zero Search indexes initially; resource policy restricts cluster configuration and private endpoints, not search index creation. Billing endpoint unavailable; free-token balance not inferred.
- Native activation: 10 projection records created; one index with the reviewed `autoEmbed` definition accepted by Atlas. Initial creation acknowledgement exceeded the normal socket deadline; a read confirmed the index existed. Repeated activation changed zero projections and created no duplicate index.
- Initial UI checks: 1440×1050 and 390×844 layouts have no horizontal overflow; the building state disables submission and retains exact browsing.

The native index reached `READY` and `queryable: true`. Five real API searches returned HTTP 200:

| Query | Exact filters | Observed result | Duration |
| --- | --- | --- | --- |
| vehicle overturned | None | Amboy Crater rollover ranked first | 2,192 ms |
| lunar surface rover experiments | None | Both Apollo 17 episodes ranked first | 827 ms |
| Martian rover recordings | None | First five matches were Dingo Gap | 1,250 ms |
| Earth rover tests | Moon | Only the two Moon episodes returned | 909 ms |
| vehicle overturned | Moon + rollover | Empty result; no Moon rollover exists | 780 ms |

These five requests are a small functional smoke check, not a latency benchmark or general relevance evaluation. No lexical baseline or hybrid-ranking quality comparison was performed.

Mobile browser submission of “vehicle overturned” returned the same first match. The result's Replay episode button loaded the complete Amboy Crater rollover record (HTTP 200). Desktop and mobile screenshots show the working search UI; neither viewport had horizontal overflow. A final reconciliation reported zero changed projections, 10 total, and a ready index.

- [Desktop search](atlas-semantic-desktop.png)
- [Mobile search](atlas-semantic-mobile.png)

No recorded episode or GridFS artifact was modified. No cluster upgrade, billing edit, resource-policy change or deferred validator activation was performed. Actual remaining free-token allocation is still unverified; successful native embedding and query execution are verified.
