# Native Atlas episode search

**Scope:** Local prototype using Atlas Automated Embedding (Preview), `voyage-4`, and complete physics episodes. No Gemini embedding key is needed. Production readiness, training eligibility, hybrid ranking and interval-level event search are separate work.

## Use it

Open **Robot lab → Episode Explorer → Search by meaning**. Apply exact filters first, then submit a phrase such as “vehicle overturned” or “lunar rover experiments.” Results include a factual summary, replay and MCAP links. Similarity ranks candidates; it does not prove success, physical validity or training eligibility. Search runs only when submitted, not on every keystroke.

Selecting a World updates the library immediately and clears a terrain filter from another world. The terrain menu then lists compatible sites. Other edited filters use Apply filters; active and pending selections are identified below the controls. If additional filters return nothing, **Show all Moon episodes** (or the selected world) clears those constraints while retaining the world.

Exact-filter browsing remains available during indexing or embedding failures. The status endpoint generates no embeddings. Refresh library rechecks readiness. A changed library can temporarily omit stale results while Atlas indexes updates.

## Implementation

`server/episodeSearch.ts` builds deterministic text from allowlisted world/site/model/end-reason/duration values. Arbitrary prompts, frame streams, model XML, free-form limitations and credentials do not enter the embedding text. Every summary explicitly retains prototype and eligibility limits. Missing/legacy values remain unknown.

The rebuildable `episode_search_v1` collection keeps the canonical episode UUID, projection version, source hash and recording hash. It has one `episode_summary_v1` Vector Search index: text `autoEmbed`, Voyage 4, 1,024 dimensions, float quantization and dot-product similarity. Indexed metadata filters include world, site, robots, termination, source kind, version and UTC date.

`POST /api/episodes/search` validates `{ query, filters?, limit? }`: 1–500 characters, existing allowlisted episode filters and 1–20 results. It uses `$vectorSearch.query.text`, then reads canonical complete episodes again with the same exact filters. Changed, missing or incomplete matches are omitted. No client-supplied MongoDB operators, model identifiers or index names are executed.

Before a search, bounded reconciliation updates changed summaries and removes obsolete **derived projections only**. Unchanged source hashes cause no write. The initial implementation caps reconciliation at 1,000 complete episodes and serializes search requests within the local API. Larger collections need paginated background reconciliation before lifting this cap. Atlas handles embedding updates asynchronously; current canonical facts do not guarantee that the embedding index has already caught up.

The embedding stage has a 12-second database execution limit; the overall search signal expires after 20 seconds. Normal connection/socket deadlines remain unchanged. Provider failures and rate limits have explicit safe errors; embedding errors do not become empty results or mark a healthy database disconnected. The existing localhost/origin restrictions apply. Multi-user deployment still requires authentication and tenant authorization.

## Operator commands

Run from the repository root. The URI is loaded from the ignored local environment file and is never printed.

```powershell
# Read-only index readiness
node --env-file-if-exists=.env.local scripts/atlas_search.ts status

# Reconcile summaries; updates can consume embedding tokens if an index is active
node --env-file-if-exists=.env.local scripts/atlas_search.ts sync

# Explicitly create the native embedding index if missing; this starts token consumption
node --env-file-if-exists=.env.local scripts/atlas_search.ts activate

# Live query; consumes query embedding tokens
node --env-file-if-exists=.env.local scripts/atlas_search.ts query "vehicle overturned"
```

Application startup never provisions the search index. `activate` is repeatable, reconciles a potentially lost creation acknowledgement, and checks the pinned definition. Index creation acknowledgement does not mean the index is ready. The operator connection has a bounded 30-second socket deadline for provisioning; this does not change the application pool.

To suspend the experiment, stop submitting semantic searches and disable its API/UI entry point. An authorized operator can drop `episode_summary_v1` to stop automated embedding of changes; preserve canonical episodes and GridFS artifacts. Dropping derived search data is not a rollback of original recordings. Do not edit internal generated-embedding collections directly.

## Account checks and cost

The authenticated CLI is installed at `C:/Users/AC/AppData/Local/MongoDB/AtlasCLI/bin/atlas.exe`; it was absent from PATH. The application cluster was verified as AWS M10 in US West, with disk auto-scaling enabled. The inspected organization policy does not restrict search-index creation. No cluster upgrade, new API key, billing edit, policy change or schema-validator activation was performed. The remaining free-token allocation and inference scope were not verified.

Voyage 4's published token price is US$0.06 per million, with an organization-level one-time allocation documented by MongoDB. Embedding charges include initial text, changed text and queries; these are separate from database/search infrastructure costs. [Current billing documentation](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/billing/)

For dated checks and actual live outcomes, see the [verification report](qa/2026-11-14-atlas-semantic-search.md). The earlier [investigation](atlas-automated-embedding-investigation.md) records requirements and the selected approach.
