import { getSource, type SceneMode, type TerrainPoint } from './mission.ts';

/** A 20 m arc on the declared model sphere, never presented as a terrain survey. */
export function createExamplePoints(mode: SceneMode): { rover: TerrainPoint; goal: TerrainPoint } {
  const source = getSource(mode);
  if (source.geometryKind !== 'reference-sphere') {
    throw new Error('Choose points on the reconstructed terrain for a local-site mission.');
  }
  const radius = source.radiusM;
  const angle = 20 / radius;
  return {
    rover: { x: radius, y: 0, z: 0 },
    goal: { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: 0 },
  };
}
