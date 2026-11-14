import { describe, expect, it } from 'vitest';
import { getSource } from '../domain/mission';
import { exampleEpisodeRequest } from './episodeFixture';
import { validateEpisodeRequest } from './episode';

describe('bounded measured-terrain scenarios', () => {
  it('accepts source wheeled robots but excludes inspection-only quadrupeds', () => {
    const input = exampleEpisodeRequest();
    input.robotModels = ['husky', 'jackal'];
    expect(validateEpisodeRequest(input).robotModels).toEqual(['husky', 'jackal']);
    input.robotModels = ['unitree-go2', 'husky'];
    expect(() => validateEpisodeRequest(input)).toThrow('supported model');
  });
  it('accepts independent model selections and copies the frozen data', () => {
    const input = exampleEpisodeRequest();
    input.robotModels = ['surveyor', 'surveyor'];
    const valid = validateEpisodeRequest(input);
    input.terrain.heights[0] = 12;
    expect(valid.terrain.heights[0]).toBe(0);
    expect(valid.robotModels).toEqual(['surveyor', 'surveyor']);
  });
  it.each([
    (r: ReturnType<typeof exampleEpisodeRequest>) => {
      r.terrain.source = getSource('mars', 'imagery');
    },
    (r: ReturnType<typeof exampleEpisodeRequest>) => {
      r.terrain.heights.pop();
    },
    (r: ReturnType<typeof exampleEpisodeRequest>) => {
      r.terrain.heights[0] = NaN;
    },
    (r: ReturnType<typeof exampleEpisodeRequest>) => {
      r.terrain.basisInSource.z.z = 1;
    },
    (r: ReturnType<typeof exampleEpisodeRequest>) => {
      r.terrain.resolutionM = 30;
    },
    (r: ReturnType<typeof exampleEpisodeRequest>) => {
      r.robotModels = ['drone', 'scout'];
    },
    (r: ReturnType<typeof exampleEpisodeRequest>) => {
      r.durationS = 600;
    },
    (r: ReturnType<typeof exampleEpisodeRequest>) => {
      r.seed = -1;
    },
  ])('rejects unbounded, unregistered, or incomplete input', (mutate) => {
    const input = exampleEpisodeRequest();
    mutate(input);
    expect(() => validateEpisodeRequest(input)).toThrow();
  });
});
