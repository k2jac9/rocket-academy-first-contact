import { describe, expect, it, vi } from 'vitest';
import type { Collection } from 'mongodb';
import { encodeEpisodeCursor, episodeFilter, parseEpisodeQuery } from './episodeQuery.ts';
import { readEpisodePage } from './episodePage.ts';
import { createApiHandler } from './app.ts';
import { AtlasStore } from './atlas.ts';
import { readConfig } from './config.ts';
import { createGeminiPlanner } from './gemini.ts';
import { EpisodeService } from './episodes.ts';
import { ApiError } from './errors.ts';

const parse = (query: string) => parseEpisodeQuery(new URLSearchParams(query));
const id = '00000000-0000-4000-8000-000000000001';
describe('episode discovery query contract', () => {
  it('keeps the no-query default and validates all supported filters', () => {
    expect(parse('')).toEqual({ filters: {}, limit: 20 });
    expect(
      parse(
        'body=earth&site=amboy-crater&robot=husky&termination=rollover&from=2026-11-01&to=2026-11-14&limit=50',
      ),
    ).toEqual({
      filters: {
        body: 'earth',
        site: 'amboy-crater',
        robot: 'husky',
        termination: 'rollover',
        from: '2026-11-01',
        to: '2026-11-14',
      },
      limit: 50,
    });
    expect(parse('body=unknown&site=unknown&robot=unknown&termination=unknown').filters).toEqual({
      body: 'unknown',
      site: 'unknown',
      robot: 'unknown',
      termination: 'unknown',
    });
  });
  it.each([
    'body=venus',
    'site=elsewhere',
    'robot=arm',
    'termination=success',
    'body=',
    'body=earth&body=moon',
    'limit=5&limit=5',
    'limit=0',
    'limit=51',
    'limit=01',
    'limit=1.5',
    'skip=20',
    'body[$ne]=earth',
    'pipeline={"$out":"runs"}',
    'from=2026-02-30',
    'to=2026-11-14T12:00:00Z',
    'from=2026-11-15&to=2026-11-14',
    'to=9999-12-31',
    'cursor=',
    'cursor=bad!',
  ])('rejects %s', (query) => {
    expect(() => parse(query)).toThrow(ApiError);
  });
  it('includes the entire UTC end day, including leap-day and year transitions', () => {
    expect(episodeFilter(parse('from=2024-02-29&to=2024-02-29').filters)['episode.startedAt']).toEqual({
      $gte: '2024-02-29T00:00:00.000Z',
      $lt: '2024-03-01T00:00:00.000Z',
    });
    expect(episodeFilter(parse('to=2026-12-31').filters)['episode.startedAt']).toEqual({
      $lt: '2027-01-01T00:00:00.000Z',
    });
  });
  it('binds a cursor to canonical filters while allowing another page size', () => {
    const cursor = encodeEpisodeCursor('2026-11-14T12:00:00.000Z', id, { body: 'earth', robot: 'husky' });
    expect(parse(`robot=husky&body=earth&limit=5&cursor=${cursor}`).cursor?.id).toBe(id);
    expect(() => parse(`body=moon&robot=husky&cursor=${cursor}`)).toThrow(/different filters/);
    expect(() => parseEpisodeQuery(new URLSearchParams(`cursor=${cursor}`), false)).toThrow();
  });
  it('rejects cursor expressions and extra fields but supports undated legacy records', () => {
    const valid = JSON.parse(Buffer.from(encodeEpisodeCursor('', id, {}), 'base64url').toString());
    expect(parse(`cursor=${encodeEpisodeCursor('', id, {})}`).cursor?.time).toBe('');
    for (const change of [{ time: { $lt: 'x' } }, { id: { $ne: null } }, { v: 2 }, { extra: 1 }]) {
      const cursor = Buffer.from(JSON.stringify({ ...valid, ...change })).toString('base64url');
      expect(() => parse(`cursor=${cursor}`)).toThrow();
    }
  });
});

describe('episode page boundary', () => {
  it('keeps lookahead out of the response and preserves an unknown date', async () => {
    const row = {
      _id: id,
      startedAt: '',
      durationS: -1,
      termination: 'unknown',
      body: 'unknown',
      siteId: 'unknown',
      robots: ['unknown'],
    };
    const aggregate = vi.fn().mockReturnValue({
      toArray: async () => [row, { ...row, _id: '00000000-0000-4000-8000-000000000000' }],
    });
    const page = await readEpisodePage({ aggregate } as unknown as Collection, { filters: {}, limit: 1 });
    expect(page.episodes).toEqual([
      {
        id,
        startedAt: null,
        durationS: null,
        termination: 'unknown',
        body: 'unknown',
        siteId: 'unknown',
        site: 'Unknown / legacy site',
        robots: ['unknown'],
        downloadUrl: `/api/episodes/${id}/mcap`,
      },
    ]);
    expect(parse(`cursor=${page.nextCursor}`).cursor).toMatchObject({ time: '', id });
    expect(aggregate.mock.calls[0][1]).toMatchObject({
      maxTimeMS: 5000,
      allowDiskUse: false,
      signal: expect.any(AbortSignal),
    });
  });
  it('propagates failures and cancels before querying', async () => {
    const failure = new ApiError(503, 'ATLAS_UNAVAILABLE', 'Atlas is unavailable.');
    const aggregate = vi.fn().mockReturnValue({
      toArray: async () => {
        throw failure;
      },
    });
    const collection = { aggregate } as unknown as Collection;
    await expect(readEpisodePage(collection, parse(''))).rejects.toBe(failure);
    aggregate.mockClear();
    await expect(readEpisodePage(collection, parse(''), AbortSignal.abort())).rejects.toThrow();
    expect(aggregate).not.toHaveBeenCalled();
  });
  function fixture() {
    const config = readConfig({});
    const store = new AtlasStore(config);
    const list = vi.spyOn(store.episodes, 'list').mockResolvedValue({ episodes: [], nextCursor: null });
    const stats = vi.spyOn(store.episodes, 'stats').mockResolvedValue({} as never);
    return {
      list,
      stats,
      api: createApiHandler({
        config,
        store,
        planner: createGeminiPlanner(config),
        episodes: new EpisodeService(store.episodes),
      }),
    };
  }
  const request = (path: string, origin = 'http://localhost:5173') =>
    new Request(`http://127.0.0.1:8787/api/episodes${path}`, { headers: { host: '127.0.0.1:8787', origin } });
  it('preserves the list response and forwards the same filters to list and totals', async () => {
    const { api, list, stats } = fixture();
    expect(await (await api(request(''))).json()).toEqual({ episodes: [], nextCursor: null });
    const query = 'body=earth&robot=husky&termination=rollover';
    expect((await api(request(`?${query}&limit=5`))).status).toBe(200);
    expect((await api(request(`/stats?${query}`))).status).toBe(200);
    const filters = { body: 'earth', robot: 'husky', termination: 'rollover' };
    expect(list).toHaveBeenLastCalledWith({ filters, limit: 5 }, expect.any(AbortSignal));
    expect(stats).toHaveBeenCalledWith(expect.any(AbortSignal), filters);
  });
  it('rejects unsafe inputs and origins before calling the store, and returns failures', async () => {
    const { api, list } = fixture();
    expect((await api(request('?body[$ne]=earth'))).status).toBe(422);
    expect((await api(request('', 'https://untrusted.example'))).status).toBe(403);
    expect(list).not.toHaveBeenCalled();
    list.mockRejectedValue(new ApiError(503, 'ATLAS_UNAVAILABLE', 'Atlas is unavailable.'));
    const response = await api(request(''));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty('episodes');
  });
});
