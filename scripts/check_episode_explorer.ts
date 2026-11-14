import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { Collection, Document } from 'mongodb';
import { readConfig } from '../server/config.ts';
import { ATLAS_CLIENT_OPTIONS } from '../server/atlasConnection.ts';
import { readEpisodePage, episodePagePipeline } from '../server/episodePage.ts';
import { readEpisodeStats } from '../server/episodeStats.ts';
import { parseEpisodeQuery } from '../server/episodeQuery.ts';
import { episodeFilterParams, EPISODE_SITES } from '../src/simulation/episodeQuery.ts';
import type { EpisodeFilters } from '../src/simulation/episodeQuery.ts';
import { EPISODE_BODIES, EPISODE_MODEL_IDS, EPISODE_END_REASONS } from '../src/simulation/episodeStats.ts';

// Read-only by default. --fixtures creates and drops only a uniquely named test collection.
class CheckFailure extends Error {}
function ensure(condition: boolean, message: string) {
  if (!condition) throw new CheckFailure(message);
}
const category = (value: unknown, allowed: readonly string[]) =>
  typeof value === 'string' && allowed.includes(value) ? value : 'unknown';
const models = (episode: Document) =>
  Array.isArray(episode?.robotModels) && episode.robotModels.length
    ? [...new Set(episode.robotModels.map((r: Document) => category(r?.modelId, EPISODE_MODEL_IDS)))]
    : ['unknown'];
const time = (doc: Document) => (typeof doc.episode?.startedAt === 'string' ? doc.episode.startedAt : '');
function matches(doc: Document, f: EpisodeFilters) {
  const e = doc.episode ?? {};
  return (
    (!f.body || category(e.input?.terrain?.source?.body, EPISODE_BODIES) === f.body) &&
    (!f.site || category(e.input?.terrain?.source?.id, EPISODE_SITES) === f.site) &&
    (!f.termination || category(e.termination, EPISODE_END_REASONS) === f.termination) &&
    (!f.robot || models(e).includes(f.robot)) &&
    (!f.from || time(doc).slice(0, 10) >= f.from) &&
    (!f.to || (Boolean(time(doc)) && time(doc).slice(0, 10) <= f.to))
  );
}
async function allPages(
  collection: Collection,
  filters: EpisodeFilters,
  limit = 3,
  afterFirst?: () => Promise<void>,
) {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 1000; pages++) {
    const params = episodeFilterParams(filters);
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const page = await readEpisodePage(collection, parseEpisodeQuery(params));
    ensure(page.episodes.length <= limit, 'Page exceeded its requested size.');
    for (const row of page.episodes) {
      ensure(!ids.includes(row.id), 'Pagination repeated an episode.');
      ids.push(row.id);
      ensure(
        Object.keys(row).sort().join(',') ===
          'body,downloadUrl,durationS,id,robots,site,siteId,startedAt,termination',
        'Page exposed unexpected fields.',
      );
    }
    if (pages === 0 && afterFirst) await afterFirst();
    cursor = page.nextCursor;
    if (!cursor) return ids;
  }
  throw new CheckFailure('Pagination did not terminate within the verification bound.');
}
const cases: EpisodeFilters[] = [
  {},
  { body: 'earth' },
  { body: 'moon' },
  { body: 'mars' },
  { body: 'unknown' },
  { site: 'amboy-crater' },
  { site: 'apollo-17' },
  { site: 'dingo-gap' },
  { site: 'unknown' },
  { robot: 'husky' },
  { robot: 'jackal' },
  { robot: 'scout' },
  { robot: 'surveyor' },
  { robot: 'unknown' },
  { termination: 'rollover' },
  { termination: 'terrain_boundary' },
  { termination: 'duration_reached' },
  { termination: 'unknown' },
  { body: 'earth', robot: 'husky', termination: 'rollover' },
  { body: 'earth', site: 'dingo-gap' },
  { from: '2026-11-14', to: '2026-11-14' },
  { from: '2026-11-15' },
  { to: '2026-11-13' },
];
async function verify(collection: Collection) {
  const docs = await collection
    .find(
      { state: 'complete' },
      {
        projection: {
          _id: 1,
          'episode.startedAt': 1,
          'episode.input.terrain.source': 1,
          'episode.robotModels.modelId': 1,
          'episode.termination': 1,
        },
        maxTimeMS: 5000,
      },
    )
    .limit(1001)
    .toArray();
  ensure(docs.length <= 1000, 'Verification metadata scan is limited to 1000 episodes.');
  docs.sort((a, b) =>
    time(a) === time(b) ? (String(a._id) > String(b._id) ? -1 : 1) : time(a) > time(b) ? -1 : 1,
  );
  for (const filters of cases) {
    const expected = docs.filter((d) => matches(d, filters)).map((d) => String(d._id));
    const actual = await allPages(collection, filters);
    ensure(
      JSON.stringify(expected) === JSON.stringify(actual),
      `Page membership/order mismatch for ${JSON.stringify(filters)}.`,
    );
    const stats = await readEpisodeStats(collection, undefined, filters);
    ensure(
      stats.totals.episodes === expected.length,
      `Overview count mismatch for ${JSON.stringify(filters)}.`,
    );
  }
  return { episodes: docs.length, filterCases: cases.length };
}
const config = readConfig();
const client = new MongoClient(config.mongodbUri, ATLAS_CLIENT_OPTIONS);
try {
  await client.connect();
  const db = client.db(config.mongodbDb),
    collection = db.collection('physics_episodes');
  const live = await verify(collection);
  const explain: unknown[] = [];
  for (const filters of [{}, { body: 'earth' }, { robot: 'husky' }] as EpisodeFilters[]) {
    const result = await collection
      .aggregate(episodePagePipeline({ filters, limit: 5 }), { maxTimeMS: 5000, allowDiskUse: false })
      .explain('executionStats');
    const cursor = result.stages?.find((s: Document) => s.$cursor)?.$cursor ?? result;
    const plan = JSON.stringify(cursor.queryPlanner?.winningPlan ?? {});
    explain.push({
      filters,
      docsExamined: cursor.executionStats?.totalDocsExamined,
      keysExamined: cursor.executionStats?.totalKeysExamined,
      indexScan: plan.includes('IXSCAN'),
      blockingSort: JSON.stringify(result).includes('"$sort"') || plan.includes('SORT'),
    });
  }
  let fixtures: unknown = 'not requested';
  if (process.argv.includes('--fixtures')) {
    const name = `episode_explorer_check_${randomUUID().replaceAll('-', '')}`;
    const test = await db.createCollection(name);
    try {
      ensure((await verify(test)).episodes === 0, 'Empty library verification failed.');
      const docs: Document[] = Array.from({ length: 33 }, (_, i) => ({
        _id: randomUUID(),
        state: i === 32 ? 'persisting' : 'complete',
        episode: {
          startedAt:
            i < 26
              ? '2026-11-14T12:00:00.000Z'
              : i === 26
                ? '2026-11-14T23:59:59.999Z'
                : i === 27
                  ? '2026-11-15T00:00:00.000Z'
                  : i === 28
                    ? '2026-11-13T23:59:59.999Z'
                    : null,
          input: {
            terrain: {
              source: {
                body: ['earth', 'moon', 'mars', 'venus'][i % 4],
                id: ['amboy-crater', 'apollo-17', 'dingo-gap', 'legacy'][i % 4],
              },
            },
          },
          robotModels: [
            { modelId: ['husky', 'jackal', 'scout', 'surveyor', 'future'][i % 5] },
            { modelId: i % 2 ? 'husky' : 'future' },
          ],
          termination: ['duration_reached', 'rollover', 'terrain_boundary', 'future'][i % 4],
          durationS: 1,
          sensorSamples: 0,
          frames: [{ not: 'projected' }],
          sensorPayload: 'not projected',
        },
      }));
      docs.push(
        { _id: randomUUID(), state: 'complete' },
        {
          _id: randomUUID(),
          state: 'complete',
          episode: {
            startedAt: 42,
            robotModels: [],
            input: { terrain: { source: { body: ['earth'], id: ['amboy-crater'] } } },
            termination: ['rollover'],
          },
        },
      );
      await test.insertMany(docs);
      fixtures = await verify(test);
      const expected = await allPages(test, {}, 5);
      const traversed = await allPages(test, {}, 5, async () => {
        const added: Document = {
          _id: randomUUID(),
          state: 'complete',
          episode: { startedAt: '2026-11-16T00:00:00.000Z' },
        };
        await test.insertOne(added);
      });
      ensure(
        JSON.stringify(traversed) === JSON.stringify(expected),
        'A newer insertion shifted ongoing pagination.',
      );
      ensure(
        (await allPages(test, {}, 5)).length === expected.length + 1,
        'Refresh did not include the newer episode.',
      );
      fixtures = {
        ...(fixtures as object),
        tiedTimestamps: 26,
        unknownAndMissing: true,
        concurrentInsert: true,
        cleanup: true,
      };
    } finally {
      await test.drop();
      ensure(
        !(await db.listCollections({ name }, { nameOnly: true }).hasNext()),
        'Fixture cleanup could not be confirmed.',
      );
    }
  }
  console.log(JSON.stringify({ ok: true, live, explain, fixtures }, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      message:
        error instanceof CheckFailure
          ? error.message
          : 'Episode verification failed; credentials and raw database errors are not logged.',
    }),
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
