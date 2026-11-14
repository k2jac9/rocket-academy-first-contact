import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GridFSBucket, MongoClient, ObjectId } from 'mongodb';
import type { Db, Document } from 'mongodb';
import type { CelestialBody, MissionManifest } from '../src/domain/mission.ts';
import { getSource } from '../src/domain/mission.ts';
import type { MissionRun } from '../src/simulation/missionRun.ts';
import { ROBOT_CATALOG, SOURCE_CATALOG } from './catalog.ts';
import type { ServerConfig } from './config.ts';
import { ApiError } from './errors.ts';
import { bytesHash, jsonHash } from './hash.ts';

export const MAX_MCAP_BYTES = 16 * 1024 * 1024;
export const MAX_RUN_JSON_BYTES = 8 * 1024 * 1024;
export interface AtlasStatus {
  configured: boolean;
  connected: boolean;
}
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

function storageError(): ApiError {
  return new ApiError(
    503,
    'ATLAS_UNAVAILABLE',
    'Atlas is configured but unavailable. Check the server connection, database permissions, and Atlas network access.',
    true,
  );
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
export class AtlasStore implements MissionStore {
  private readonly config: ServerConfig;
  private client: MongoClient | null = null;
  private database: Db | null = null;
  private connecting: Promise<void> | null = null;
  private connected = false;
  private indexesReady = false;
  private lastFailure = 0;

  constructor(config: ServerConfig) {
    this.config = config;
  }
  status(): AtlasStatus {
    return { configured: Boolean(this.config.mongodbUri), connected: this.connected };
  }

  async connect(): Promise<void> {
    if (!this.config.mongodbUri)
      throw new ApiError(
        503,
        'ATLAS_NOT_CONFIGURED',
        'Set MONGODB_URI on the local server to save missions and runs in Atlas.',
      );
    if (this.connected && this.database) return;
    if (this.connecting) return this.connecting;
    if (Date.now() - this.lastFailure < 5_000) throw storageError();
    this.connecting = (async () => {
      try {
        if (!this.client) {
          this.client = new MongoClient(this.config.mongodbUri, {
            appName: 'rocket-academy-first-contact',
            maxPoolSize: 5,
            minPoolSize: 0,
            maxConnecting: 2,
            serverSelectionTimeoutMS: 4_000,
            connectTimeoutMS: 4_000,
            socketTimeoutMS: 10_000,
            waitQueueTimeoutMS: 4_000,
          });
          this.client.on('topologyClosed', () => {
            this.connected = false;
          });
          this.client.on('serverHeartbeatFailed', () => {
            this.connected = false;
          });
          this.client.on('serverHeartbeatSucceeded', () => {
            if (this.database && this.indexesReady) this.connected = true;
          });
        }
        await this.client.connect();
        const db = this.client.db(this.config.mongodbDb);
        await db.command({ ping: 1, maxTimeMS: 4_000 }, { signal: AbortSignal.timeout(4_000) });
        if (!this.indexesReady) {
          await db
            .collection('runs')
            .createIndex({ 'run.mission.body': 1, 'run.startedAt': -1 }, { maxTimeMS: 5_000 });
          await db.collection('decision_events').createIndex({ runId: 1 }, { maxTimeMS: 5_000 });
          this.indexesReady = true;
        }
        this.database = db;
        this.connected = true;
      } catch {
        this.connected = false;
        this.lastFailure = Date.now();
        throw storageError();
      }
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async close(): Promise<void> {
    this.connected = false;
    await this.client?.close();
  }

  private async db(): Promise<Db> {
    await this.connect();
    return this.database!;
  }
  private fail(error: unknown): never {
    if (error instanceof ApiError) throw error;
    this.connected = false;
    this.lastFailure = Date.now();
    throw storageError();
  }

  /** Only explicit Save/Run paths call this; catalog reads do not seed the database. */
  private async seedCatalog(db: Db): Promise<void> {
    await db.collection<StringDocument>('terrain_sources').bulkWrite(
      SOURCE_CATALOG.map((source) => ({
        updateOne: {
          filter: { _id: sourceCatalogId(source) },
          update: { $setOnInsert: { ...source, catalogVersion: '1.0.0' } },
          upsert: true,
        },
      })),
    );
    await db.collection<StringDocument>('robots').bulkWrite(
      ROBOT_CATALOG.map((robot) => ({
        updateOne: {
          filter: { _id: `${robot.id}:${robot.revision}` },
          update: { $setOnInsert: { ...robot } },
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
