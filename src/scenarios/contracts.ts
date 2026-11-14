import type { CelestialBody } from '../domain/mission';
import type { FleetRobotId } from '../robots/catalog';
import type { SurfaceSiteId } from '../domain/surfaceSites';

export const GENIE_ADAPTER = {
  id: 'google-genie',
  version: '1.0.0',
  provider: 'google',
  accessSurface: 'project-genie',
  connection: 'manual-import',
  programmaticAccess: 'unverified',
  checkedAt: '2026-11-14',
  productUrl: 'https://labs.google/projectgenie',
  documentationUrl: 'https://deepmind.google/models/genie/',
  capabilities: [
    { id: 'actions', label: 'Robot actions and observations', status: 'unverified' },
    { id: 'reset', label: 'Reset, timing and repeatability', status: 'unverified' },
    { id: 'terrain', label: 'Measured terrain import', status: 'unverified' },
    { id: 'truth', label: 'Calibrated state and ground truth', status: 'unverified' },
    { id: 'agents', label: 'Independent agents in one world', status: 'unverified' },
    { id: 'entitlement', label: 'Account access and permitted automated use', status: 'unverified' },
  ],
} as const;

export interface ExplorationInput {
  title: string;
  body: CelestialBody;
  objective: string;
  prompt: string;
  model: 'unknown' | 'genie-3' | 'genie-4';
  modelRevision: string | null;
  settingsNotes: string;
  referenceImageSha256: string | null;
  recordingSha256: string | null;
}
export interface ExplorationArtifact {
  sha256: string;
  bytes: number;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'video/mp4' | 'video/webm';
  createdAt: string;
  downloadUrl: string;
}
export interface ExplorationRecord {
  id: string;
  schemaVersion: '1.0.0';
  sourceKind: 'generative_world_model';
  evidenceKind: 'exploration_brief' | 'imported_recording';
  createdAt: string;
  input: ExplorationInput;
  adapter: typeof GENIE_ADAPTER;
  modelIdentityEvidence: 'operator_reported';
  publication: 'ready';
  artifacts: ExplorationArtifact[];
  referenceUse: 'visual_conditioning_only';
  eligibility: {
    exploration: true;
    review: true;
    perception: false;
    imitation: false;
    control: false;
    evaluation: false;
    reason: string;
  };
  knownLimits: string[];
}
export interface ScenarioInput {
  explorationId: string;
  title: string;
  body: CelestialBody;
  robotModels: [FleetRobotId, FleetRobotId];
  durationS: number;
  speedMps: number;
  seed: number;
}
export interface ScenarioRecord {
  id: string;
  schemaVersion: '1.0.0';
  createdAt: string;
  sha256: string;
  input: ScenarioInput;
  objective: string;
  inspiredBy: { explorationId: string; sourceKind: 'generative_world_model'; body: CelestialBody };
  execution: {
    adapter: 'mujoco-local';
    task: 'bounded_reference_traverse';
    controller: 'bounded-lane-velocity';
    controllerVersion: '1.1.0';
    terrain: SurfaceSiteId;
    terrainRevision?: string | null;
    geometryId?: string;
    body: CelestialBody;
    runnable: boolean;
    blockers: string[];
    limitations: string[];
  };
}
export interface ScenarioLineage {
  scenarioVersionId: string;
  scenarioSha256: string;
  inspiredBy: ScenarioRecord['inspiredBy'];
  sourceKind: 'physics_simulation';
}
