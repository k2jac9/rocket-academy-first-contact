import { MongoClient, MongoError } from 'mongodb';
import type { Db, MongoClientOptions } from 'mongodb';
import type { ServerConfig } from './config.ts';
import { ApiError } from './errors.ts';

export interface AtlasStatus {
  configured: boolean;
  connected: boolean;
  lastCheckedAt?: string;
  latencyMs?: number | null;
  errorCode?: string;
}

// Driver 7.9 ignores timeoutMS. Use supported per-stage limits and explicit
// stream/probe deadlines instead. One client owns the pools for this process.
export const ATLAS_CLIENT_OPTIONS: MongoClientOptions = {
  appName: 'rocket-academy-first-contact',
  maxPoolSize: 5,
  minPoolSize: 0,
  maxConnecting: 2,
  maxIdleTimeMS: 60_000,
  serverSelectionTimeoutMS: 4_000,
  connectTimeoutMS: 4_000,
  socketTimeoutMS: 10_000,
  waitQueueTimeoutMS: 4_000,
  retryReads: true,
  retryWrites: true,
  readPreference: 'primary',
  writeConcern: { w: 'majority', wtimeoutMS: 5_000 },
};

export function atlasError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (error instanceof MongoError) {
    if (error.code === 121)
      return new ApiError(
        422,
        'STORAGE_SCHEMA_REJECTED',
        'The record does not match the database storage schema. Check the server and validator versions before retrying.',
      );
    if (error.code === 13 || error.code === 18)
      return new ApiError(
        503,
        'ATLAS_ACCESS_DENIED',
        'Atlas could not authorize database access. Check the server database credentials and permissions.',
      );
    if (error.code === 11000)
      return new ApiError(
        409,
        'STORAGE_CONFLICT',
        'This record already exists. Retry with the original request ID and content.',
      );
    return unavailable();
  }
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return unavailable();
  return error;
}

function unavailable() {
  return new ApiError(
    503,
    'ATLAS_UNAVAILABLE',
    'Atlas is temporarily unavailable. Retry shortly; check the server connection and Atlas network access if this continues.',
    true,
  );
}

export class AtlasConnection {
  private readonly config: ServerConfig;
  private client: MongoClient | null = null;
  private database: Db | null = null;
  private connecting: Promise<void> | null = null;
  private closing = false;
  private connected = false;
  private indexesReady = false;
  private retryAfter = 0;
  private checkedAt?: string;
  private latencyMs: number | null = null;
  private errorCode?: string;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  status(): AtlasStatus {
    return {
      configured: Boolean(this.config.mongodbUri),
      connected: this.connected && !this.closing,
      ...(this.checkedAt ? { lastCheckedAt: this.checkedAt, latencyMs: this.latencyMs } : {}),
      ...(this.errorCode ? { errorCode: this.errorCode } : {}),
    };
  }

  async checkHealth(): Promise<AtlasStatus> {
    if (this.config.mongodbUri) {
      try {
        await this.ensureReady(true);
      } catch {
        /* Status must remain readable during an outage. */
      }
    }
    return this.status();
  }

  connect(): Promise<void> {
    return this.ensureReady(false);
  }

  private async ensureReady(probe: boolean): Promise<void> {
    if (!this.config.mongodbUri)
      throw new ApiError(
        503,
        'ATLAS_NOT_CONFIGURED',
        'Set MONGODB_URI on the local server to save missions and runs in Atlas.',
      );
    if (this.closing) throw unavailable();
    if (this.connecting) return this.connecting;
    if (!probe && this.connected && this.database) return;
    if (Date.now() < this.retryAfter) throw unavailable();
    this.connecting = this.openAndCheck().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async openAndCheck(): Promise<void> {
    const started = performance.now();
    try {
      if (!this.client) {
        this.client = new MongoClient(this.config.mongodbUri, ATLAS_CLIENT_OPTIONS);
        this.client.on('topologyClosed', () => {
          this.connected = false;
        });
        this.client.on('topologyDescriptionChanged', ({ newDescription }) => {
          if (['Unknown', 'ReplicaSetNoPrimary'].includes(newDescription.type)) this.connected = false;
        });
        // A heartbeat from a secondary does not prove authenticated primary access.
        // Only a successful application probe can restore connected=true.
      }
      await this.client.connect();
      const db = this.client.db(this.config.mongodbDb);
      await db.command(
        { ping: 1, maxTimeMS: 4_000 },
        { readPreference: 'primary', signal: AbortSignal.timeout(4_000) },
      );
      await db
        .collection('runs')
        .findOne({}, { projection: { _id: 1 }, maxTimeMS: 4_000, signal: AbortSignal.timeout(4_000) });
      if (!this.indexesReady) {
        for (const [name, keys] of [
          ['runs', { 'run.mission.body': 1, 'run.startedAt': -1 }],
          ['runs', { state: 1, 'run.startedAt': -1 }],
          ['decision_events', { runId: 1 }],
          ['physics_episodes', { state: 1, 'episode.startedAt': -1 }],
          ['world_model_explorations', { createdAt: -1, _id: -1 }],
          ['scenario_versions', { createdAt: -1, _id: -1 }],
          ['exploration_artifacts.files', { 'metadata.sha256': 1, 'metadata.verified': 1 }],
        ] as const) {
          await db.collection(name).createIndex(keys, { maxTimeMS: 5_000 });
        }
        this.indexesReady = true;
      }
      if (this.closing) throw unavailable();
      this.database = db;
      this.connected = true;
      this.retryAfter = 0;
      this.errorCode = undefined;
      this.checkedAt = new Date().toISOString();
      this.latencyMs = Math.round(performance.now() - started);
    } catch (error) {
      // Constructor/URI errors are also redacted at this boundary.
      const failure = atlasError(error);
      const safe = failure instanceof ApiError ? failure : unavailable();
      this.recordFailure(safe);
      throw safe;
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.connected = false;
    await this.connecting?.catch(() => undefined);
    await this.client?.close();
    this.database = null;
  }

  protected async db(): Promise<Db> {
    await this.connect();
    return this.database!;
  }

  protected fail(error: unknown): never {
    const failure = atlasError(error);
    // Rejected requests during backoff must not move the recovery deadline.
    // Nested repositories have already reported an ApiError at its origin.
    if (!(error instanceof ApiError) && failure instanceof ApiError) this.recordFailure(failure);
    throw failure;
  }

  private recordFailure(failure: ApiError) {
    if (['ATLAS_UNAVAILABLE', 'ATLAS_ACCESS_DENIED'].includes(failure.code)) {
      this.connected = false;
      this.retryAfter = Date.now() + 5_000;
      this.checkedAt = new Date().toISOString();
      this.latencyMs = null;
      this.errorCode = failure.code;
    }
  }
}

/** Applies the same redaction and health reporting to every Atlas repository. */
export class AtlasRepository {
  protected readonly database: () => Promise<Db>;
  private readonly failure: (error: unknown) => never;
  constructor(
    database: () => Promise<Db>,
    failure: (error: unknown) => never = (error) => {
      throw atlasError(error);
    },
  ) {
    this.database = database;
    this.failure = failure;
  }
  protected async operation<T>(work: () => Promise<T>, requestSignal?: AbortSignal): Promise<T> {
    try {
      return await work();
    } catch (error) {
      // A browser navigation/filter change is not evidence of a database outage.
      // Keep genuine driver failures and internal deadlines on the shared health path.
      if (requestSignal?.aborted && error === requestSignal.reason) throw error;
      return this.failure(error);
    }
  }
}
