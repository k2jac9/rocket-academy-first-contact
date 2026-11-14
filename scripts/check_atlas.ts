import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GridFSBucket, MongoClient, ObjectId } from 'mongodb';
import { ATLAS_CLIENT_OPTIONS, atlasError } from '../server/atlasConnection.ts';
import { readConfig } from '../server/config.ts';
import { ApiError } from '../server/errors.ts';

// Default: read-only checks. --write adds an isolated, self-cleaning CRUD/GridFS
// probe. Never log the URI, credentials, hostnames, records, or raw driver errors.
const config = readConfig();
const write = process.argv.includes('--write');
const checks: Record<string, unknown> = {};
let client: MongoClient | null = null;
let stage = 'configuration';
class CheckFailure extends Error {}
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new CheckFailure(message);
}
async function verifyFile(bucket: GridFSBucket, id: ObjectId, expectedBytes: number, expectedHash: string) {
  assert(
    expectedBytes > 0 && expectedBytes <= 32 * 1024 * 1024,
    'Artifact size exceeds the diagnostic limit.',
  );
  const hash = createHash('sha256');
  let bytes = 0;
  await pipeline(
    bucket.openDownloadStream(id),
    new Writable({
      write(chunk, _encoding, next) {
        bytes += chunk.length;
        if (bytes > expectedBytes) return next(new CheckFailure('Artifact exceeds its recorded byte count.'));
        hash.update(chunk);
        next();
      },
    }),
    { signal: AbortSignal.timeout(60_000) },
  );
  assert(
    bytes === expectedBytes && hash.digest('hex') === expectedHash,
    'Artifact hash or byte count mismatch.',
  );
  return bytes;
}

try {
  assert(config.mongodbUri, 'MONGODB_URI is not configured.');
  stage = 'connection';
  client = new MongoClient(config.mongodbUri, ATLAS_CLIENT_OPTIONS);
  await client.connect();
  const db = client.db(config.mongodbDb);
  const timings: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await db.command({ ping: 1, maxTimeMS: 4_000 }, { signal: AbortSignal.timeout(5_000) });
    timings.push(Math.round(performance.now() - start));
  }
  const hello = await db.command({ hello: 1 }, { signal: AbortSignal.timeout(5_000) });
  checks.connection = {
    authenticated: true,
    tls: client.options.tls === true,
    primaryAvailable: hello.isWritablePrimary === true,
    replicaSet: Boolean(hello.setName),
    members: Array.isArray(hello.hosts) ? hello.hosts.length : null,
    retryReads: client.options.retryReads,
    retryWrites: client.options.retryWrites,
    writeConcern: client.options.writeConcern?.w,
    pingMs: {
      min: Math.min(...timings),
      median: [...timings].sort((a, b) => a - b)[2],
      max: Math.max(...timings),
    },
  };
  assert(hello.isWritablePrimary, 'No writable primary is available.');
  stage = 'catalogs-and-indexes';
  const collections: Record<string, unknown> = {};
  for (const [name, filter, expectedIndex] of [
    ['runs', { state: 'complete' }, { state: 1, 'run.startedAt': -1 }],
    ['physics_episodes', { state: 'complete' }, { state: 1, 'episode.startedAt': -1 }],
    ['world_model_explorations', {}, { createdAt: -1, _id: -1 }],
    ['scenario_versions', {}, { createdAt: -1, _id: -1 }],
  ] as const) {
    const collection = db.collection(name);
    const count = await collection.countDocuments(filter, { maxTimeMS: 5_000 });
    const indexes = await collection.listIndexes().toArray();
    const indexReady = indexes.some((index) => JSON.stringify(index.key) === JSON.stringify(expectedIndex));
    collections[name] = { records: count, expectedIndexReady: indexReady };
    assert(indexReady, 'A required catalog index is missing. Start the API to initialize indexes.');
  }
  checks.catalogs = collections;

  stage = 'saved-artifacts';
  const artifacts: { kind: string; bytes: number; verified: true }[] = [];
  for (const body of ['moon', 'earth']) {
    const doc = await db
      .collection('physics_episodes')
      .findOne(
        { state: 'complete', 'episode.input.terrain.source.body': body },
        { projection: { artifact: 1 }, sort: { 'episode.startedAt': -1 }, maxTimeMS: 5_000 },
      );
    if (!doc) continue;
    const bytes = await verifyFile(
      new GridFSBucket(db, { bucketName: 'episode_artifacts' }),
      new ObjectId(doc.artifact.id),
      doc.artifact.bytes,
      doc.artifact.sha256,
    );
    artifacts.push({ kind: `${body}-episode`, bytes, verified: true });
  }
  const run = await db
    .collection('runs')
    .findOne({ state: 'complete' }, { projection: { artifact: 1 }, maxTimeMS: 5_000 });
  if (run) {
    const bytes = await verifyFile(
      new GridFSBucket(db, { bucketName: 'run_artifacts' }),
      new ObjectId(run.artifact.id),
      run.artifact.bytes,
      run.artifact.sha256,
    );
    artifacts.push({ kind: 'mission-run', bytes, verified: true });
  }
  const reference = await db
    .collection('exploration_artifacts.files')
    .findOne({ 'metadata.verified': true }, { maxTimeMS: 5_000 });
  if (reference) {
    const bytes = await verifyFile(
      new GridFSBucket(db, { bucketName: 'exploration_artifacts' }),
      reference._id,
      reference.length,
      reference.metadata.sha256,
    );
    artifacts.push({ kind: 'exploration-media', bytes, verified: true });
  }
  checks.savedArtifacts = artifacts;

  if (write) {
    stage = 'isolated-write-roundtrip';
    const id = `connection-check:${randomUUID()}`;
    const artifactId = new ObjectId();
    const bytes = randomBytes(600 * 1024); // Multiple GridFS chunks.
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const collection = db.collection<{ _id: string; version: number; sha256: string }>(
      'connection_diagnostics',
    );
    const bucket = new GridFSBucket(db, { bucketName: 'connection_diagnostics_artifacts' });
    const fresh = new MongoClient(config.mongodbUri, ATLAS_CLIENT_OPTIONS);
    try {
      await collection.insertOne({ _id: id, version: 0, sha256 });
      const update = await collection.updateOne({ _id: id, version: 0 }, { $set: { version: 1 } });
      assert(update.modifiedCount === 1, 'Guarded metadata update failed.');
      await pipeline(
        Readable.from([bytes]),
        bucket.openUploadStreamWithId(artifactId, id, { metadata: { diagnosticId: id, sha256 } }),
        { signal: AbortSignal.timeout(30_000) },
      );
      await fresh.connect();
      const freshDb = fresh.db(config.mongodbDb);
      const saved = await freshDb
        .collection<{ _id: string; version: number; sha256: string }>('connection_diagnostics')
        .findOne({ _id: id });
      assert(
        saved?.version === 1 && saved?.sha256 === sha256,
        'A new client could not read the committed metadata.',
      );
      await verifyFile(
        new GridFSBucket(freshDb, { bucketName: 'connection_diagnostics_artifacts' }),
        artifactId,
        bytes.length,
        sha256,
      );
      checks.writeRoundtrip = {
        insert: true,
        guardedUpdate: true,
        freshClientRead: true,
        gridfsBytes: bytes.length,
        sha256Verified: true,
      };
    } finally {
      await fresh.close();
      // Delete only this invocation's known IDs, including partial-upload chunks.
      await db.collection('connection_diagnostics_artifacts.chunks').deleteMany({ files_id: artifactId });
      await db.collection('connection_diagnostics_artifacts.files').deleteOne({ _id: artifactId });
      await collection.deleteOne({ _id: id });
      assert(
        (await collection.countDocuments({ _id: id })) === 0,
        'Diagnostic metadata cleanup is incomplete.',
      );
      assert(
        (await db
          .collection('connection_diagnostics_artifacts.chunks')
          .countDocuments({ files_id: artifactId })) === 0,
        'Diagnostic chunk cleanup is incomplete.',
      );
      assert(
        (await db
          .collection('connection_diagnostics_artifacts.files')
          .countDocuments({ _id: artifactId })) === 0,
        'Diagnostic file cleanup is incomplete.',
      );
      checks.diagnosticCleanup = true;
    }
  }
  console.log(
    JSON.stringify(
      { ok: true, checkedAt: new Date().toISOString(), mode: write ? 'read-write' : 'read-only', checks },
      null,
      2,
    ),
  );
} catch (error) {
  const safe = atlasError(error);
  console.error(
    JSON.stringify(
      {
        ok: false,
        stage,
        checks,
        error:
          safe instanceof ApiError
            ? { code: safe.code, message: safe.message }
            : {
                code: 'DIAGNOSTIC_FAILED',
                message:
                  error instanceof CheckFailure
                    ? error.message
                    : 'Atlas diagnostics could not finish. No credentials or raw driver errors are logged.',
              },
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await client?.close();
}
