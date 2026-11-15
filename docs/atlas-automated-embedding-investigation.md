# Atlas Automated Embedding investigation

**Reviewed:** November 14, 2026 (America/Toronto)

**Status:** Prototype implemented and verified against the live Atlas index. See the [operator guide](atlas-semantic-search.md) and [verification evidence](qa/2026-11-14-atlas-semantic-search.md).

## Recommendation

Use a small, versioned projection of factual episode summaries with Atlas Automated Embedding and `voyage-4`. Atlas can embed both stored text and natural-language queries without another embedding API key or an application embedding pipeline. This removes a separate Gemini embedding dependency; Gemini can retain its mission-planning role. [Atlas integration documentation](https://www.mongodb.com/docs/atlas/ai-integrations/vercel-ai/)

The initial investigation changed documentation only. The owner subsequently requested implementation. The follow-up found an authenticated Atlas CLI outside PATH and created the bounded search projection and native embedding index. Billing settings, resource policies and validators remain unchanged; the deferral of live schema enforcement still applies.

## Verified against this application

Read-only checks used the existing local configuration and MongoDB Node driver. Connection strings, credentials and account identifiers are omitted.

| Check | Result |
| --- | --- |
| Database ping | Successful |
| Server version | MongoDB 9.0.7 |
| Application driver | `mongodb` 7.9.0 |
| Database privileges | `createSearchIndexes`, `listSearchIndexes` and `updateSearchIndex` present; `collMod` absent |
| Complete physics episodes | 10: Earth 2, Moon 2, Mars 6 |
| Search indexes on `physics_episodes` | None |
| Top-level summary field | Absent on all 10 complete episodes; no search projection implemented in the application |
| Application database data size | 18,539,987 bytes, excluding index/storage overhead |
| Account-management access | No management credential variables found in the loaded application environment; available browser reached Atlas login |

Evidence came from `ping`, `buildInfo`, `connectionStatus` with privileges, `countDocuments`, `listSearchIndexes`, `dbStats`, and a metadata-only aggregation. Version and database privileges support proceeding to a prototype, but do not establish organization policy, account billing or successful `autoEmbed` execution.

## Service requirements and costs

- Automated Embedding remains **Preview**; MongoDB advises against production use. It generates and updates text embeddings asynchronously and stores them in an internal database on the cluster. Dedicated M10+ clusters require storage auto-scaling. [Overview](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/)
- Published limits cover Free/M0, Flex and dedicated clusters. M0 without a payment method has a query allowance of 3 requests/minute and 2,000 tokens/minute. The documented `voyage-4` allowance for M0 with a payment method, Flex and dedicated clusters is 2,000 requests/minute and 8,000,000 tokens/minute. These are shared cluster limits, not measured application throughput. [Models and limits](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/models/)
- `voyage-4` costs **US$0.06 per million tokens**; `voyage-4-lite` costs US$0.02. Initial indexing, changed text and query text consume tokens. Atlas documents a one-time **200 million free tokens per model per organization**, shared across its projects; our remaining allocation is unknown. Storage/search capacity costs are separate from this token estimate. [Billing](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/billing/)
- Creating an `autoEmbed` index enables embedding; it is not a read-only eligibility test. An organization resource policy can forbid new Automated Embedding indexes. Inference defaults to any geography/cloud; dedicated clusters can select US or EU scope, with a 1.1× token price. Our policy and inference scope remain unknown. [Management](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/management.md)
- Free clusters permit 3 Search/Vector Search indexes in total; Flex permits 10. The absence of indexes on our episode collection does not prove cluster-wide capacity. Search projections are eventually consistent. [Index reference](https://www.mongodb.com/docs/vector-search/indexes/vector-search-type.md)

Illustrative token-only estimate: 10 summaries × 300 tokens = 3,000 tokens, or **US$0.00018** with `voyage-4`, before any free allowance. Another 1,000 queries × 30 tokens would cost US$0.0018. These are arithmetic examples, not token measurements or a total Atlas bill.

## Concrete implementation path

1. **Confirm account configuration.** Read deployment tier, storage auto-scaling where required, cluster-wide index count, organization resource policies, inference scope, and remaining free-token/payment status. Project read access and billing-view access are separate from the application's database login. No cluster upgrade is proposed.
2. **Build deterministic summaries locally first.** Add an idempotent projection builder for complete episodes. Include canonical episode ID, body/site, participant models, recorded termination, duration, source kind and limitations. Store summary schema version, input hash and artifact hash. Missing evidence stays unknown; a duration limit never becomes a successful mission. Begin with the existing 10 episodes, excluding frames, recordings and credentials from text.
3. **Prepare one versioned index.** Proposed collection: `episode_search_v1`. Proposed index: `episode_summary_v1`, type `vectorSearch`, with `summary` as text `autoEmbed` using `voyage-4`, 1,024 dimensions, float quantization and dot-product similarity. Add filter fields for source kind, body, site, robot models, termination and projection version. Review account findings and the exact definition before live creation; creation starts processing existing text. [Index configuration](https://www.mongodb.com/docs/vector-search/indexes/vector-search-type.md)
4. **Add a bounded search endpoint and UI.** Send plain query text to `$vectorSearch` with allowlisted filters and a result limit. Wait for the index to become queryable; expose indexing, unavailable and rate-limit states. A search submission should be explicit, especially on M0's low query allowance. Keep exact-filter browsing usable independently. [Query contract](https://www.mongodb.com/docs/vector-search/query/aggregation-stages/vector-search-stage.md)
5. **Verify retrieval and freshness.** Review expected matches for queries such as “Earth rover tests,” “lunar episodes” and “episodes that ended in a rollover.” Compare lexical and semantic ranking before adding hybrid ranking. Test changed/deleted projections, index lag, empty results and query failures. Re-read canonical complete records and compare source hashes before returning evidence links. Search ranking must never grant dataset eligibility.
6. **Record results and bound the experiment.** Measure first-index readiness, update lag, query latency, relevance and token use. Pin the projection/index configuration. Ten episodes can validate plumbing, not establish broad retrieval quality. Keep a separately configured external-embedding adapter as a later option if the Preview is unsuitable; do not mix model spaces.

The projection builder and mocked endpoint tests can proceed without live schema activation. Governed training exports remain a separate milestone requiring review, eligibility and immutable manifests. The initial scope is episode discovery, not learned cognition or verified robot-training data.

## Remaining account evidence

The initial database-only inspection could not establish deployment tier, organization policies, billing balance or inference geography. Follow-up using the authenticated Atlas CLI verified that the configured application connects to the inspected AWS M10 cluster in `US_WEST_1`, with storage auto-scaling enabled. Its sole resource policy contains restrictions on cluster/provider/region/count and private endpoints; it does not restrict search index creation. The cluster had zero Search indexes before this implementation. The billing endpoint was unavailable to this session, so remaining free tokens and inference scope are still unverified. Native browser access was unavailable; no account setting was changed to work around that limitation.
