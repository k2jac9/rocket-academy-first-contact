import { getSource } from '../domain/mission';

/** Synthetic flat patch for contract tests; not a measured recording. */
export function exampleEpisodeRequest() {
  return {
    terrain: {
      version: '1.0.0',
      source: getSource('dingo-gap', 'terrain'),
      capturedAt: '2026-11-14T18:00:00.000Z',
      sampling: 'loaded-mesh-raycast',
      resolutionM: 0.25,
      rows: 65,
      cols: 65,
      heights: Array(4225).fill(0),
      originInSource: { x: 0, y: 0, z: 0 },
      basisInSource: { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: -1, z: 0 }, z: { x: 0, y: 0, z: -1 } },
      loadedTiles: 1,
    },
    durationS: 5,
    seed: 1,
    speedMps: 0.35,
    robotModels: ['scout', 'surveyor'],
  };
}
