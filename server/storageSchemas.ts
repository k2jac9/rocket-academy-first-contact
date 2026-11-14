import type { Document } from 'mongodb';
import { jsonHash } from './hash.ts';

// This versions the storage envelope, independently of mission/record/engine versions.
// Missing storageSchemaVersion is the explicitly supported legacy envelope.
export const STORAGE_SCHEMA_VERSION = '1.0.0';
const text = { bsonType: 'string', minLength: 1 };
const string = { bsonType: 'string' };
const hash = { bsonType: 'string', pattern: '^[0-9a-f]{64}$' };
const uuid = {
  bsonType: 'string',
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
};
const date = { bsonType: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' };
const number = {
  bsonType: ['double', 'int', 'long'],
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
};
const integer = { ...number, multipleOf: 1 };
const body = { enum: ['earth', 'moon', 'mars'] };
const version = { enum: ['1.0.0'] };
const array = { bsonType: 'array' };
const object = (properties: Document, required = Object.keys(properties)): Document => ({
  bsonType: 'object',
  required,
  properties,
});
const strings = { bsonType: 'array', items: string };
const planner = object({ kind: { enum: ['baseline', 'gemini'] } });
const plan = object({ schemaVersion: version, steps: array, rationale: string });
const result = object({
  status: { enum: ['completed', 'stopped', 'budget-exhausted'] },
  goalReached: { bsonType: 'bool' },
  distanceToGoalM: number,
  reason: text,
});
const mission = object({
  schema: { enum: ['rocket-academy.mission'] },
  schemaVersion: { enum: ['2.0.0'] },
  missionName: text,
  createdAt: date,
  status: { enum: ['planned'] },
  body,
  mode: { enum: ['earth', 'moon', 'mars', 'dingo-gap', 'apollo-17', 'amboy-crater'] },
  layer: { enum: ['imagery', 'terrain'] },
  source: { bsonType: 'object' },
  coordinateSpace: { bsonType: 'object' },
  markers: object({ rover: { bsonType: 'object' }, goal: { bsonType: 'object' } }),
  traverse: object({ straightLineDistanceM: number, terrainSafetyValidated: { enum: [false] } }),
  simulation: object({ physicsValidated: { enum: [false] }, trainingRun: { enum: [false] } }),
});
const artifact = object({
  id: { bsonType: 'string', pattern: '^[0-9a-f]{24}$' },
  sha256: hash,
  bytes: { ...integer, minimum: 1, maximum: 16 * 1024 * 1024 },
});
const run = object({
  schemaVersion: version,
  runId: uuid,
  robotId: text,
  startedAt: date,
  endedAt: date,
  durationS: number,
  mission,
  plan,
  planner,
  result,
  frames: array,
  commands: array,
  observations: array,
  engine: object({
    name: { enum: ['first-contact-kinematic'] },
    version,
    physicsValidated: { enum: [false] },
    terrainContactValidated: { enum: [false] },
    imageSensors: { enum: [false] },
    trainingRun: { enum: [false] },
  }),
});
const episode = object({
  id: uuid,
  startedAt: date,
  durationS: number,
  termination: { enum: ['duration_reached', 'rollover', 'terrain_boundary'] },
  terrainSha256: hash,
  modelSha256: hash,
  sensorSamples: integer,
  frames: array,
  limitations: strings,
  input: object({
    terrain: object({ version, source: object({ id: text, body }) }),
    robotModels: { bsonType: 'array', minItems: 2, maxItems: 2, items: text },
    durationS: number,
    speedMps: number,
    seed: integer,
  }),
  robotModels: {
    bsonType: 'array',
    minItems: 1,
    items: object({ id: text, modelId: { enum: ['husky', 'jackal', 'scout', 'surveyor'] } }),
  },
  engine: object({
    name: { enum: ['mujoco'] },
    version: text,
    timestepS: { ...number, exclusiveMinimum: true },
    platform: text,
  }),
  camera: { bsonType: 'object' },
});
const exploration = object({
  id: uuid,
  schemaVersion: version,
  createdAt: date,
  sourceKind: { enum: ['generative_world_model'] },
  evidenceKind: { enum: ['exploration_brief', 'imported_recording'] },
  publication: { enum: ['ready'] },
  input: object({ title: text, body, objective: text, prompt: text }),
  adapter: { bsonType: 'object' },
  artifacts: array,
  referenceUse: { enum: ['visual_conditioning_only'] },
  modelIdentityEvidence: { enum: ['operator_reported'] },
  knownLimits: strings,
  eligibility: object({
    exploration: { enum: [true] },
    review: { enum: [true] },
    perception: { enum: [false] },
    imitation: { enum: [false] },
    control: { enum: [false] },
    evaluation: { enum: [false] },
    reason: text,
  }),
});
const scenario = object({
  id: uuid,
  schemaVersion: version,
  createdAt: date,
  sha256: hash,
  objective: text,
  input: object({
    explorationId: uuid,
    title: text,
    body,
    robotModels: { bsonType: 'array', minItems: 2, maxItems: 2, items: text },
    durationS: number,
    speedMps: number,
    seed: integer,
  }),
  inspiredBy: object({ explorationId: uuid, sourceKind: { enum: ['generative_world_model'] }, body }),
  execution: object({
    adapter: { enum: ['mujoco-local'] },
    task: { enum: ['bounded_reference_traverse'] },
    controller: text,
    controllerVersion: text,
    terrain: text,
    body,
    runnable: { bsonType: 'bool' },
    blockers: strings,
    limitations: strings,
  }),
});
function envelope(properties: Document, required = Object.keys(properties)): Document {
  return object({ storageSchemaVersion: version, ...properties }, required);
}
function publication(payload: string, schema: Document, extra: Document = {}): Document {
  const base = {
    _id: uuid,
    requestHash: hash,
    state: { enum: ['persisting', 'complete'] },
    [payload]: schema,
    artifact,
    ...extra,
  };
  return {
    ...envelope(base, ['_id', 'requestHash', 'state', ...(payload === 'run' ? ['createdAt'] : [])]),
    oneOf: [
      { properties: { state: { enum: ['persisting'] } } },
      {
        properties: { state: { enum: ['complete'] } },
        required: [payload, 'artifact', ...(payload === 'run' ? ['missionId', 'planId'] : [])],
      },
    ],
  };
}
/** Structural guardrails only; hashes, frames, references and physical validity remain application checks. */
export const STORAGE_SCHEMAS: Record<string, Document> = {
  missions: envelope({ _id: text, requestHash: hash, createdAt: date, mission }),
  plans: envelope({ _id: hash, missionId: hash, createdAt: date, plan, planner, validationVersion: version }),
  decision_events: envelope({
    _id: text,
    runId: uuid,
    planId: hash,
    createdAt: date,
    planner,
    commands: array,
    rationale: string,
    result,
  }),
  terrain_sources: envelope({
    _id: text,
    id: text,
    catalogVersion: version,
    body,
    layer: { enum: ['imagery', 'terrain'] },
    sourceId: text,
    sourceRevision: { bsonType: ['string', 'null'] },
    coordinateSpace: { bsonType: 'object' },
  }),
  robots: envelope({
    _id: text,
    id: text,
    revision: text,
    executionModel: { enum: ['kinematic-rehearsal'] },
    physicsValidated: { enum: [false] },
    terrainContactValidated: { enum: [false] },
  }),
  runs: publication('run', run, { createdAt: date, missionId: hash, planId: hash }),
  physics_episodes: publication('episode', episode),
  world_model_explorations: envelope({ _id: uuid, requestHash: hash, createdAt: date, record: exploration }),
  scenario_versions: envelope({ _id: uuid, requestHash: hash, createdAt: date, record: scenario }),
};
export const STORAGE_SCHEMA_HASH = jsonHash(STORAGE_SCHEMAS);
