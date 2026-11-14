import { describe, expect, it, vi } from 'vitest';
import type { Collection } from 'mongodb';
import { readEpisodeStats } from './episodeStats.ts';
import { createApiHandler } from './app.ts';
import { AtlasStore } from './atlas.ts';
import { readConfig } from './config.ts';
import { createGeminiPlanner } from './gemini.ts';
import { EpisodeService } from './episodes.ts';
import { ApiError } from './errors.ts';

describe('episode statistics boundary', () => {
  it('returns explicit empty metrics without exposing documents', async () => {
    const aggregate = vi.fn().mockReturnValue({ toArray: async () => [] });
    const result = await readEpisodeStats({ aggregate } as unknown as Collection);
    expect(result).toMatchObject({
      schemaVersion: '1.0.0',
      scope: 'complete_physics_episodes',
      totals: { episodes: 0, durationS: 0, durationEpisodes: 0, sensorSamples: 0, sensorEpisodes: 0 },
      byBody: [],
      byTermination: [],
      byRobot: [],
    });
    expect(aggregate.mock.calls[0][0][0]).toEqual({ $match: { state: 'complete' } });
    expect(aggregate.mock.calls[0][1]).toMatchObject({ maxTimeMS: 5000, signal: expect.any(AbortSignal) });
  });

  it('does not disguise a database failure as an empty library', async () => {
    const failure = new ApiError(503, 'ATLAS_UNAVAILABLE', 'Atlas is unavailable.');
    const aggregate = vi.fn().mockReturnValue({
      toArray: async () => {
        throw failure;
      },
    });
    await expect(readEpisodeStats({ aggregate } as unknown as Collection)).rejects.toBe(failure);
  });

  it('does not issue an already cancelled aggregation', async () => {
    const aggregate = vi.fn();
    await expect(
      readEpisodeStats({ aggregate } as unknown as Collection, AbortSignal.abort()),
    ).rejects.toThrow();
    expect(aggregate).not.toHaveBeenCalled();
  });

  function fixture() {
    const config = readConfig({});
    const store = new AtlasStore(config);
    const stats = vi.spyOn(store.episodes, 'stats').mockResolvedValue({
      schemaVersion: '1.0.0',
      scope: 'complete_physics_episodes',
      updatedAt: '2026-11-14T12:00:00.000Z',
      totals: { episodes: 2, durationS: 5, durationEpisodes: 1, sensorSamples: 0, sensorEpisodes: 0 },
      byBody: [
        { key: 'earth', count: 1 },
        { key: 'unknown', count: 1 },
      ],
      byTermination: [{ key: 'unknown', count: 2 }],
      byRobot: [{ key: 'husky', count: 2 }],
    });
    return {
      stats,
      api: createApiHandler({
        config,
        store,
        planner: createGeminiPlanner(config),
        episodes: new EpisodeService(store.episodes),
      }),
    };
  }
  const request = (query = '', origin = 'http://localhost:5173') =>
    new Request(`http://127.0.0.1:8787/api/episodes/stats${query}`, {
      headers: { host: '127.0.0.1:8787', origin },
    });

  it('routes stats separately from UUID detail requests and retains metric coverage', async () => {
    const { api, stats } = fixture();
    const response = await api(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).totals).toMatchObject({
      episodes: 2,
      durationEpisodes: 1,
      sensorEpisodes: 0,
    });
    expect(stats).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it.each(['?body=mars', '?pipeline=%7B%22%24out%22%3A%22runs%22%7D', '?body=earth&body=moon'])(
    'rejects unsupported query input %s before querying Atlas',
    async (query) => {
      const { api, stats } = fixture();
      expect((await api(request(query))).status).toBe(422);
      expect(stats).not.toHaveBeenCalled();
    },
  );

  it('retains the local origin boundary', async () => {
    const { api, stats } = fixture();
    expect((await api(request('', 'https://untrusted.example'))).status).toBe(403);
    expect(stats).not.toHaveBeenCalled();
  });
});
