# Atlas connection checks and recovery

The local application's configured Atlas database passed an authenticated read/write and GridFS integrity check on November 14, 2026 at 22:07 UTC. No connection strings, credentials, hostnames, or record contents are included in diagnostic output.

## Observed results

| Check | Result |
| --- | --- |
| Connection | TLS enabled; authenticated primary available in a three-member replica set |
| Five ping samples | 127 ms minimum, 139 ms median, 417 ms maximum |
| Driver reads/writes | Retryable reads and writes enabled; primary reads; majority write concern |
| Saved catalogs | 2 complete mission runs, 10 complete physics episodes, 1 exploration, 6 scenario versions |
| Catalog indexes | Required run, physics-episode, exploration, and scenario indexes present |
| Moon recording | 730,412 bytes read directly from GridFS; SHA-256 matched |
| Earth recording | 776,255 bytes read directly from GridFS; SHA-256 matched |
| Legacy mission recording | 286,387 bytes read directly from GridFS; SHA-256 matched |
| Exploration media | 457,942 bytes read directly from GridFS; SHA-256 matched |
| Isolated write probe | Insert and guarded update succeeded; a fresh client read the committed record |
| Multi-chunk upload | 614,400 bytes uploaded to a diagnostic GridFS bucket and hash-verified by the fresh client |
| Cleanup | Only this invocation's generated diagnostic IDs removed; absence of their metadata, file, and chunks confirmed |
| Local outage probe | Unreachable loopback endpoint returned retryable `ATLAS_UNAVAILABLE` after 4,030 ms |
| Live recovery follow-up | One status probe reported unavailable at 22:08:46 UTC; it recovered without restarting, followed by six healthy probes at 22:09:00–22:09:12 UTC (197–796 ms probe latency) |
| Code verification | 184 tests across 14 files passed; production build and standalone diagnostic TypeScript check passed |

The recording checks bypassed the local `.episodes` cache. Existing application records were read, not overwritten. Two query indexes were added for completed runs and physical episodes. The diagnostic collections may remain empty for later checks. The follow-up failure's underlying cause was not logged; recovery was observed, and uninterrupted availability is not claimed.

## Runtime behavior

`AtlasConnection` owns one MongoClient per API process and shares concurrent startup/probe work. Pools use at most five application connections per server, zero minimum idle connections, and a 60-second idle limit. MongoDB also maintains its own monitoring sockets; the pool limit is not a total socket limit. See the [driver connection pool documentation](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/connection-pools/).

`GET /api/status` remains HTTP 200 while Atlas is unavailable so the local application can explain the problem. Each request performs a primary ping and a small authenticated read, except during a five-second failure cooldown or an already pending shared probe. The response includes the last check timestamp, probe latency when successful, and a redacted error code when unavailable. This proves current primary/read access and initialized application indexes; it does not claim that a write was tested on every refresh.

A heartbeat from one secondary cannot set application readiness. Loss of the primary invalidates readiness; the next successful authenticated probe restores it. Requests during the cooldown do not extend its deadline. Closing the API prevents a pending connection attempt from restoring readiness.

Mission, episode, exploration, and scenario repositories share error handling. Transient driver/network failures return HTTP 503 with `retryable: true`; authentication/authorization failures return `ATLAS_ACCESS_DENIED` with `retryable: false`. Validation and idempotency conflicts keep their original semantics. Programming errors remain service errors and do not masquerade as network outages.

The physical episode worker can retry a transient save up to three total attempts, waiting five seconds between attempts. A terminal storage failure retains its local input, output, and MCAP and reports that persistence was not completed. This does not add a durable background retry queue or automatic recovery of every interrupted publication.

Connection/server selection and pool checkout have four-second limits, inactive sockets ten seconds, and majority write acknowledgement five seconds. Probes and streams also have explicit abort deadlines. These are per-stage bounds, not a claim that an entire multi-command publication always completes within one timeout. The installed Node driver 7.9 deprecates and ignores `timeoutMS`; the application uses supported per-stage settings and stream cancellation instead. See [MongoDB's timeout documentation](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/csot/).

## Repeat the checks

From the repository with `.env.local` configured:

```powershell
npm run check:atlas
npm run check:atlas -- --write
```

The default command reads connection state, catalog counts/indexes, and representative existing artifacts. `--write` adds a uniquely identified probe in `connection_diagnostics` and `connection_diagnostics_artifacts`, checks persistence through a new client, then removes only that invocation's IDs. The command exits nonzero if verification or cleanup fails. A network outage or forced process termination during cleanup can leave diagnostic records; it never deletes unrelated IDs or drops collections.

The API initializes required indexes on startup. If a fresh database has no indexes, start `npm run dev` before running the diagnostic. On an access failure, inspect the database user's rights and the configured database. On a connection failure, check the current machine's egress IP against Atlas network access and verify connectivity before changing credentials.

Automated tests cover shared connection attempts, actual primary/read probes, heartbeat semantics, outage redaction, cooldown/recovery, authorization failures, repository HTTP 503 responses, preserved validation errors, and shutdown races. The live check is evidence for this local session. Provider failover, sustained training throughput, Atlas backup policy, and account-wide network/user policy were not exercised or audited here.
