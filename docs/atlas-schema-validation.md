# Atlas schema validation: implementation and paused rollout

**Handoff: November 14, 2026. Paused at the owner's request. Step 3 is not complete.**

The code and read-only compatibility audit are prepared. No validators have been installed on the nine live application collections. Do not describe the database as enforcing these rules yet. Resume this step before advancing the sequential Atlas plan.

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

All existing envelopes are unversioned. The audit found mission payload version 2.0.0, run/plan/exploration/scenario payload version 1.0.0, and physics payloads without an explicit schema version. All existing run and physics publications are complete. Current `persisting` shapes are covered by the proposed contract and still need the complete live integration verification below.

The configured application account has `readWrite` on the application database. Its effective privileges include creating collections, indexes and Search indexes, but **not `collMod`**. An attempted warning-mode change on an isolated test collection returned MongoDB code 13. The test collections were removed; the live collections were never targeted for mutation. Keep the application account's scope unchanged. A separate migration credential needs read/write verification access and `collMod` for the managed collections; credentials must stay outside Git and chat.

273 automated tests across 18 files, the production build, and a separate strict TypeScript check of the migration scripts passed. Vite's existing large-chunk warning remains. No dependencies were added.

## Prepared implementation

- `server/storageSchemas.ts`: versioned structural rules for the nine metadata collections. New writes add `storageSchemaVersion: "1.0.0"`; missing storage versions remain an explicit legacy format. Existing documents are not rewritten. Unsupported declared storage/payload versions are rejected by the proposed rules.
- Complete runs/episodes require their payload and artifact reference. The initial `persisting` envelope remains valid without either, so publication can proceed in stages. Rules cover identity shapes, timestamp formatting, bounded numeric metadata and existing provenance/fidelity flags. Application validation still owns calendar validity, content hashes, references, transforms, detailed frame semantics and physical validity.
- `server/storageValidation.ts`: read-only counts, version/state inventory, bounded exception ID samples, original-settings snapshots, collection-identity checks, warning/enforcement transitions and rollback. No documents are repaired, removed or relabeled by migration commands.
- `scripts/atlas_schema.ts`: explicit operator-run CLI. Application startup does not change validators. `audit` is read-only; `warn`, `enforce` and `rollback` require a snapshot path. `MONGODB_MIGRATION_URI` overrides the connection only for migration/verification scripts; it does not change the running app configuration.
- MongoDB code 121 becomes HTTP 422 `STORAGE_SCHEMA_REJECTED`, with a safe message and no database payload details. It does not mark Atlas unavailable. Existing network/access handling remains separate.
- GridFS files/chunks are outside this validator rollout. Their driver-managed storage protocol and application artifact checks remain unchanged.

## Verification still to finish

The isolated integration script copies up to 1,000 documents per managed collection into a unique `schema_check_<UUID>_` namespace, exercises repository writers and artifacts there, then drops only its own allowlisted collections. It must be run with `--fixtures`; it does not mutate the source records. If interrupted, inspect and remove only the namespace created by that invocation.

With the current limited account, the second test run created new collections with strict error validators and a separate warning-mode probe. It progressed through legacy-document insertion, malformed-write rejection on all nine collections, timestamp/version/metric rejection, and mission/run save, idempotency and MCAP readback. It then **failed with `ATLAS_UNAVAILABLE` during the physics writer/retry phase**. Cleanup completed and was confirmed. Do not count this as a successful full integration run. Investigate the failing operation and add bounded stream deadlines/progress reporting if needed before repeating the full test.

Physics failed-save cleanup, lost-acknowledgement recovery, interrupted-publication completion, and exploration/scenario writer checks remain unconfirmed by that run. Live `collMod` warning-to-error transitions and rollback were not exercised because the account lacks permission. Unit tests cover rollback guards, wrong targets, replaced collections, changed rules, invalid-record gating and resumption of partial rollouts, but they do not substitute for the live check.

## Resume procedure

Estimated live rollout window: **5–10 minutes after a working migration credential is available**, subject to resolving the unfinished integration check. This is an estimate, not a measured migration duration. No live document copying or rewriting is required. Reads can continue. Coordinate collection-setting changes with any other administrator; these commands are not a cross-collection transaction.

1. Reconfirm Git state and read this handoff. Obtain the separate migration connection through a masked local prompt. If stored locally, use ignored `.env.migration.local` containing `MONGODB_MIGRATION_URI`; retain the existing app URI/database in `.env.local`.
2. Re-run the read-only audit and finish the isolated writer/rollback verification with the migration credential. Do not enable rejection until the full test passes. Inspect any exceptions without deleting or silently changing historical evidence.

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
