import { describe, expect, it, vi } from 'vitest';
import type { Db, Document } from 'mongodb';
import {
  buildSearchProjection,
  parseEpisodeSearch,
  searchPipeline,
  verifiedSearchResults,
  episodeSearchStatus,
  syncEpisodeSearch,
  searchEpisodes,
  SEARCH_DEFINITION,
  SEARCH_INDEX,
  SEARCH_COLLECTION,
  MAX_SEARCH_EPISODES,
} from './episodeSearch.ts';
import { createApiHandler } from './app.ts';
import { AtlasStore } from './atlas.ts';
import { readConfig } from './config.ts';
import { createGeminiPlanner } from './gemini.ts';
import { EpisodeService } from './episodes.ts';

const id = '00000000-0000-4000-8000-000000000001';
const doc = (): Document => ({
  _id: id,
  state: 'complete',
  requestHash: 'b'.repeat(64),
  artifact: { sha256: 'a'.repeat(64) },
  episode: {
    startedAt: '2026-11-14T10:00:00.000Z',
    durationS: 5,
    termination: 'rollover',
    input: { terrain: { source: { id: 'amboy-crater', body: 'earth' } } },
    robotModels: [{ modelId: 'husky' }, { modelId: 'jackal' }],
    frames: ['never embed'],
    modelXml: 'private source',
    limitations: ['arbitrary secret must not be embedded'],
  },
});
function fixture(source = [doc()], existing: Document[] = []) {
  const projected = new Map(existing.map((d) => [d._id, d]));
  const index = { name: SEARCH_INDEX, status: 'READY', queryable: true, latestDefinition: SEARCH_DEFINITION };
  const toCursor = (rows: Document[]) => ({
    limit: () => ({ toArray: async () => rows }),
    toArray: async () => rows,
  });
  const searchAggregate = vi.fn((pipeline: Document[]) =>
    toCursor(
      '$listSearchIndexes' in pipeline[0]
        ? [index]
        : [...projected.values()].map((d) => ({ ...d, score: 0.9 })),
    ),
  );
  const bulkWrite = vi.fn(async (ops: { replaceOne: { replacement: Document } }[]) => {
    ops.forEach((o) => projected.set(o.replaceOne.replacement._id, o.replaceOne.replacement));
  });
  const deleteMany = vi.fn(async (filter: Document) => {
    filter._id.$in.forEach((key: string) => projected.delete(key));
  });
  const sourceFind = vi.fn(() => toCursor(source));
  const db = {
    collection: (name: string) =>
      name === SEARCH_COLLECTION
        ? { aggregate: searchAggregate, find: () => toCursor([...projected.values()]), bulkWrite, deleteMany }
        : { find: sourceFind },
  } as unknown as Db;
  return { db, projected, searchAggregate, sourceFind, bulkWrite, deleteMany, index };
}
describe('factual episode summaries', () => {
  it('uses allowlisted metadata and preserves uncertainty', () => {
    const p = buildSearchProjection(doc())!;
    expect(p.summary).toContain('Earth terrestrial');
    expect(p.summary).toContain('tipped over');
    expect(p.summary).toContain('Training eligibility has not been assessed');
    expect(JSON.stringify(p)).not.toMatch(/secret|private source|never embed/);
    const d = doc();
    d.episode.termination = 'duration_reached';
    expect(buildSearchProjection(d)?.summary).toContain('not a success determination');
    d.episode.robotModels = [{ modelId: '$where' }];
    d.episode.startedAt = 'bogus';
    d.episode.durationS = NaN;
    d.episode.input.terrain.source.body = { $ne: '' };
    expect(buildSearchProjection(d)).toMatchObject({
      robots: ['unknown'],
      startedAt: null,
      durationS: null,
      body: 'unknown',
    });
  });
  it('excludes incomplete or unidentifiable evidence and versions source facts', () => {
    expect(buildSearchProjection({ ...doc(), state: 'persisting' })).toBeNull();
    expect(buildSearchProjection({ ...doc(), artifact: {} })).toBeNull();
    const d = doc();
    const hash = buildSearchProjection(d)!.sourceHash;
    d.episode.frames = ['changed irrelevant stream'];
    expect(buildSearchProjection(d)!.sourceHash).toBe(hash);
    d.artifact.sha256 = 'c'.repeat(64);
    expect(buildSearchProjection(d)!.sourceHash).not.toBe(hash);
  });
});
describe('semantic request boundary', () => {
  it.each([
    { query: '' },
    { query: 'x'.repeat(501) },
    { query: 'a\nb' },
    { query: { $ne: '' } },
    { query: 'moon', filters: { body: { $ne: '' } } },
    { query: 'moon', filters: { unexpected: 1 } },
    { query: 'moon', filters: { body: 'jupiter' } },
    { query: 'moon', filters: { from: '2026-02-30' } },
    { query: 'moon', limit: 21 },
    { query: 'moon', limit: 1.5 },
    { query: 'moon', model: 'other' },
  ])('rejects %j', (value) => {
    expect(() => parseEpisodeSearch(value)).toThrow();
  });
  it('keeps text literal and metadata in the vector prefilter', () => {
    const q = parseEpisodeSearch({
      query: '  {$where: bad} lunar rovers  ',
      filters: { body: 'moon', robot: 'husky', to: '2024-02-29' },
      limit: 5,
    });
    const stage = searchPipeline(q)[0].$vectorSearch;
    expect(stage.query).toEqual({ text: '{$where: bad} lunar rovers' });
    expect(stage.filter).toMatchObject({
      body: 'moon',
      robots: 'husky',
      projectionVersion: '1.0.0',
      startedAtDate: { $lt: new Date('2024-03-01T00:00:00.000Z') },
    });
    expect(stage.limit).toBe(5);
    expect(stage.numCandidates).toBeGreaterThanOrEqual(100);
  });
});
describe('search publication and canonical evidence', () => {
  it('reconciles idempotently and removes only obsolete search projections', async () => {
    const f = fixture([doc()], [{ _id: 'obsolete', sourceHash: 'old' }]);
    expect(await syncEpisodeSearch(f.db)).toEqual({ changed: 2, count: 1 });
    expect(f.projected.size).toBe(1);
    expect(f.deleteMany).toHaveBeenCalledOnce();
    expect(await syncEpisodeSearch(f.db)).toEqual({ changed: 0, count: 1 });
    expect(f.bulkWrite).toHaveBeenCalledOnce();
  });
  it('refuses an oversized backfill before any writes', async () => {
    const f = fixture(Array.from({ length: MAX_SEARCH_EPISODES + 1 }, doc));
    await expect(syncEpisodeSearch(f.db)).rejects.toMatchObject({ code: 'SEARCH_CORPUS_LIMIT' });
    expect(f.bulkWrite).not.toHaveBeenCalled();
  });
  it('omits changed, missing, incomplete and invalid-score hits', () => {
    const p = buildSearchProjection(doc())!;
    const hit = { _id: id, sourceHash: p.sourceHash, score: 0.8 };
    expect(verifiedSearchResults([hit], [doc()])[0]).toMatchObject({ id, site: 'Amboy Crater' });
    expect(verifiedSearchResults([hit], [])).toEqual([]);
    expect(verifiedSearchResults([hit], [{ ...doc(), state: 'persisting' }])).toEqual([]);
    expect(
      verifiedSearchResults(
        [
          { ...hit, sourceHash: 'old' },
          { ...hit, score: NaN },
        ],
        [doc()],
      ),
    ).toEqual([]);
  });
  it('requires a ready matching index and checks canonical filters after retrieval', async () => {
    const f = fixture();
    expect((await episodeSearchStatus(f.db)).status).toBe('ready');
    const query = parseEpisodeSearch({ query: 'tipped over', filters: { body: 'earth' } });
    const result = await searchEpisodes(f.db, query);
    expect(result.episodes).toHaveLength(1);
    expect(f.sourceFind).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: 'complete',
        'episode.input.terrain.source.body': 'earth',
        _id: { $in: [id] },
      }),
      expect.anything(),
    );
    f.index.status = 'BUILDING';
    await expect(searchEpisodes(f.db, query)).rejects.toMatchObject({ code: 'SEARCH_NOT_READY' });
  });
  it('reports missing/mismatched indexes, cancellation and rate limits without returning fake results', async () => {
    const f = fixture();
    f.searchAggregate.mockReturnValueOnce({ toArray: async () => [] } as never);
    expect((await episodeSearchStatus(f.db)).status).toBe('not_configured');
    f.searchAggregate.mockReturnValueOnce({
      toArray: async () => [{ ...f.index, latestDefinition: {} }],
    } as never);
    await expect(episodeSearchStatus(f.db)).rejects.toMatchObject({ code: 'SEARCH_CONFIG_MISMATCH' });
    await expect(
      searchEpisodes(f.db, parseEpisodeSearch({ query: 'moon' }), AbortSignal.abort()),
    ).rejects.toThrow();
    f.searchAggregate
      .mockImplementationOnce(() => ({ toArray: async () => [f.index] }) as never)
      .mockImplementationOnce(
        () =>
          ({
            toArray: async () => {
              throw new Error('rate limit exceeded [private provider detail]');
            },
          }) as never,
      );
    await expect(searchEpisodes(f.db, parseEpisodeSearch({ query: 'moon' }))).rejects.toMatchObject({
      status: 429,
      code: 'SEARCH_RATE_LIMIT',
    });
  });
});
describe('semantic API', () => {
  it('enforces origin and request contracts before invoking search', async () => {
    const config = readConfig({});
    const store = new AtlasStore(config);
    const search = vi
      .spyOn(store.episodes, 'search')
      .mockResolvedValue({ episodes: [], model: 'voyage-4', omittedStale: 0, projectionUpdates: 0 });
    const api = createApiHandler({
      config,
      store,
      planner: createGeminiPlanner(config),
      episodes: new EpisodeService(store.episodes),
    });
    const req = (value: unknown, origin = 'http://localhost:5173') =>
      new Request('http://127.0.0.1:8787/api/episodes/search', {
        method: 'POST',
        headers: { host: '127.0.0.1:8787', origin, 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
    expect((await api(req({ query: 'moon' }, 'https://untrusted.example'))).status).toBe(403);
    expect((await api(req({ query: 'moon', filters: { body: { $ne: 'mars' } } }))).status).toBe(422);
    expect(search).not.toHaveBeenCalled();
    expect((await api(req({ query: 'moon', filters: { body: 'moon' } }))).status).toBe(200);
    expect(search).toHaveBeenCalledWith(
      { query: 'moon', filters: { body: 'moon' }, limit: 10 },
      expect.any(AbortSignal),
    );
  });
});
