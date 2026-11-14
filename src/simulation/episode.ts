import { getSource } from '../domain/mission.ts';
import type { TerrainPoint } from '../domain/mission.ts';
import type { ScenarioLineage } from '../scenarios/contracts.ts';
import { isSurfaceSite } from '../domain/surfaceSites.ts';

export interface TerrainPatch {
  version: '1.0.0';
  source: ReturnType<typeof getSource>;
  capturedAt: string;
  sampling: 'loaded-mesh-raycast' | 'pinned-heightfield-interpolation';
  resolutionM: number;
  rows: number;
  cols: number;
  /** Row-major, increasing local Y then X. Metres above local origin; no missing cells. */
  heights: number[];
  originInSource: TerrainPoint;
  basisInSource: { x: TerrainPoint; y: TerrainPoint; z: TerrainPoint };
  loadedTiles: number;
}
export const PHYSICS_ROBOTS = [
  {
    id: 'husky',
    label: 'Clearpath Husky',
    wheels: 4,
    massKg: 56.582,
    lengthM: 0.9874,
    widthM: 0.555,
    wheelRadiusM: 0.1651,
    color: '#e5b843',
  },
  {
    id: 'jackal',
    label: 'Clearpath Jackal',
    wheels: 4,
    massKg: 18.432,
    lengthM: 0.42,
    widthM: 0.37559,
    wheelRadiusM: 0.098,
    color: '#e6c546',
  },
] as const;
// Older recordings retain the exact generic models they were generated with.
export const LEGACY_PHYSICS_ROBOTS = [
  {
    id: 'scout',
    label: 'Scout · four wheels',
    wheels: 4,
    massKg: 24,
    lengthM: 0.9,
    widthM: 0.65,
    wheelRadiusM: 0.18,
    color: '#67d9c6',
  },
  {
    id: 'surveyor',
    label: 'Surveyor · six wheels',
    wheels: 6,
    massKg: 65,
    lengthM: 1.3,
    widthM: 0.9,
    wheelRadiusM: 0.23,
    color: '#f3b67c',
  },
] as const;
export type PhysicsModelId = 'husky' | 'jackal' | 'scout' | 'surveyor';
export interface EpisodeRequest {
  terrain: TerrainPatch;
  durationS: number;
  seed: number;
  speedMps: number;
  robotModels: [PhysicsModelId, PhysicsModelId];
}
export interface PhysicsRobotModel {
  id: string;
  modelId: PhysicsModelId;
  label: string;
  wheels: number;
  massKg: number;
  lengthM: number;
  widthM: number;
  wheelRadiusM: number;
  color: string;
}
export interface PhysicsRobotState {
  id: string;
  position: number[];
  orientationWxyz: number[];
  velocity: number[];
  jointPosition: number[];
  jointVelocity: number[];
  action: number[];
  contacts: number;
}
export interface PhysicsFrame {
  elapsedS: number;
  robots: PhysicsRobotState[];
}
export interface CameraSample {
  elapsedS: number;
  robotId: string;
  rgbPngBase64: string;
  depthF32LEBase64: string;
  position: number[];
  rotation: number[];
}
export interface PhysicsEpisode {
  lineage?: ScenarioLineage;
  id: string;
  startedAt: string;
  input: EpisodeRequest;
  terrainSha256: string;
  terrainCanonicalJson: string;
  controller: { name: string; version: string; sourceSha256: string; updateRateHz: number };
  modelSha256: string;
  modelXml: string;
  engine: { name: 'mujoco'; version: string; timestepS: number; platform: string; gravityMps2: number };
  camera: {
    width: number;
    height: number;
    rateHz: number;
    fovYDegrees: number;
    fx: number;
    fy: number;
    cx: number;
    cy: number;
    depthUnits: 'm';
    depthConvention: 'optical-axis';
    poseConvention: string;
  };
  frames: PhysicsFrame[];
  sensors: CameraSample[];
  durationS: number;
  termination: string;
  robotModels: PhysicsRobotModel[];
  limitations: string[];
}
export type EpisodeMetadata = Omit<PhysicsEpisode, 'sensors'> & {
  sensorSamples: number;
  cameraPreviews?: { robotId: string; elapsedS: number; rgbPngBase64: string }[];
};
export interface EpisodeRecord {
  id: string;
  episode: EpisodeMetadata;
  artifact: { sha256: string; bytes: number };
  downloadUrl: string;
}
export interface EpisodeJob {
  id: string;
  state: 'running' | 'complete' | 'failed';
  message: string;
  record?: EpisodeRecord;
}

/** The server accepts bounded measured patches, never reference-sphere substitutes or executable models. */
export function validateEpisodeRequest(value: unknown): EpisodeRequest {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (!value || typeof value !== 'object') return fail('Provide an episode scenario.');
  const input = value as EpisodeRequest;
  if (Object.keys(input).sort().join() !== 'durationS,robotModels,seed,speedMps,terrain')
    return fail('Unexpected scenario fields.');
  if (
    !Array.isArray(input.robotModels) ||
    input.robotModels.length !== 2 ||
    input.robotModels.some((m) => !['husky', 'jackal', 'scout', 'surveyor'].includes(m))
  )
    return fail('Select a supported model for each of the two robots.');
  if (!Number.isInteger(input.durationS) || input.durationS < 5 || input.durationS > 20)
    return fail('Duration must be 5–20 seconds.');
  if (!Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff)
    return fail('Seed must be an unsigned 32-bit integer.');
  if (!Number.isFinite(input.speedMps) || input.speedMps < 0.1 || input.speedMps > 0.5)
    return fail('Speed must be 0.1–0.5 m/s.');
  const t = input.terrain;
  if (!t || t.version !== '1.0.0') return fail('Capture a measured terrain patch first.');
  if (!isSurfaceSite(t.source?.id)) return fail('Choose a pinned NASA/USGS surface site.');
  const source = getSource(t.source.id, 'terrain');
  if (
    t.sampling !==
    (source.geometryKind === 'heightfield' ? 'pinned-heightfield-interpolation' : 'loaded-mesh-raycast')
  )
    return fail('The sampling method must match the measured source.');
  const stable = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(stable).join(',')}]`
      : value && typeof value === 'object'
        ? `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
            .join(',')}}`
        : JSON.stringify(value);
  if (stable(t.source) !== stable(source))
    return fail('This pilot requires the pinned NASA/USGS source metadata.');
  if (t.rows !== 65 || t.cols !== 65 || t.resolutionM !== 0.25)
    return fail('The pilot needs a complete 16 m patch at 0.25 m sampling.');
  if (
    !Array.isArray(t.heights) ||
    t.heights.length !== 4225 ||
    t.heights.some((h) => !Number.isFinite(h) || Math.abs(h) > 30)
  )
    return fail('The patch has invalid or missing elevations.');
  const finitePoint = (p: TerrainPoint | undefined) =>
    p && [p.x, p.y, p.z].every((n) => Number.isFinite(n) && Math.abs(n) < 10000);
  if (!finitePoint(t.originInSource)) return fail('Invalid terrain origin.');
  if (
    stable(t.basisInSource) !==
    stable({ x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: -1, z: 0 }, z: { x: 0, y: 0, z: -1 } })
  )
    return fail('Invalid local surface simulation frame.');
  if (
    !Number.isInteger(t.loadedTiles) ||
    t.loadedTiles < 1 ||
    t.loadedTiles > 1000 ||
    !Number.isFinite(Date.parse(t.capturedAt))
  )
    return fail('Missing capture provenance.');
  return structuredClone(input);
}
