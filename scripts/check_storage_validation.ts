import { randomUUID } from 'node:crypto';
import { MongoClient, MongoNetworkError, ObjectId, GridFSBucket } from 'mongodb';
import type { Db, Document } from 'mongodb';
import { readConfig } from '../server/config.ts';
import { ATLAS_CLIENT_OPTIONS } from '../server/atlasConnection.ts';
import { AtlasStore } from '../server/atlas.ts';
import { EpisodeStore } from '../server/episodeStore.ts';
import { createMissionManifest } from '../src/domain/mission.ts';
import { createBaselinePlan, runMission, ROBOT_PROFILE } from '../src/simulation/missionRun.ts';
import { encodeRunMcap, inspectRunMcap } from '../src/recording/mcap.ts';
import { jsonHash, bytesHash } from '../server/hash.ts';
import { STORAGE_SCHEMA_VERSION } from '../server/storageSchemas.ts';
import {
  applyValidation,
  auditStorage,
  captureSnapshot,
  desired,
  check,
  schemaNames,
  ValidationCheckError,
} from '../server/storageValidation.ts';

const config = readConfig({
    ...process.env,
    MONGODB_URI: process.env.MONGODB_MIGRATION_URI ?? process.env.MONGODB_URI,
  }),
  client = new MongoClient(config.mongodbUri, ATLAS_CLIENT_OPTIONS);
async function rejected(work: () => Promise<unknown>, code: number | string) {
  try {
    await work();
  } catch (error) {
    check((error as { code: unknown }).code === code, `Expected rejection ${code}.`);
    return;
  }
  throw new ValidationCheckError(`Expected rejection ${code}, but write succeeded.`);
}
async function streamBytes(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
try {
  check(
    process.argv.length === 3 && process.argv[2] === '--fixtures',
    'Run with --fixtures for isolated write verification; use atlas_schema.ts audit for read-only checks.',
  );
  await client.connect();
  const db = client.db(config.mongodbDb);
  const permissions = await db.command({ connectionStatus: 1, showPrivileges: true });
  const canModify = permissions.authInfo.authenticatedUserPrivileges.some(
    (p: Document) =>
      (p.actions.includes('collMod') || p.actions.includes('anyAction')) &&
      (p.resource.anyResource ||
        ((p.resource.db === '' || p.resource.db === config.mongodbDb) && p.resource.collection === '')),
  );
  const prefix = `schema_check_${randomUUID().replaceAll('-', '')}_`;
  const namespace = (name: string) => prefix + name;
  const allowed = new Set([
    ...schemaNames,
    'warning_probe',
    ...['episode_artifacts', 'run_artifacts', 'exploration_artifacts'].flatMap((n) => [
      `${n}.files`,
      `${n}.chunks`,
    ]),
  ]);
  check(
    !(await db.listCollections({ name: { $regex: `^${prefix}` } }, { nameOnly: true }).hasNext()),
    'Fixture namespace already exists.',
  );
  let phase = 'create';
  try {
    for (const name of schemaNames) {
      await db.createCollection(namespace(name), canModify ? {} : desired(name, 'error'));
      const docs = await db.collection(name).find({}, { maxTimeMS: 10000 }).limit(1001).toArray();
      check(docs.length <= 1000, 'Fixture legacy-copy limit is 1,000 records per collection.');
      if (docs.length) await db.collection(namespace(name)).insertMany(docs);
    }
    const snapshot = canModify ? await captureSnapshot(db, prefix, namespace) : null;
    phase = 'warning rollout';
    const temp = db.collection(namespace('physics_episodes'));
    const bad: Document = { _id: randomUUID(), state: 'complete' };
    if (snapshot) {
      await applyValidation(db, snapshot, prefix, 'warn', namespace);
      await temp.insertOne(bad);
      check(
        (await auditStorage(db, namespace)).find((r) => r.name === 'physics_episodes')?.invalid === 1,
        'Warning mode did not preserve an invalid fixture for review.',
      );
      let blocked = false;
      try {
        await applyValidation(db, snapshot, prefix, 'enforce', namespace);
      } catch (e) {
        blocked = e instanceof ValidationCheckError;
      }
      check(blocked, 'Invalid existing fixture did not block enforcement.');
      await temp.deleteOne({ _id: bad._id });
      phase = 'enforcement';
      await applyValidation(db, snapshot, prefix, 'enforce', namespace);
    } else {
      const warning = await db.createCollection(
        namespace('warning_probe'),
        desired('physics_episodes', 'warn'),
      );
      await warning.insertOne(bad);
      check(
        (await warning.countDocuments({})) === 1,
        'Warning collection did not retain the invalid test record.',
      );
    }
    phase = 'enforced writes';
    for (const name of schemaNames) await rejected(() => db.collection(namespace(name)).insertOne({}), 121);
    const sample = await temp.findOne({ state: 'complete' });
    check(
      sample?.episode && sample.artifact,
      'A saved physics episode is needed for the storage round-trip check.',
    );
    for (const changes of [
      { $set: { 'episode.startedAt': 42 } },
      { $set: { storageSchemaVersion: '99.0.0' } },
      { $set: { 'episode.sensorSamples': -1 } },
      { $set: { 'episode.sensorSamples': 1.5 } },
      { $set: { 'episode.durationS': NaN } },
      { $set: { 'episode.durationS': Infinity } },
      { $unset: { artifact: '' } },
    ]) {
      await rejected(() => temp.updateOne({ _id: sample._id }, changes), 121);
    }
    // Exercise the actual repositories; all collection calls (including GridFS) stay inside this prefix.
    const isolated = new Proxy(db, {
      get(target, key) {
        if (key === 'collection')
          return (name: string) => {
            check(allowed.has(name), 'Unexpected writer collection.');
            return target.collection(namespace(name));
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    class FixtureStore extends AtlasStore {
      protected override async db(): Promise<Db> {
        return isolated;
      }
    }
    const store = new FixtureStore(config);
    phase = 'mission and run writers';
    const mission = createMissionManifest({
      mode: 'dingo-gap',
      rover: { x: 0, y: 0, z: 0 },
      goal: { x: 1, y: 0, z: 0 },
      createdAt: new Date().toISOString(),
      missionName: 'Isolated validator check',
    });
    const missionId = randomUUID(),
      missionHash = jsonHash(mission);
    await store.saveMission(missionId, mission, missionHash);
    await store.saveMission(missionId, mission, missionHash);
    await rejected(() => store.saveMission(missionId, mission, '0'.repeat(64)), 'IDEMPOTENCY_CONFLICT');
    const run = runMission({
      mission,
      plan: createBaselinePlan(mission),
      planner: { kind: 'baseline' },
      runId: randomUUID(),
      robotId: ROBOT_PROFILE.id,
      startedAt: new Date().toISOString(),
      seed: 1,
    });
    const bytes = await encodeRunMcap(run),
      requestHash = jsonHash(run);
    await store.saveRun(run, bytes, requestHash);
    await store.saveRun(run, bytes, requestHash);
    const runDownload = await store.downloadRun(run.runId),
      runBytes = await streamBytes(runDownload.stream);
    check(bytesHash(runBytes) === bytesHash(bytes), 'Run artifact hash changed.');
    await inspectRunMcap(runBytes);
    check((await store.findRun(run.runId))?.run.runId === run.runId, 'Run replay identity changed.');
    phase = 'physics writer and retry recovery';
    const sourceBucket = new GridFSBucket(db, { bucketName: 'episode_artifacts' }),
      chunks: Buffer[] = [];
    for await (const chunk of sourceBucket.openDownloadStream(new ObjectId(sample.artifact.id)))
      chunks.push(chunk);
    const physicsBytes = Buffer.concat(chunks);
    check(bytesHash(physicsBytes) === sample.artifact.sha256, 'Source physics artifact hash mismatch.');
    await temp.deleteOne({ _id: sample._id }); // Only the isolated metadata copy, never the source recording.
    const invalid = structuredClone(sample.episode);
    delete invalid.engine;
    await rejected(
      () => store.episodes.save(invalid, physicsBytes, sample.requestHash),
      'STORAGE_SCHEMA_REJECTED',
    );
    check(!(await temp.findOne({ _id: sample._id })), 'Failed save left a placeholder after cleanup.');
    check(
      (await db.collection(namespace('episode_artifacts.files')).countDocuments({})) === 0,
      'Failed save left a completed GridFS artifact.',
    );
    // Simulate a lost acknowledgement after the guarded complete update actually commits.
    let loseAcknowledgement = true;
    const failing = new Proxy(isolated, {
      get(target, key) {
        if (key !== 'collection') {
          const v = Reflect.get(target, key);
          return typeof v === 'function' ? v.bind(target) : v;
        }
        return (name: string) => {
          const col = target.collection(name);
          if (name !== 'physics_episodes') return col;
          return new Proxy(col, {
            get(c, k) {
              if (k === 'updateOne')
                return async (...args: Parameters<typeof col.updateOne>) => {
                  const result = await c.updateOne(...args);
                  if (loseAcknowledgement) {
                    loseAcknowledgement = false;
                    throw new MongoNetworkError('Simulated lost acknowledgement');
                  }
                  return result;
                };
              const v = Reflect.get(c, k);
              return typeof v === 'function' ? v.bind(c) : v;
            },
          });
        };
      },
    });
    const recoveryStore = new EpisodeStore(async () => failing);
    await recoveryStore.save(sample.episode, physicsBytes, sample.requestHash);
    await store.episodes.save(sample.episode, physicsBytes, sample.requestHash);
    check(
      (await db.collection(namespace('episode_artifacts.files')).countDocuments({})) === 1,
      'Retry duplicated physics artifacts.',
    );
    check(
      bytesHash(await streamBytes((await store.episodes.download(sample.episode.id)).stream)) ===
        sample.artifact.sha256,
      'Physics replay artifact changed.',
    );
    const pending: Document = {
      _id: randomUUID(),
      requestHash: '0'.repeat(64),
      state: 'persisting',
      storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    };
    await temp.insertOne(pending);
    await rejected(() => store.episodes.find(pending._id), 'EPISODE_INCOMPLETE');
    await temp.updateOne(
      { _id: pending._id },
      {
        $set: {
          state: 'complete',
          episode: { ...sample.episode, id: pending._id },
          artifact: sample.artifact,
        },
      },
    );
    check(
      (await store.episodes.find(pending._id))?.id === pending._id,
      'Interrupted publication could not transition to complete.',
    );
    phase = 'exploration and scenario writers';
    const brief = {
      title: 'Storage validation fixture',
      body: 'moon',
      objective: 'Verify storage contracts.',
      prompt: 'A lunar reference traverse.',
      model: 'unknown',
      modelRevision: null,
      settingsNotes: 'Isolated storage test; no generated world.',
      referenceImageSha256: null,
      recordingSha256: null,
    };
    const explorationId = randomUUID();
    await store.explorations.create(explorationId, brief);
    await store.explorations.create(explorationId, brief);
    const scenarioId = randomUUID(),
      scenario = {
        explorationId,
        title: 'Storage scenario fixture',
        body: 'moon',
        robotModels: ['husky', 'jackal'],
        durationS: 5,
        speedMps: 0.2,
        seed: 1,
      };
    await store.explorations.createScenario(scenarioId, scenario);
    await store.explorations.createScenario(scenarioId, scenario);
    check(
      (await store.explorations.getScenario(scenarioId)).input.explorationId === explorationId,
      'Scenario lineage changed.',
    );
    const audit = await auditStorage(db, namespace);
    check(
      audit.every((r) => r.invalid === 0),
      'A current writer produced an incompatible document.',
    );
    phase = 'rollback';
    if (snapshot) {
      await applyValidation(db, snapshot, prefix, 'rollback', namespace);
      await temp.insertOne(bad);
      await temp.deleteOne({ _id: bad._id });
      check(
        (await auditStorage(db, namespace)).every((r) => !r.hasValidator),
        'Rollback did not restore the original settings.',
      );
    }
    console.log(
      JSON.stringify({
        ok: true,
        legacyCompatibility: true,
        warningAndEnforcement: true,
        rejectedCollections: schemaNames.length,
        writerRoundTrips: true,
        idempotency: true,
        failedSaveCleanup: true,
        lostAcknowledgementRecovery: true,
        persistingTransition: true,
        collModRollout: canModify,
        rollback: canModify ? 'verified' : 'requires collMod; unit-tested only',
      }),
    );
  } catch (error) {
    throw new ValidationCheckError(
      `Fixture phase ${phase} failed (${error instanceof ValidationCheckError ? error.message : ((error as { code?: unknown }).code ?? 'redacted error')}).`,
    );
  } finally {
    const collections = await db
      .listCollections({ name: { $regex: `^${prefix}` } }, { nameOnly: true })
      .toArray();
    for (const { name } of collections) {
      check(
        name.startsWith(prefix) && allowed.has(name.slice(prefix.length)),
        'Unexpected fixture collection; refusing cleanup.',
      );
      await db.collection(name).drop();
    }
    check(
      !(await db.listCollections({ name: { $regex: `^${prefix}` } }, { nameOnly: true }).hasNext()),
      'Fixture cleanup could not be confirmed.',
    );
    console.log(JSON.stringify({ fixtureCleanup: true }));
  }
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      message:
        error instanceof ValidationCheckError
          ? error.message
          : 'Storage verification failed; database details and credentials are redacted.',
    }),
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
