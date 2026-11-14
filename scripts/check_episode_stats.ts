import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { Collection, Document } from 'mongodb';
import { readConfig } from '../server/config.ts';
import { ATLAS_CLIENT_OPTIONS } from '../server/atlasConnection.ts';
import { readEpisodeStats } from '../server/episodeStats.ts';
import { EPISODE_BODIES, EPISODE_END_REASONS, EPISODE_MODEL_IDS } from '../src/simulation/episodeStats.ts';

// Default is read-only. --fixtures uses one uniquely named collection, then drops only that collection.
const config = readConfig();
const client = new MongoClient(config.mongodbUri, ATLAS_CLIENT_OPTIONS);
class CheckFailure extends Error {}
function ensure(condition: boolean, message: string) {
  if (!condition) throw new CheckFailure(message);
}
function numeric(value: unknown, integer = false): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER &&
    (!integer || Number.isInteger(value))
  );
}
function category(value: string, allowed: readonly string[]) {
  return allowed.includes(value) ? value : 'unknown';
}
function counts(keys: string[]) {
  const result: Record<string, number> = {};
  for (const key of keys) result[key] = (result[key] ?? 0) + 1;
  return Object.entries(result)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({ key, count }));
}
async function verify(collection: Collection) {
  const stats = await readEpisodeStats(collection);
  const docs = await collection
    .find(
      { state: 'complete' },
      {
        projection: {
          _id: 0,
          'episode.durationS': 1,
          'episode.sensorSamples': 1,
          'episode.input.terrain.source.body': 1,
          'episode.termination': 1,
          'episode.robotModels.modelId': 1,
        },
        maxTimeMS: 5000,
      },
    )
    .limit(1001)
    .toArray();
  ensure(
    docs.length <= 1000,
    'Independent scan is limited to 1000 records; narrow the verification workload.',
  );
  const durations = docs.map((d) => d.episode?.durationS).filter((v) => numeric(v));
  const samples = docs.map((d) => d.episode?.sensorSamples).filter((v) => numeric(v, true));
  ensure(stats.totals.episodes === docs.length, 'Saved episode count disagrees with metadata.');
  ensure(
    Math.abs(stats.totals.durationS - durations.reduce((a, b) => a + b, 0)) < 1e-8,
    'Recorded duration total disagrees with metadata.',
  );
  ensure(stats.totals.durationEpisodes === durations.length, 'Duration coverage disagrees with metadata.');
  ensure(
    stats.totals.sensorSamples === samples.reduce((a, b) => a + b, 0),
    'Camera-pair total disagrees with metadata.',
  );
  ensure(stats.totals.sensorEpisodes === samples.length, 'Camera-pair coverage disagrees with metadata.');
  const expected = {
    byBody: counts(docs.map((d) => category(d.episode?.input?.terrain?.source?.body, EPISODE_BODIES))),
    byTermination: counts(docs.map((d) => category(d.episode?.termination, EPISODE_END_REASONS))),
    byRobot: counts(
      docs.flatMap((d) => {
        const robots = d.episode?.robotModels;
        if (!Array.isArray(robots) || robots.length === 0) return ['unknown'];
        return [...new Set(robots.map((r) => category(r?.modelId, EPISODE_MODEL_IDS)))];
      }),
    ),
  };
  for (const key of ['byBody', 'byTermination', 'byRobot'] as const) {
    ensure(
      JSON.stringify(stats[key].map((r) => ({ key: r.key, count: r.count }))) ===
        JSON.stringify(expected[key]),
      `${key} disagrees with metadata.`,
    );
  }
  return stats.totals;
}

try {
  await client.connect();
  const db = client.db(config.mongodbDb);
  const live = await verify(db.collection('physics_episodes'));
  let fixtures: unknown = 'not requested';
  if (process.argv.includes('--fixtures')) {
    const name = `episode_stats_check_${randomUUID().replaceAll('-', '')}`;
    const collection = await db.createCollection(name);
    try {
      await verify(collection);
      const episode = (
        body: string,
        models: string[],
        durationS: unknown,
        sensorSamples: unknown,
        termination: string,
      ): Document => ({
        state: 'complete',
        episode: {
          input: { terrain: { source: { body } } },
          robotModels: models.map((modelId) => ({ modelId })),
          durationS,
          sensorSamples,
          termination,
        },
      });
      await collection.insertMany([
        episode('earth', ['husky', 'husky'], 5, 2, 'duration_reached'),
        episode('moon', ['jackal', 'future'], 0.5, 0, 'terrain_boundary'),
        episode('mars', ['scout'], null, -2, 'rollover'),
        episode('venus', [], 'not numeric', 3.5, 'future'),
        { state: 'complete' },
        episode('earth', ['surveyor'], Infinity, NaN, 'future'),
        { ...episode('earth', ['husky'], 99, 999, 'duration_reached'), state: 'persisting' },
        { ...episode('earth', ['husky'], 99, 999, 'duration_reached'), state: 'failed' },
      ]);
      const totals = await verify(collection);
      ensure(
        totals.episodes === 6 && totals.durationS === 5.5 && totals.sensorSamples === 2,
        'Fixture totals are incorrect.',
      );
      fixtures = {
        empty: true,
        mixed: true,
        duplicateModels: true,
        unknownMetadata: true,
        missingMetrics: true,
      };
    } finally {
      await collection.drop();
      ensure(
        !(await db.listCollections({ name }, { nameOnly: true }).hasNext()),
        'Fixture cleanup could not be confirmed.',
      );
    }
  }
  console.log(JSON.stringify({ ok: true, live, fixtures }, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      message:
        error instanceof CheckFailure
          ? error.message
          : 'Statistics verification failed. No credentials or raw database errors are logged.',
    }),
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
