import type { Db, Document } from 'mongodb';
import type { EpisodeFilters, EpisodeSummary } from '../src/simulation/episodeQuery.ts';
import type { EpisodeSearchResult, EpisodeSearchStatus } from '../src/simulation/episodeSearch.ts';
import { EPISODE_SITES } from '../src/simulation/episodeQuery.ts';
import { EPISODE_BODIES, EPISODE_MODEL_IDS, EPISODE_END_REASONS } from '../src/simulation/episodeStats.ts';
import { ApiError, exactKeys } from './errors.ts';
import { episodeFilter, nextDay, parseEpisodeQuery } from './episodeQuery.ts';
import { jsonHash } from './hash.ts';

export const SEARCH_COLLECTION = 'episode_search_v1';
export const SEARCH_INDEX = 'episode_summary_v1';
export const SEARCH_MODEL = 'voyage-4';
export const SEARCH_VERSION = '1.0.0';
export const MAX_SEARCH_EPISODES = 1000;
export const SEARCH_DEFINITION = {
  fields: [
    {
      type: 'autoEmbed',
      path: 'summary',
      modality: 'text',
      model: SEARCH_MODEL,
      numDimensions: 1024,
      quantization: 'float',
      similarity: 'dotProduct',
    },
    ...['sourceKind', 'body', 'siteId', 'robots', 'termination', 'startedAtDate', 'projectionVersion'].map(
      (path) => ({ type: 'filter', path }),
    ),
  ],
};
export const SEARCH_SOURCE_FIELDS = {
  _id: 1,
  state: 1,
  requestHash: 1,
  'artifact.sha256': 1,
  'episode.startedAt': 1,
  'episode.durationS': 1,
  'episode.termination': 1,
  'episode.input.terrain.source.id': 1,
  'episode.input.terrain.source.body': 1,
  'episode.robotModels.modelId': 1,
  'episode.terrainSha256': 1,
  'episode.modelSha256': 1,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const sites: Record<string, string> = {
  'dingo-gap': 'Dingo Gap',
  'apollo-17': 'Apollo 17',
  'amboy-crater': 'Amboy Crater',
  unknown: 'Unknown / legacy site',
};
const robotNames: Record<string, string> = {
  husky: 'Clearpath Husky',
  jackal: 'Clearpath Jackal',
  scout: 'legacy Scout rover',
  surveyor: 'legacy Surveyor rover',
  unknown: 'unknown robot',
};
const endReasons: Record<string, string> = {
  duration_reached: 'duration limit reached (not a success determination)',
  rollover: 'rollover (robot tipped over)',
  terrain_boundary: 'terrain boundary reached',
  unknown: 'unknown end reason',
};
const known = (value: unknown, allowed: readonly string[]) =>
  typeof value === 'string' && allowed.includes(value) ? value : 'unknown';
export interface SearchProjection extends Document {
  _id: string;
  projectionVersion: string;
  sourceKind: string;
  sourceHash: string;
  artifactSha256: string;
  summary: string;
  body: string;
  siteId: string;
  robots: string[];
  termination: string;
  startedAt: string | null;
  startedAtDate: Date | null;
  durationS: number | null;
}
/** Embed only allowlisted facts; never arbitrary prompts, recordings, model XML or credentials. */
export function buildSearchProjection(doc: Document): SearchProjection | null {
  if (
    doc.state !== 'complete' ||
    typeof doc._id !== 'string' ||
    !UUID.test(doc._id) ||
    typeof doc.artifact?.sha256 !== 'string' ||
    !HASH.test(doc.artifact.sha256)
  )
    return null;
  const e = doc.episode ?? {};
  const body = known(e.input?.terrain?.source?.body, EPISODE_BODIES);
  const siteId = known(e.input?.terrain?.source?.id, EPISODE_SITES);
  const robots = [
    ...new Set<string>(
      (Array.isArray(e.robotModels) && e.robotModels.length ? e.robotModels : [{}]).map(
        (r: { modelId?: unknown } | null) => known(r?.modelId, EPISODE_MODEL_IDS),
      ),
    ),
  ].sort();
  const termination = known(e.termination, EPISODE_END_REASONS);
  const startedAt =
    typeof e.startedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(e.startedAt) &&
    Number.isFinite(Date.parse(e.startedAt)) &&
    new Date(e.startedAt).toISOString() === e.startedAt
      ? e.startedAt
      : null;
  const durationS =
    typeof e.durationS === 'number' && Number.isFinite(e.durationS) && e.durationS >= 0 ? e.durationS : null;
  const summary = `${body === 'moon' ? 'Moon lunar' : body === 'mars' ? 'Mars Martian' : body === 'earth' ? 'Earth terrestrial' : 'Unknown world'} physics episode at ${sites[siteId]}. Robots: ${robots.map((r) => robotNames[r]).join(', ')}. End reason: ${endReasons[termination]}. Duration: ${durationS === null ? 'not recorded' : `${durationS} seconds`}. Prototype simulation; consult the recording for its limitations. Training eligibility has not been assessed.`;
  const facts = {
    _id: doc._id,
    projectionVersion: SEARCH_VERSION,
    sourceKind: 'physics_simulation',
    body,
    siteId,
    robots,
    termination,
    startedAt,
    durationS,
    artifactSha256: doc.artifact.sha256,
    summary,
  };
  const sourceHash = jsonHash({
    ...facts,
    requestHash: doc.requestHash ?? null,
    terrainSha256: e.terrainSha256 ?? null,
    modelSha256: e.modelSha256 ?? null,
  });
  return { ...facts, sourceHash, startedAtDate: startedAt ? new Date(startedAt) : null };
}
export interface EpisodeSearchQuery {
  query: string;
  filters: EpisodeFilters;
  limit: number;
}
export function parseEpisodeSearch(value: unknown): EpisodeSearchQuery {
  exactKeys(value, ['query'], ['filters', 'limit']);
  if (
    typeof value.query !== 'string' ||
    !value.query.trim() ||
    value.query.length > 500 ||
    /[\u0000-\u001f]/.test(value.query)
  )
    throw new ApiError(422, 'INVALID_SEARCH', 'Enter a search phrase of 1–500 characters.');
  const filters = value.filters ?? {};
  exactKeys(filters, [], ['body', 'site', 'robot', 'termination', 'from', 'to']);
  const params = new URLSearchParams();
  for (const [key, item] of Object.entries(filters)) {
    if (typeof item !== 'string')
      throw new ApiError(422, 'INVALID_SEARCH', 'Search filters must be text values.');
    params.set(key, item);
  }
  const parsed = parseEpisodeQuery(params, false);
  const limit = value.limit ?? 10;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 20)
    throw new ApiError(422, 'INVALID_SEARCH', 'Search returns between 1 and 20 episodes.');
  return { query: value.query.trim(), filters: parsed.filters, limit: Number(limit) };
}
export function searchPipeline(query: EpisodeSearchQuery): Document[] {
  const filter: Document = { projectionVersion: SEARCH_VERSION, sourceKind: 'physics_simulation' };
  for (const [key, field] of [
    ['body', 'body'],
    ['site', 'siteId'],
    ['robot', 'robots'],
    ['termination', 'termination'],
  ] as const)
    if (query.filters[key]) filter[field] = query.filters[key];
  if (query.filters.from || query.filters.to)
    filter.startedAtDate = {
      ...(query.filters.from ? { $gte: new Date(`${query.filters.from}T00:00:00.000Z`) } : {}),
      ...(query.filters.to ? { $lt: new Date(nextDay(query.filters.to)) } : {}),
    };
  return [
    {
      $vectorSearch: {
        index: SEARCH_INDEX,
        path: 'summary',
        query: { text: query.query },
        numCandidates: Math.max(100, query.limit * 20),
        limit: query.limit,
        filter,
      },
    },
    { $project: { _id: 1, sourceHash: 1, score: { $meta: 'vectorSearchScore' } } },
  ];
}
export function projectionSummary(p: SearchProjection): EpisodeSummary {
  return {
    id: p._id,
    startedAt: p.startedAt,
    durationS: p.durationS,
    termination: p.termination,
    site: sites[p.siteId],
    siteId: p.siteId,
    body: p.body,
    robots: p.robots,
    downloadUrl: `/api/episodes/${p._id}/mcap`,
  };
}
export async function episodeSearchStatus(db: Db, signal?: AbortSignal): Promise<EpisodeSearchStatus> {
  signal?.throwIfAborted();
  const indexes = await db
    .collection(SEARCH_COLLECTION)
    .aggregate([{ $listSearchIndexes: { name: SEARCH_INDEX } }], { maxTimeMS: 5000, signal })
    .toArray()
    .catch((error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 26) return [];
      throw error;
    });
  const index = indexes[0];
  if (index && jsonHash(index.latestDefinition) !== jsonHash(SEARCH_DEFINITION))
    throw new ApiError(
      503,
      'SEARCH_CONFIG_MISMATCH',
      'The episode search index does not match this application version.',
    );
  return {
    status: !index
      ? 'not_configured'
      : index.status === 'READY' && index.queryable
        ? 'ready'
        : ['FAILED', 'STALE'].includes(index.status)
          ? 'failed'
          : 'building',
    model: SEARCH_MODEL,
    projectionVersion: SEARCH_VERSION,
  };
}
/** Rebuildable metadata only. This bounded prototype deliberately refuses an unbounded backfill. */
export async function syncEpisodeSearch(
  db: Db,
  signal?: AbortSignal,
): Promise<{ changed: number; count: number }> {
  const source = await db
    .collection('physics_episodes')
    .find({ state: 'complete' }, { projection: SEARCH_SOURCE_FIELDS, maxTimeMS: 5000, signal })
    .limit(MAX_SEARCH_EPISODES + 1)
    .toArray();
  if (source.length > MAX_SEARCH_EPISODES)
    throw new ApiError(
      409,
      'SEARCH_CORPUS_LIMIT',
      'The search prototype supports at most 1,000 episodes. A batch backfill is required.',
    );
  const projections = source.map(buildSearchProjection).filter((p): p is SearchProjection => p !== null);
  const collection = db.collection<SearchProjection>(SEARCH_COLLECTION);
  const previous = await collection
    .find({}, { projection: { _id: 1, sourceHash: 1 }, maxTimeMS: 5000, signal })
    .limit(MAX_SEARCH_EPISODES + 1)
    .toArray();
  if (previous.length > MAX_SEARCH_EPISODES)
    throw new ApiError(409, 'SEARCH_CORPUS_LIMIT', 'The search projection requires a batch reconciliation.');
  const hashes = new Map(previous.map((p) => [p._id, p.sourceHash]));
  const updates = projections.filter((p) => p.sourceHash !== hashes.get(p._id));
  signal?.throwIfAborted();
  if (updates.length)
    await collection.bulkWrite(
      updates.map((p) => ({ replaceOne: { filter: { _id: p._id }, replacement: p, upsert: true } })),
      { ordered: false, maxTimeMS: 5000 },
    );
  const live = new Set(projections.map((p) => p._id));
  const stale = previous.filter((p) => !live.has(p._id));
  signal?.throwIfAborted();
  if (stale.length)
    await collection.deleteMany({ _id: { $in: stale.map((p) => p._id) } }, { maxTimeMS: 5000 });
  return { changed: updates.length + stale.length, count: projections.length };
}
export function verifiedSearchResults(
  hits: Document[],
  canonical: Document[],
): EpisodeSearchResult['episodes'] {
  const current = new Map(
    canonical
      .map(buildSearchProjection)
      .filter((p): p is SearchProjection => p !== null)
      .map((p) => [p._id, p]),
  );
  return hits.flatMap((hit) => {
    const p = current.get(hit._id);
    return p && hit.sourceHash === p.sourceHash && typeof hit.score === 'number' && Number.isFinite(hit.score)
      ? [{ ...projectionSummary(p), summary: p.summary, score: hit.score }]
      : [];
  });
}
export async function searchEpisodes(
  db: Db,
  query: EpisodeSearchQuery,
  requestSignal?: AbortSignal,
): Promise<EpisodeSearchResult> {
  const signal = AbortSignal.any([AbortSignal.timeout(20000), ...(requestSignal ? [requestSignal] : [])]);
  signal.throwIfAborted();
  const status = await episodeSearchStatus(db, signal);
  if (status.status !== 'ready')
    throw new ApiError(
      503,
      'SEARCH_NOT_READY',
      status.status === 'not_configured'
        ? 'Semantic search has not been activated. Browse saved episodes with the filters below.'
        : 'The semantic index is not ready. Browse saved episodes while indexing completes.',
      true,
    );
  const sync = await syncEpisodeSearch(db, signal);
  let hits: Document[];
  try {
    hits = await db
      .collection(SEARCH_COLLECTION)
      .aggregate(searchPipeline(query), { maxTimeMS: 12000, signal })
      .toArray();
  } catch (error) {
    if (requestSignal?.aborted) throw requestSignal.reason;
    const message = error instanceof Error ? error.message : '';
    throw /rate.?limit|too many requests|quota/i.test(message)
      ? new ApiError(
          429,
          'SEARCH_RATE_LIMIT',
          'Atlas embedding allowance is temporarily exhausted. Try again shortly.',
          true,
        )
      : new ApiError(
          503,
          'SEARCH_UNAVAILABLE',
          'Atlas semantic search is unavailable. Exact-filter browsing remains available.',
          true,
        );
  }
  const ids = hits.map((h) => h._id).filter((id): id is string => typeof id === 'string' && UUID.test(id));
  const canonical = ids.length
    ? await db
        .collection<Document & { _id: string }>('physics_episodes')
        .find(
          { ...episodeFilter(query.filters), _id: { $in: ids } },
          { projection: SEARCH_SOURCE_FIELDS, maxTimeMS: 5000, signal },
        )
        .toArray()
    : [];
  const episodes = verifiedSearchResults(hits, canonical);
  return {
    episodes,
    model: SEARCH_MODEL,
    omittedStale: hits.length - episodes.length,
    projectionUpdates: sync.changed,
  };
}
