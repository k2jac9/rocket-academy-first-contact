# ADR-001: Expand Atlas through sequential, verified deliveries

**Status:** Accepted; execution started 2026-11-14

**Date:** 2026-11-14

**Deciders:** Project owner requested fastest-first implementation; implementation sequencing by Codex.

## Context

FIRST CONTACT already persists missions, kinematic runs, physical episodes, exploration imports and immutable scenario versions in Atlas. GridFS holds original artifacts with hashes. The November 14 audit found 3 complete kinematic runs, 10 complete physics episodes, 1 exploration and 6 scenario versions. The seven inspected application collections had no Search/Vector Search indexes; database validators were absent. Backup and alert account settings remain unverified.

The application is currently local and uses application validation and local origin restrictions. It does not yet provide project authentication or tenant authorization. Existing physics and sensor limitations must remain visible. A saved episode is not automatically eligible for training.

## Decision

Ship one independently useful step at a time, ordered by implementation effort and prerequisites. Start with the existing Node/React application and collections; keep the original episode identities and artifacts. Finish the current step's acceptance checks and update this document before beginning the next. Effort sizes are relative estimates, not delivery deadlines.

## Options considered

| Option | Complexity | Cost | Scalability | Fit with current code |
| --- | --- | --- | --- | --- |
| Extend existing Atlas repositories and UI in small steps — selected | Low initially; grows with each feature | Existing deployment first; later service costs verified separately | Measure query plans and throughput as the corpus grows | High |
| Begin with vector search and an embedding pipeline | Medium/high | Embedding and search capacity may add cost | Requires versioned projections, backfills and relevance evaluation | Foundational metadata and curation still missing |
| Rebuild around a separate analytics/search stack | High | Additional services and operations | Potentially useful at a measured larger workload | Duplicates identity, indexing and recovery responsibilities now |

## Ordered implementation plan

| Step | Deliverable | Relative effort | Dependency | Status |
| --- | --- | --- | --- | --- |
| 1 | Live Atlas episode overview in Robot lab | Small | Existing complete physics records | Complete — [verification](qa/2026-11-14-atlas-overview.md) |
| 2 | Episode Explorer filters and stable pagination | Small/medium | 1 | Complete — [verification](qa/2026-11-14-episode-explorer.md) |
| 3 | Database schema validation with a compatibility audit | Medium | Migration credential with `collMod`; remaining integration checks | Paused by owner — [implementation and handoff](atlas-schema-validation.md); live rollout not applied |
| 4 | Backup, restore and alert verification | Medium; account access dependent | Authorized Atlas management access | Planned; settings unverified |
| 5 | Keyword search over versioned episode summaries | Medium | 2; search permissions/capacity checked | Planned |
| 6 | Reviewed dataset manifests and split groups | Medium/large | 2–3; explicit eligibility rules | Planned |
| 7 | Semantic and hybrid retrieval | Large | 5–6; embedding model/access and relevance set | Planned |
| 8 | Recoverable background processing and live updates | Large | Projection and review events defined | Planned |
| 9 | Training/evaluation lineage and curriculum queries | Large | 6–8; actual learning worker integration | Planned |

### 1. Live episode overview

- Add `GET /api/episodes/stats`, backed by one bounded MongoDB aggregation over `physics_episodes` with `state: complete`.
- Show saved episode count, recorded simulation seconds, RGB/depth sample pairs, world coverage, robot-model presence and recorded end reasons.
- Count a model once per episode even if both participants use it. Include an explicit unknown bucket for legacy/missing categorical metadata.
- Keep unfinished publications, kinematic runs and imported videos out of these physics statistics. Missing duration/sample metadata must be visible rather than silently treated as measured zero.
- Render loading, empty, unavailable and refresh states. Refresh after a newly saved physical episode. Never label a duration limit as success or claim generated time is validated training time.
- **Acceptance:** live totals agree with an independent metadata read; mixed/legacy fixture cases pass; no raw frames, images, credentials or recordings are returned; existing endpoints still work; desktop/mobile review, tests and build pass.
- **Rollback:** remove the UI panel and additive GET endpoint; no data migration is required.

### 2. Filters and pagination

- Extend physical episode history with allowlisted body, terrain site, participant model, termination and date filters. Reject unknown/duplicate query parameters and raw query operators.
- Use a stable `(startedAt, _id)` cursor with a bounded page size. Fetch metadata projections only; retain an explicit unknown/legacy selection.
- Apply the same filters to overview counts. Present counts for the complete filtered corpus, separately from the visible page.
- Inspect `explain` for representative combinations and add only justified indexes. Keep the existing no-query list response compatible.
- **Acceptance:** real matching episodes reopen and export; nonmatching records stay out; tied timestamps paginate without duplication; latest-20 truncation is removed; errors do not appear as an empty database.

### 3. Database validation

- Create a repeatable dry-run audit of existing collection shapes, including `persisting` versus `complete` documents and legacy schemas.
- Add version-aware validators first in warning mode, then enforce only after writes/retries and legacy compatibility pass. Application validation remains authoritative for hashes, frame transforms and cross-record invariants.
- Preserve invalid historical records for review; record exceptions and migration outcomes. Do not silently rewrite scientific provenance or add validation claims.
- **Acceptance:** current save/replay paths pass; malformed new writes are rejected; interrupted publications remain recoverable; a documented validator rollback works.

### 4. Operations verification

- Inspect actual deployment tier, backup schedule/retention, restore permissions, database roles, network access and alert configuration through authorized Atlas management access. A database connection alone cannot verify these.
- Document recovery-point/recovery-time targets with the owner, then test restore into an isolated destination and verify representative artifact hashes.
- Prepare concrete settings before any new paid capacity or restore destination is purchased. Do not broaden network access to work around the unavailable remote connector.
- **Acceptance:** dated evidence of backup policy, an isolated restore, role scope and usable alert delivery. Missing access remains an explicit prerequisite, not a claimed completion.

### 5. Keyword search

- Introduce a versioned, rebuildable episode search projection containing canonical ID, body/site, robot models, termination, source kind and a factual summary.
- Create a scoped Search index after checking the deployment's access and resource limits. Provide fielded/keyword search with explicit exact filters; re-read canonical records when opening protected or selected evidence.
- Use deterministic summaries initially. Add model summaries only with model/prompt/version lineage and evidence references.
- **Acceptance:** reviewed queries return relevant existing episodes; stale/deleted projections cannot authorize an export; index lag and errors are visible.

### 6. Dataset manifests

- Add append-only review revisions and purpose-specific eligibility. Begin with regression/debugging, admitting other uses only when their evidence requirements are met.
- Freeze exact episode/segment IDs, artifact hashes, validation/review revisions, transforms and split groups. Fail a freeze if any selected member is missing or inadmissible; never silently shrink a selection.
- Keep related rerenders and overlapping clips in one split group. Recheck current revocations when starting a new export/training run while preserving historic manifests.
- **Acceptance:** a manifest reproduces its exact membership; missing artifacts and revoked/ineligible members block new use; repeated freeze requests are idempotent.

### 7. Semantic retrieval

- Select and pin an embedding provider/model, dimensions, input schema and version. Check account access and cost before backfill.
- Embed factual summaries first. Combine lexical and vector ranking with hard metadata/access filters and canonical eligibility checks.
- Build a reviewed relevance set; measure retrieval quality and indexing lag. Explain matches with recorded evidence, not embedding similarity alone.
- **Acceptance:** semantic results improve retrieval on the reviewed set; model revisions do not mix; incomplete backfills are visible; authorization filters cannot be bypassed.

### 8. Processing and live updates

- Add leased, idempotent jobs for summaries, validation and embeddings, with retry limits and reconciliation.
- Use change streams where supported to invalidate UI/projection state, preserving resume tokens and handling gaps through reconciliation. Browser delivery uses a bounded server event channel.
- Keep physics/control loops local to workers. No motor action depends on Atlas round-trip latency.
- **Acceptance:** interruption/restart does not lose required processing or double-publish artifacts; stale events are harmless; reconnection tests pass.

### 9. Learning loop

- Record training inputs, frozen scenarios, checkpoint hashes, code/container versions, metrics and a held-out evaluation-suite identity.
- Query development failures to propose the next bounded scenario batch. Preserve a separate untouched final evaluation suite.
- **Acceptance:** an actual training job consumes a frozen contract and emits a checkpoint; evaluation compares it with a baseline. Claim improvement only when measured.

## Consequences and boundaries

Atlas becomes more useful immediately through observable metadata, then gains discovery and governed selection. Search is eventually consistent, so canonical reads remain necessary. Larger sensor collections will require artifact-bandwidth and document-size measurements; raw high-rate streams stay in MCAP/artifact storage. Sharding, dedicated search capacity and specialized telemetry storage wait for measured demand. Public multi-user deployment requires project authentication, tenant-scoped access, worker identities and budget controls before exposure.

## Action items

1. [x] Finish Step 1 and record verification evidence.
2. [x] Implement Step 2 after Step 1 passes.
3. [ ] Resume Step 3 from the [schema-validation handoff](atlas-schema-validation.md); complete integration verification and obtain migration access before live enforcement.
4. [ ] Reassess estimates and prerequisites at each completed step; update the status table and evidence links.

Steps 1–2 are available in **Robot lab → Episode Explorer**. Step 3's code and compatibility audit are prepared: 39 existing records across nine collections match the proposed rules. The owner requested pausing the rollout on November 14. Live validators remain absent; the app credential lacks `collMod`, and the full integration check still needs completion. Resume Step 3 from its handoff. Steps 4–9 remain unimplemented.

Step 2 query-plan inspection found the existing state index in use and a bounded sort over projected metadata. No new index was added for the 10-record corpus. Legacy date normalization currently prevents an index-provided sort; reassess a canonical indexed timestamp after the Step 3 compatibility audit, before claiming large-corpus performance. Browser cancellation no longer marks the shared Atlas connection unavailable.

## Technical references

- [MongoDB aggregation facets](https://www.mongodb.com/docs/manual/reference/operator/aggregation/facet/): related breakdowns in one aggregation; put selective stages before facets and respect output limits.
- [Schema validation](https://www.mongodb.com/docs/manual/core/schema-validation/): warning versus rejection behavior and validation of existing documents.
- [Atlas backups](https://www.mongodb.com/docs/atlas/backup/cloud-backup/overview/): tier-specific backup behavior and management permissions.
- [Hybrid retrieval](https://www.mongodb.com/docs/vector-search/hybrid-search/hybrid-search-overview/): combine lexical and vector rankings.
- [Change streams](https://www.mongodb.com/docs/manual/changestreams/): database change subscriptions and deployment limitations.
