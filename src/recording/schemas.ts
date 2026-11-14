import { PLAN_JSON_SCHEMA } from '../simulation/missionRun.ts';

const number = { type: 'number' };
const text = { type: 'string' };
const point = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'z'],
  properties: { x: number, y: number, z: number },
};
const rotation = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'z', 'w'],
  properties: { x: number, y: number, z: number, w: number },
};

function object(title: string, properties: Record<string, unknown>, required = Object.keys(properties)) {
  return { title, type: 'object', additionalProperties: false, properties, required };
}

export const runMetadataSchema = object('rocketacademy.RunMetadata', {
  schemaVersion: text,
  runId: text,
  robotId: text,
  startedAt: text,
  robotProfile: object('rocketacademy.RobotProfile', {
    id: text,
    revision: text,
    model: text,
    maxSpeedMps: number,
  }),
  durationS: number,
  seed: { type: 'integer', minimum: 0 },
  seedUsage: text,
  dataClass: { type: 'string', enum: ['synthetic-kinematic'] },
  planner: object(
    'rocketacademy.PlannerProvenance',
    { kind: text, model: text, prompt: text, generatedAt: text },
    ['kind'],
  ),
  mission: {
    type: 'object',
    properties: {
      schema: text,
      schemaVersion: text,
      mode: text,
      body: text,
      layer: text,
      source: { type: 'object' },
      coordinateSpace: { type: 'object' },
      markers: { type: 'object' },
    },
  },
  plan: PLAN_JSON_SCHEMA,
  engine: object('rocketacademy.KinematicEngine', {
    name: text,
    version: text,
    fixedStepS: number,
    trajectoryModel: text,
    physicsValidated: { const: false },
    terrainContactValidated: { const: false },
    imageSensors: { const: false },
    trainingRun: { const: false },
    observationModel: text,
  }),
  referenceFrame: object('rocketacademy.ReferenceFrame', {
    id: text,
    sourceFrameId: text,
    originInSource: point,
    rotationToSource: rotation,
    axes: text,
    registration: text,
  }),
});

export const commandSchema = object('rocketacademy.CommandEvent', {
  runId: text,
  robotId: text,
  sequence: { type: 'integer' },
  stepIndex: { type: 'integer' },
  elapsedS: number,
  phase: { type: 'string', enum: ['started', 'completed'] },
  command: PLAN_JSON_SCHEMA.properties.steps.items,
});

export const stateSchema = object('rocketacademy.RobotState', {
  runId: text,
  robotId: text,
  sequence: { type: 'integer' },
  elapsedS: number,
  frameId: text,
  position: point,
  orientation: rotation,
  localFrameId: text,
  localPosition: point,
  localOrientation: rotation,
  speedMps: number,
  distanceToGoalM: number,
  commandIndex: { type: 'integer' },
  mode: text,
  synthetic: { const: true },
});

export const observationSchema = object('rocketacademy.Observation', {
  runId: text,
  robotId: text,
  sequence: { type: 'integer' },
  elapsedS: number,
  stepIndex: { type: 'integer' },
  kind: { type: 'string', enum: ['kinematic-state'] },
  synthetic: { const: true },
  label: text,
  frameId: text,
  position: point,
  distanceToGoalM: number,
  speedMps: number,
});

export const resultSchema = object('rocketacademy.RunResult', {
  runId: text,
  robotId: text,
  endedAt: text,
  durationS: number,
  status: { type: 'string', enum: ['completed', 'stopped', 'budget-exhausted'] },
  goalReached: { type: 'boolean' },
  distanceToGoalM: number,
  reason: text,
  physicsValidated: { const: false },
  trainingRun: { const: false },
});
