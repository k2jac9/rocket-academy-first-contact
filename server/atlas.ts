import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GridFSBucket, ObjectId } from 'mongodb';
import type { Db, Document } from 'mongodb';
import type { CelestialBody, MissionManifest } from '../src/domain/mission.ts';
import { getSource } from '../src/domain/mission.ts';
import type { MissionRun } from '../src/simulation/missionRun.ts';
import { ROBOT_CATALOG, SOURCE_CATALOG } from './catalog.ts';
import { ApiError } from './errors.ts';
import { bytesHash, jsonHash } from './hash.ts';
import { EpisodeStore } from './episodeStore.ts';
import { ExplorationStore } from './explorationStore.ts';
import { AtlasConnection } from './atlasConnection.ts';
import type { AtlasStatus } from './atlasConnection.ts';
import { STORAGE_SCHEMA_VERSION } from './storageSchemas.ts';
export type { AtlasStatus } from './atlasConnection.ts';

export const MAX_MCAP_BYTES = 16 * 1024 * 1024;
export const MAX_RUN_JSON_BYTES = 8 * 1024 * 1024;
export interface MissionRecord {
  id: string;
  mission: MissionManifest;
  createdAt: string;
  storage: 'atlas';
}
export interface ArtifactRecord {
  id: string;
  sha256: string;
  bytes: number;
  storage: 'gridfs';
}
export interface RunRecord {
  id: string;
  run: MissionRun;
  missionId: string;
  planId: string;
  artifact: ArtifactRecord;
  downloadUrl: string;
  storage: 'atlas';
}
export interface RunSummary {
  id: string;
  body: CelestialBody;
  missionName: string;
  startedAt: string;
  durationS: number;
  result: MissionRun['result'];
  planner: MissionRun['planner'];
  artifact: ArtifactRecord;
  downloadUrl: string;
}
export interface MissionStore {
  status(): AtlasStatus;
  checkHealth(): Promise<AtlasStatus>;
  connect(): Promise<void>;
  close(): Promise<void>;
  saveMission(id: string, mission: MissionManifest, requestHash: string): Promise<MissionRecord>;
  findRun(id: string, requestHash?: string): Promise<RunRecord | null>;
  saveRun(run: MissionRun, bytes: Uint8Array, requestHash: string): Promise<RunRecord>;
  listRuns(body: CelestialBody | undefined, limit: number): Promise<RunSummary[]>;
  downloadRun(id: string): Promise<{ stream: ReadableStream<Uint8Array>; artifact: ArtifactRecord }>;
}
type StringDocument = Document & { _id: string };
interface StoredMission extends StringDocument {
  mission: MissionManifest;
  requestHash: string;
  createdAt: string;
  sourceCatalogId?: string;
}
interface StoredRun extends StringDocument {
  state: 'persisting' | 'complete';
  requestHash: string;
  createdAt: string;
  run?: MissionRun;
  missionId?: string;
  planId?: string;
  artifact?: ArtifactRecord;
}

function duplicate(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
function sourceCatalogId(source: (typeof SOURCE_CATALOG)[number]): string {
  return `${source.id}:${source.layer}:${jsonHash(source)}`;
}
function fromStored(document: StoredRun): RunRecord | null {
  if (
    document.state !== 'complete' ||
    !document.run ||
    !document.missionId ||
    !document.planId ||
    !document.artifact
  )
    return null;
  return {
    id: document._id,
    run: document.run,
    missionId: document.missionId,
    planId: document.planId,
    artifact: document.artifact,
    downloadUrl: `/api/runs/${document._id}/mcap`,
    storage: 'atlas',
  };
}

/** Owns one bounded driver pool. Secrets never enter returned records or errors. */
export class AtlasStore extends AtlasConnection implements MissionStore {
  readonly episodes = new EpisodeStore(
    () => this.db(),
    (error) => this.fail(error),
  );
  readonly explorations = new ExplorationStore(
    () => this.db(),
    (error) => this.fail(error),
  );

  /** Only explicit Save/Run paths call this; catalog reads do not seed the database. */
  private async seedCatalog(db: Db): Promise<void> {
    await db.collection<StringDocument>('terrain_sources').bulkWrite(
      SOURCE_CATALOG.map((source) => ({
        updateOne: {
          filter: { _id: sourceCatalogId(source) },
          update: {
            $setOnInsert: {
              ...source,
              catalogVersion: '1.0.0',
              storageSchemaVersion: STORAGE_SCHEMA_VERSION,
            },
          },
          upsert: true,
        },
      })),
    );
    await db.collection<StringDocument>('robots').bulkWrite(
      ROBOT_CATALOG.map((robot) => ({
        updateOne: {
          filter: { _id: `${robot.id}:${robot.revision}` },
          update: { $setOnInsert: { ...robot, storageSchemaVersion: STORAGE_SCHEMA_VERSION } },
          upsert: true,
        },
      })),
    );
  }

  async saveMission(id: string, mission: MissionManifest, requestHash: string): Promise<MissionRecord> {
    try {
      const db = await this.db();
      const missions = db.collection<StoredMission>('missions');
      const existing = await missions.findOne({ _id: id });
      if (existing && existing.requestHash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This request identifier was already used for a different mission.',
        );
      if (existing) return { id, mission: existing.mission, createdAt: existing.createdAt, storage: 'atlas' };
      await this.seedCatalog(db);
      const createdAt = new Date().toISOString();
      await missions.updateOne(
        { _id: id },
        {
          $setOnInsert: {
            storageSchemaVersion: STORAGE_SCHEMA_VERSION,
            mission,
            requestHash,
            createdAt,
            sourceCatalogId: sourceCatalogId(getSource(mission.mode, mission.layer)),
          },
        },
        { upsert: true },
      );
      const saved = await missions.findOne({ _id: id });
      if (!saved || saved.requestHash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This request identifier was already used for a different mission.',
        );
      return { id, mission: saved.mission, createdAt: saved.createdAt, storage: 'atlas' };
    } catch (error) {
      return this.fail(error);
    }
  }

  async findRun(id: string, requestHash?: string): Promise<RunRecord | null> {
    try {
      const document = await (await this.db()).collection<StoredRun>('runs').findOne({ _id: id });
      if (!document) return null;
      if (requestHash && document.requestHash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This request identifier was already used for a different run.',
        );
      const record = fromStored(document);
      if (!record)
        throw new ApiError(
          409,
          'RUN_SAVE_INCOMPLETE',
          'This run is still saving or its previous save was interrupted. Retry shortly or start a new save attempt.',
          true,
        );
      return record;
    } catch (error) {
      return this.fail(error);
    }
  }

  async saveRun(run: MissionRun, bytes: Uint8Array, requestHash: string): Promise<RunRecord> {
    if (bytes.byteLength > MAX_MCAP_BYTES || Buffer.byteLength(JSON.stringify(run)) > MAX_RUN_JSON_BYTES) {
      throw new ApiError(
        413,
        'RUN_TOO_LARGE',
        'This run exceeds the supported recording or metadata size. Shorten the plan.',
      );
    }
    const db = await this.db();
    const runs = db.collection<StoredRun>('runs');
    const existing = await this.findRun(run.runId, requestHash);
    if (existing) return existing;
    try {
      await runs.insertOne({
        storageSchemaVersion: STORAGE_SCHEMA_VERSION,
        _id: run.runId,
        state: 'persisting',
        requestHash,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      if (duplicate(error)) {
        const winner = await this.findRun(run.runId, requestHash);
        if (winner) return winner;
      }
      return this.fail(error);
    }
    const bucket = new GridFSBucket(db, { bucketName: 'run_artifacts' });
    const artifactId = new ObjectId();
    const sha256 = bytesHash(bytes);
    const artifact: ArtifactRecord = {
      id: artifactId.toHexString(),
      sha256,
      bytes: bytes.byteLength,
      storage: 'gridfs',
    };
    const missionId = jsonHash(run.mission);
    const planId = jsonHash({ missionId, plan: run.plan, planner: run.planner });
    const upload = bucket.openUploadStreamWithId(artifactId, `${run.runId}.mcap`, {
      metadata: { runId: run.runId, missionId, planId, sha256, mediaType: 'application/octet-stream' },
    });
    let uploaded = false;
    try {
      await this.seedCatalog(db);
      await db.collection<StoredMission>('missions').updateOne(
        { _id: missionId },
        {
          $setOnInsert: {
            storageSchemaVersion: STORAGE_SCHEMA_VERSION,
            mission: run.mission,
            requestHash: missionId,
            createdAt: run.startedAt,
            sourceCatalogId: sourceCatalogId(getSource(run.mission.mode, run.mission.layer)),
          },
        },
        { upsert: true },
      );
      await db.collection<StringDocument>('plans').updateOne(
        { _id: planId },
        {
          $setOnInsert: {
            storageSchemaVersion: STORAGE_SCHEMA_VERSION,
            missionId,
            plan: run.plan,
            planner: run.planner,
            createdAt: run.startedAt,
            validationVersion: '1.0.0',
          },
        },
        { upsert: true },
      );
      await pipeline(Readable.from([bytes]), upload, { signal: AbortSignal.timeout(30_000) });
      uploaded = true;
      await db.collection<StringDocument>('decision_events').updateOne(
        { _id: `${run.runId}:execution` },
        {
          $setOnInsert: {
            storageSchemaVersion: STORAGE_SCHEMA_VERSION,
            runId: run.runId,
            planId,
            planner: run.planner,
            commands: run.commands,
            rationale: run.plan.rationale,
            result: run.result,
            createdAt: run.startedAt,
          },
        },
        { upsert: true },
      );
      await runs.updateOne(
        { _id: run.runId, requestHash, state: 'persisting' },
        {
          $set: {
            state: 'complete',
            run,
            missionId,
            planId,
            artifact,
            robotConfigId: `${run.robotProfile.id}:${run.robotProfile.revision}`,
          },
        },
      );
      return {
        id: run.runId,
        run,
        missionId,
        planId,
        artifact,
        downloadUrl: `/api/runs/${run.runId}/mcap`,
        storage: 'atlas',
      };
    } catch (error) {
      // A lost write acknowledgement can still mean the metadata committed. Inspect
      // before removing the artifact; do not destroy data when the outcome is unknown.
      const saved = await runs.findOne({ _id: run.runId }).catch(() => undefined);
      const completed = saved ? fromStored(saved) : null;
      if (completed) return completed;
      if (saved !== undefined) {
        if (uploaded) await bucket.delete(artifactId).catch(() => undefined);
        else await upload.abort().catch(() => undefined);
        await db
          .collection('decision_events')
          .deleteMany({ runId: run.runId })
          .catch(() => undefined);
        await runs.deleteOne({ _id: run.runId, requestHash, state: 'persisting' }).catch(() => undefined);
      }
      return this.fail(error);
    }
  }

  async listRuns(body: CelestialBody | undefined, limit: number): Promise<RunSummary[]> {
    try {
      const documents = await (
        await this.db()
      )
        .collection<StoredRun>('runs')
        .find(
          {
            state: 'complete',
            ...(body ? { 'run.mission.body': body } : {}),
          },
          {
            projection: {
              _id: 1,
              artifact: 1,
              'run.mission.body': 1,
              'run.mission.missionName': 1,
              'run.startedAt': 1,
              'run.durationS': 1,
              'run.result': 1,
              'run.planner.kind': 1,
              'run.planner.model': 1,
            },
          },
        )
        .sort({ 'run.startedAt': -1 })
        .limit(limit)
        .toArray();
      return documents
        .filter((document) => document.run && document.artifact)
        .map((document) => ({
          id: document._id,
          body: document.run!.mission.body,
          missionName: document.run!.mission.missionName,
          startedAt: document.run!.startedAt,
          durationS: document.run!.durationS,
          result: document.run!.result,
          planner: document.run!.planner,
          artifact: document.artifact!,
          downloadUrl: `/api/runs/${document._id}/mcap`,
        }));
    } catch (error) {
      return this.fail(error);
    }
  }

  async downloadRun(id: string): Promise<{ stream: ReadableStream<Uint8Array>; artifact: ArtifactRecord }> {
    const record = await this.findRun(id);
    if (!record) throw new ApiError(404, 'RUN_NOT_FOUND', 'This saved run was not found.');
    try {
      const db = await this.db();
      const bucket = new GridFSBucket(db, { bucketName: 'run_artifacts' });
      const objectId = new ObjectId(record.artifact.id);
      const file = await bucket.find({ _id: objectId }).next();
      if (!file || file.length !== record.artifact.bytes || file.length > MAX_MCAP_BYTES)
        throw new ApiError(
          409,
          'ARTIFACT_UNAVAILABLE',
          'The saved MCAP artifact is missing or its metadata does not match.',
        );
      return {
        stream: Readable.toWeb(bucket.openDownloadStream(objectId)) as ReadableStream<Uint8Array>,
        artifact: record.artifact,
      };
    } catch (error) {
      return this.fail(error);
    }
  }
}
