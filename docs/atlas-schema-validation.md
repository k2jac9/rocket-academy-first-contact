# Atlas schema validation: tested implementation and deferred activation

**Handoff updated November 14, 2026. Testing completed within available permissions; live activation deferred at the owner's request. Step 3 is not complete.**

The code, read-only compatibility audit and isolated writer tests are complete. No validators have been installed on the nine live application collections. The owner explicitly selected “Finish testing; defer live activation.” Do not describe the database as enforcing these rules yet. Resume activation only when requested and migration access is available.

## Current evidence

| Collection | Existing records | Incompatible with proposed schema |
| --- | ---: | ---: |
| `missions` | 4 | 0 |
| `plans` | 3 | 0 |
| `decision_events` | 3 | 0 |
| `terrain_sources` | 8 | 0 |
| `robots` | 1 | 0 |
| `runs` | 3 | 0 |
| `physics_episodes` | 10 | 0 |
| `world_model_explorations` | 1 | 0 |
| `scenario_versions` | 6 | 0 |
| **Total** | **39** | **0** |

All existing envelopes are unversioned. The audit found mission payload version 2.0.0, run/plan/exploration/scenario payload version 1.0.0, and physics payloads without an explicit schema version. All existing run and physics publications are complete. The final read-only audit still found the same 39 records, zero incompatible records and no live validators. Current `persisting` shapes passed the isolated structural transition test below.

The configured application account has `readWrite` on the application database. Its effective privileges include creating collections, indexes and Search indexes, but **not `collMod`**. An attempted warning-mode change on an isolated test collection returned MongoDB code 13. The test collections were removed; the live collections were never targeted for mutation. Keep the application account's scope unchanged. A separate migration credential needs read/write verification access and `collMod` for the managed collections; credentials must stay outside Git and chat.

273 automated tests across 18 files, the production build, and a separate strict TypeScript check of the migration scripts passed. Vite's existing large-chunk warning remains. No dependencies were added.

## Prepared implementation

- `server/storageSchemas.ts`: versioned structural rules for the nine metadata collections. New writes add `storageSchemaVersion: "1.0.0"`; missing storage versions remain an explicit legacy format. Existing documents are not rewritten. Unsupported declared storage/payload versions are rejected by the proposed rules.
- Complete runs/episodes require their payload and artifact reference. The initial `persisting` envelope remains valid without either, so publication can proceed in stages. Rules cover identity shapes, timestamp formatting, bounded numeric metadata and existing provenance/fidelity flags. Application validation still owns calendar validity, content hashes, references, transforms, detailed frame semantics and physical validity.
- `server/storageValidation.ts`: read-only counts, version/state inventory, bounded exception ID samples, original-settings snapshots, collection-identity checks, warning/enforcement transitions and rollback. No documents are repaired, removed or relabeled by migration commands.
- `scripts/atlas_schema.ts`: explicit operator-run CLI. Application startup does not change validators. `audit` is read-only; `warn`, `enforce` and `rollback` require a snapshot path. `MONGODB_MIGRATION_URI` overrides the connection only for migration/verification scripts; it does not change the running app configuration.
- MongoDB code 121 becomes HTTP 422 `STORAGE_SCHEMA_REJECTED`, with a safe message and no database payload details. It does not mark Atlas unavailable. Existing network/access handling remains separate.
- GridFS files/chunks are outside this validator rollout. Their driver-managed storage protocol and application artifact checks remain unchanged.

## Completed verification and remaining boundary

The isolated integration script copies existing documents inside Atlas with `$merge` into a unique `schema_check_<UUID>_` namespace. It limits each collection to 1,000 records and 32 MiB, preserves legacy document values, exercises repository writers and artifacts there, then drops only its own allowlisted collections. It must be run with `--fixtures`; it does not mutate the source records. If interrupted, inspect and remove only the namespace created by that invocation.

The previously unfinished physics check is now resolved for storage-contract testing. Instrumentation localized a repeated failure to downloading the fixture's existing MCAP: that transfer exceeded a 60-second deadline before the save tests began. The diagnostic now reports individual phases, logs only safe command names/durations/error codes, copies fixture documents server-side, selects the smallest existing physics recording, and bounds artifact reads by both time and recorded byte count. Application upload/connection deadlines were not changed. This is not a throughput benchmark or proof that larger downloads will finish within the deadline on the current connection.

The completed Atlas fixture run reached all available checks in approximately **43 seconds**, then confirmed cleanup:

- All 39 legacy documents were accepted by strict validators in isolated collections.
- Malformed inserts were rejected across all nine collections. Invalid timestamp types, unknown storage versions, negative/fractional sample counts, NaN/Infinity duration and missing complete-record artifacts were rejected.
- A separate warning-mode collection retained an invalid synthetic record as expected.
- Actual mission/run writers, idempotent repeats, conflicting request detection, run replay identity, MCAP hash comparison and MCAP inspection passed.
- Actual physics writer rejection cleaned up its placeholder and completed artifact. A simulated lost acknowledgement after a successful final update recovered the completed record. Repeating the request produced one artifact; download hash comparison passed.
- A minimal `persisting` envelope was accepted, remained unavailable as a complete episode, and could transition to a structurally complete record. This does not add an automatic recovery queue for every interrupted save.
- Exploration and scenario writers, repeated requests and recorded lineage passed. No external AI generation or new physical simulation was invoked.

**Still unverified:** live `collMod` warning-to-error transitions and rollback, because the account lacks permission. The script reports `collModRollout: false` and rollback as unit-tested only. Unit tests cover rollback guards, wrong targets, replaced collections, changed rules, invalid-record gating and resumption of partial rollouts; they do not substitute for exercising the commands against Atlas with the migration credential.

## Resume procedure

Estimated live rollout window: **5–10 minutes after a working migration credential is available**, including rerunning the fixture with `collMod` and verifying activation. This is an estimate, not a measured migration duration. No live document copying or rewriting is required. Reads can continue. Coordinate collection-setting changes with any other administrator; these commands are not a cross-collection transaction.

1. Reconfirm Git state and read this handoff. Obtain the separate migration connection through a masked local prompt. If stored locally, use ignored `.env.migration.local` containing `MONGODB_MIGRATION_URI`; retain the existing app URI/database in `.env.local`.
2. Re-run the read-only audit and the isolated verification with the migration credential, which enables the additional `collMod` transition and rollback checks. Confirm `collModRollout: true` and `rollback: "verified"` before enabling live rejection. Inspect any exceptions without deleting or silently changing historical evidence.

```powershell
node --env-file-if-exists=.env.local scripts/atlas_schema.ts audit
node --env-file-if-exists=.env.local --env-file=.env.migration.local scripts/check_storage_validation.ts --fixtures
```

3. Use one snapshot path throughout the rollout. Warning mode captures the original settings before its first change. The file is written exclusively, retained on failure, and stored in Git-ignored `.atlas-schema/`. Keep a protected copy for recovery; it contains settings and target fingerprints, not credentials or recordings.

```powershell
node --env-file-if-exists=.env.local --env-file=.env.migration.local scripts/atlas_schema.ts warn .atlas-schema/rollout-2026-11-14.json
```

4. Exercise legitimate current save/retry/replay paths while warnings are enabled, audit again, and inspect any validation failures. Warning mode permits incompatible writes and may include their details in database logs. Then promote to enforcement only with zero incompatible records and the expected warning-mode rules:

```powershell
node --env-file-if-exists=.env.local --env-file=.env.migration.local scripts/atlas_schema.ts audit
node --env-file-if-exists=.env.local --env-file=.env.migration.local scripts/atlas_schema.ts enforce .atlas-schema/rollout-2026-11-14.json
```

5. Verify all nine collections report managed `strict`/`error` rules and zero exceptions. Recheck saved replay/downloads and Atlas health. Record actual evidence and update Step 3 to complete only then. Remove the migration credential from the active environment when finished.

## Rollback and partial progress

```powershell
node --env-file-if-exists=.env.local --env-file=.env.migration.local scripts/atlas_schema.ts rollback .atlas-schema/rollout-2026-11-14.json
```

Rollback restores the saved validator/action/level settings, without changing documents or artifacts. It requires the same database target, schema bundle and collection UUIDs. It refuses to overwrite unrecognized settings changed by another operator. Keep the code revision used for the rollout with its snapshot. The initial rollout intentionally refuses to replace pre-existing nonempty validators; future rule revisions need their own reviewed migration.

If a command fails partway through, retain the snapshot and audit current settings. Re-running the same phase can resume its expected partial state; `warn` refuses to downgrade already enforced rules. `enforce` requires every collection to be on this bundle's warning/error rules. Rollback accepts unchanged original settings or this bundle's warning/error settings. Existing invalid documents are preserved for review; neither strict enforcement nor rollback retroactively repairs them.

MongoDB documents the distinction between [warning and rejection](https://www.mongodb.com/docs/manual/core/schema-validation/handle-invalid-documents/) and [changing validation with `collMod`](https://www.mongodb.com/docs/manual/core/schema-validation/update-schema-validation/).
