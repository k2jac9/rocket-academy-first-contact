import { Matrix4, Quaternion, Vector3 } from 'three';
import {
  distanceMeters,
  validateMissionManifest,
  type MissionManifest,
  type TerrainPoint,
} from '../domain/mission.ts';

export const ROBOT_PROFILE = Object.freeze({
  id: 'rover-1',
  revision: '1.0.0',
  model: 'kinematic-point-rover',
  maxSpeedMps: 2,
});
export type RobotProfile = typeof ROBOT_PROFILE;

export const RUN_LIMITS = Object.freeze({
  minSpeedMps: 0.01,
  maxSpeedMps: ROBOT_PROFILE.maxSpeedMps,
  maxLegM: 1000,
  maxDurationS: 1800,
  maxFrames: 10_000,
  maxSteps: 32,
  fixedStepS: 0.2,
  goalToleranceM: 0.05,
});

export type MissionStep =
  | { action: 'drive_to'; target: TerrainPoint; speedMps: number }
  | { action: 'wait'; durationS: number }
  | { action: 'observe'; label: string }
  | { action: 'stop' };

export interface MissionPlan {
  schemaVersion: '1.0.0';
  steps: MissionStep[];
  rationale: string;
}

export interface PlannerProvenance {
  kind: 'baseline' | 'gemini';
  model?: string;
  prompt?: string;
  generatedAt?: string;
}

export interface RunInput {
  mission: MissionManifest;
  plan: MissionPlan;
  planner: PlannerProvenance;
  runId: string;
  robotId: string;
  startedAt: string;
  seed: number;
}

export interface Orientation {
  x: number;
  y: number;
  z: number;
  w: number;
}
export type RunMode = 'idle' | 'driving' | 'waiting' | 'stopped';

export interface RunFrame {
  sequence: number;
  elapsedS: number;
  /** Native source XYZ, suitable for the existing terrain renderer. */
  position: TerrainPoint;
  localPosition: TerrainPoint;
  orientation: Orientation;
  localOrientation: Orientation;
  speedMps: number;
  distanceToGoalM: number;
  commandIndex: number;
  mode: RunMode;
}

export interface CommandEvent {
  sequence: number;
  stepIndex: number;
  elapsedS: number;
  phase: 'started' | 'completed';
  command: MissionStep;
}

export interface Observation {
  sequence: number;
  elapsedS: number;
  stepIndex: number;
  kind: 'kinematic-state';
  synthetic: true;
  label: string;
  position: TerrainPoint;
  distanceToGoalM: number;
  speedMps: number;
}

export interface MissionRun {
  schemaVersion: '1.0.0';
  runId: string;
  robotId: string;
  startedAt: string;
  endedAt: string;
  robotProfile: RobotProfile;
  durationS: number;
  seed: number;
  seedUsage: 'unused-deterministic';
  planner: PlannerProvenance;
  mission: MissionManifest;
  plan: MissionPlan;
  engine: {
    name: 'first-contact-kinematic';
    version: '1.0.0';
    fixedStepS: number;
    trajectoryModel: 'linear-source-space' | 'spherical-arc-radial-interpolation';
    physicsValidated: false;
    terrainContactValidated: false;
    imageSensors: false;
    trainingRun: false;
    observationModel: 'derived-kinematic-state';
  };
  referenceFrame: {
    id: 'mission_local';
    sourceFrameId: 'terrain_source';
    originInSource: TerrainPoint;
    rotationToSource: Orientation;
    axes: 'x-forward-y-left-z-up';
    registration: 'derived-from-start-and-goal-not-surveyed';
  };
  frames: RunFrame[];
  commands: CommandEvent[];
  observations: Observation[];
  result: {
    status: 'completed' | 'stopped' | 'budget-exhausted';
    goalReached: boolean;
    distanceToGoalM: number;
    reason: string;
  };
}

const pointSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'z'],
  properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
};

/** Portable JSON schema for a model response. Semantic bounds still require validatePlan. */
export const PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'steps', 'rationale'],
  properties: {
    schemaVersion: { type: 'string', enum: ['1.0.0'] },
    rationale: { type: 'string', minLength: 1, maxLength: 2000 },
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: RUN_LIMITS.maxSteps,
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['action', 'target', 'speedMps'],
            properties: {
              action: { type: 'string', enum: ['drive_to'] },
              target: pointSchema,
              speedMps: { type: 'number', minimum: RUN_LIMITS.minSpeedMps, maximum: RUN_LIMITS.maxSpeedMps },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['action', 'durationS'],
            properties: {
              action: { type: 'string', enum: ['wait'] },
              durationS: { type: 'number', minimum: 0, maximum: RUN_LIMITS.maxDurationS },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['action', 'label'],
            properties: {
              action: { type: 'string', enum: ['observe'] },
              label: { type: 'string', minLength: 1, maxLength: 160 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['action'],
            properties: { action: { type: 'string', enum: ['stop'] } },
          },
        ],
      },
    },
  },
};

export type PlanValidationResult = { valid: true; plan: MissionPlan } | { valid: false; errors: string[] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function point(value: unknown): value is TerrainPoint {
  return (
    record(value) && Object.keys(value).length === 3 && finite(value.x) && finite(value.y) && finite(value.z)
  );
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function textWithin(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
}
function copyPoint(value: TerrainPoint): TerrainPoint {
  return { x: value.x, y: value.y, z: value.z };
}
function vector(value: TerrainPoint): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}
function plainVector(value: Vector3): TerrainPoint {
  return { x: value.x === 0 ? 0 : value.x, y: value.y === 0 ? 0 : value.y, z: value.z === 0 ? 0 : value.z };
}
function plainRotation(value: Quaternion): Orientation {
  return {
    x: value.x === 0 ? 0 : value.x,
    y: value.y === 0 ? 0 : value.y,
    z: value.z === 0 ? 0 : value.z,
    w: value.w === 0 ? 0 : value.w,
  };
}
function canonicalTime(value: unknown): value is string {
  return (
    typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
  );
}

function legGeometry(start: TerrainPoint, end: TerrainPoint, globe: boolean) {
  const a = vector(start);
  const b = vector(end);
  if (!globe)
    return {
      length: a.distanceTo(b),
      sample: (progress: number) => plainVector(a.clone().lerp(b, progress)),
    };
  const radiusA = a.length();
  const radiusB = b.length();
  const unitA = a.clone().divideScalar(radiusA);
  const unitB = b.clone().divideScalar(radiusB);
  const dot = Math.max(-1, Math.min(1, unitA.dot(unitB)));
  const angle = Math.atan2(new Vector3().crossVectors(unitA, unitB).length(), dot);
  // A bounded spherical proxy, with endpoint radii interpolated. No streamed terrain sampling occurs.
  const length = Math.hypot((angle * (radiusA + radiusB)) / 2, radiusB - radiusA);
  return {
    length,
    sample(progress: number): TerrainPoint {
      if (progress <= 0) return copyPoint(start);
      if (progress >= 1) return copyPoint(end);
      const direction =
        angle < 1e-9
          ? unitA.clone().lerp(unitB, progress).normalize()
          : unitA
              .clone()
              .multiplyScalar(Math.sin((1 - progress) * angle) / Math.sin(angle))
              .addScaledVector(unitB, Math.sin(progress * angle) / Math.sin(angle))
              .normalize();
      return plainVector(direction.multiplyScalar(radiusA + (radiusB - radiusA) * progress));
    },
  };
}

export function validatePlan(value: unknown, mission?: MissionManifest): PlanValidationResult {
  const errors: string[] = [];
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'steps', 'rationale']))
    return { valid: false, errors: ['Plan must contain only schemaVersion, steps, and rationale'] };
  if (value.schemaVersion !== '1.0.0') errors.push('Unsupported plan schema version');
  if (!textWithin(value.rationale, 2000)) errors.push('Plan rationale must contain 1–2000 characters');
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > RUN_LIMITS.maxSteps)
    return { valid: false, errors: [...errors, `Plan requires 1–${RUN_LIMITS.maxSteps} steps`] };
  const steps: MissionStep[] = [];
  value.steps.forEach((step: unknown, index: number) => {
    const fail = (message: string) => errors.push(`Step ${index + 1}: ${message}`);
    if (!record(step)) return fail('command must be an object');
    if (step.action === 'drive_to') {
      if (!exactKeys(step, ['action', 'target', 'speedMps']) || !point(step.target))
        return fail('drive_to requires only finite XYZ target and speedMps');
      if (
        !finite(step.speedMps) ||
        step.speedMps < RUN_LIMITS.minSpeedMps ||
        step.speedMps > RUN_LIMITS.maxSpeedMps
      )
        return fail(`speedMps must be between ${RUN_LIMITS.minSpeedMps} and ${RUN_LIMITS.maxSpeedMps}`);
      steps.push({ action: 'drive_to', target: copyPoint(step.target), speedMps: step.speedMps });
    } else if (step.action === 'wait') {
      if (
        !exactKeys(step, ['action', 'durationS']) ||
        !finite(step.durationS) ||
        step.durationS < 0 ||
        step.durationS > RUN_LIMITS.maxDurationS
      )
        return fail(`wait durationS must be between 0 and ${RUN_LIMITS.maxDurationS}`);
      steps.push({ action: 'wait', durationS: step.durationS });
    } else if (step.action === 'observe') {
      if (!exactKeys(step, ['action', 'label']) || !textWithin(step.label, 160))
        return fail('observe requires only a label of 1–160 characters');
      steps.push({ action: 'observe', label: step.label.trim() });
    } else if (step.action === 'stop') {
      if (!exactKeys(step, ['action'])) return fail('stop does not accept extra fields');
      steps.push({ action: 'stop' });
    } else fail('unsupported command action');
  });
  if (mission && !validateMissionManifest(mission).valid) errors.push('Mission manifest is invalid');
  if (errors.length > 0) return { valid: false, errors };

  let prior = mission?.markers.rover.position;
  let duration = 0;
  let estimatedFrames = 1;
  for (const [index, step] of steps.entries()) {
    let stepDuration = 0;
    if (step.action === 'wait') stepDuration = step.durationS;
    if (step.action === 'drive_to' && mission && prior) {
      const fromStart = Math.hypot(
        step.target.x - mission.markers.rover.position.x,
        step.target.y - mission.markers.rover.position.y,
        step.target.z - mission.markers.rover.position.z,
      );
      const targetCheck = validateMissionManifest({
        ...mission,
        markers: { ...mission.markers, goal: { kind: 'goal', position: step.target } },
        traverse: { ...mission.traverse, straightLineDistanceM: fromStart },
      });
      if (!targetCheck.valid)
        errors.push(`Step ${index + 1}: target is outside the mission coordinate contract`);
      const leg = legGeometry(prior, step.target, mission.coordinateSpace.kind === 'body-fixed');
      if (!Number.isFinite(leg.length) || leg.length > RUN_LIMITS.maxLegM + 1e-6)
        errors.push(`Step ${index + 1}: drive leg exceeds ${RUN_LIMITS.maxLegM} m; choose a nearby target`);
      stepDuration = leg.length / step.speedMps;
      prior = step.target;
    }
    duration += stepDuration;
    estimatedFrames += Math.ceil(stepDuration / RUN_LIMITS.fixedStepS);
  }
  if (duration > RUN_LIMITS.maxDurationS + 1e-8)
    errors.push(`Plan exceeds the ${RUN_LIMITS.maxDurationS} s run budget; shorten the route or waits`);
  if (estimatedFrames > RUN_LIMITS.maxFrames)
    errors.push(`Plan exceeds the ${RUN_LIMITS.maxFrames} frame budget`);
  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, plan: { schemaVersion: '1.0.0', rationale: (value.rationale as string).trim(), steps } };
}

export function createBaselinePlan(mission: MissionManifest): MissionPlan {
  const plan: MissionPlan = {
    schemaVersion: '1.0.0',
    rationale:
      'Deterministic baseline: record the initial state, approach the selected goal at 0.75 m/s, then record the final state. Terrain contact and hazards are not modeled.',
    steps: [
      { action: 'observe', label: 'Initial kinematic state' },
      { action: 'drive_to', target: copyPoint(mission.markers.goal.position), speedMps: 0.75 },
      { action: 'observe', label: 'Final kinematic state' },
    ],
  };
  const result = validatePlan(plan, mission);
  if (!result.valid) throw new Error(result.errors.join('; '));
  return result.plan;
}

function orientationAt(position: TerrainPoint, heading: Vector3, globe: boolean): Quaternion {
  const up = globe ? vector(position).normalize() : new Vector3(0, 0, -1);
  const forward = heading.clone().addScaledVector(up, -heading.dot(up));
  if (forward.lengthSq() < 1e-16) {
    forward.set(Math.abs(up.x) < 0.9 ? 1 : 0, Math.abs(up.x) < 0.9 ? 0 : 1, 0);
    forward.addScaledVector(up, -forward.dot(up));
  }
  forward.normalize();
  const left = new Vector3().crossVectors(up, forward).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(forward, left, up)).normalize();
}

function plannerMetadata(value: PlannerProvenance): PlannerProvenance {
  if (
    !record(value) ||
    !['baseline', 'gemini'].includes(value.kind as string) ||
    Object.keys(value).some((key) => !['kind', 'model', 'prompt', 'generatedAt'].includes(key))
  )
    throw new Error('Unsupported planner provenance');
  if (value.model !== undefined && !textWithin(value.model, 160))
    throw new Error('Planner model must contain 1–160 characters');
  if (value.prompt !== undefined && !textWithin(value.prompt, 4000))
    throw new Error('Planner prompt must contain 1–4000 characters');
  if (value.generatedAt !== undefined && !canonicalTime(value.generatedAt))
    throw new Error('Planner generatedAt must be canonical UTC time');
  if (value.kind === 'gemini' && !value.model)
    throw new Error('Gemini provenance requires the actual model identifier');
  return {
    kind: value.kind,
    ...(value.model !== undefined ? { model: value.model } : {}),
    ...(value.prompt !== undefined ? { prompt: value.prompt } : {}),
    ...(value.generatedAt !== undefined ? { generatedAt: value.generatedAt } : {}),
  };
}

/** Pure bounded kinematics. No timers, network, code execution, random sensors, or terrain physics. */
export function runMission(input: RunInput): MissionRun {
  const validation = validatePlan(input.plan, input.mission);
  if (!validation.valid) throw new Error(`Invalid mission plan: ${validation.errors.join('; ')}`);
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffff_ffff)
    throw new Error('Seed must be an unsigned 32-bit integer');
  if (
    !canonicalTime(input.startedAt) ||
    Date.parse(input.startedAt) < 0 ||
    Date.parse(input.startedAt) > 18_446_742_273_709
  )
    throw new Error('Run start requires a supported canonical UTC timestamp');
  for (const id of [input.runId, input.robotId])
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id))
      throw new Error('Run and robot IDs must be 1–80 plain identifier characters');
  if (input.robotId !== ROBOT_PROFILE.id) throw new Error('Unsupported robot profile');
  const planner = plannerMetadata(input.planner);
  const mission = structuredClone(input.mission);
  const plan = validation.plan;
  const globe = mission.coordinateSpace.kind === 'body-fixed';
  const origin = vector(mission.markers.rover.position);
  let current = copyPoint(mission.markers.rover.position);
  let heading = vector(mission.markers.goal.position).sub(origin);
  const localToSource = orientationAt(current, heading, globe);
  const sourceToLocal = localToSource.clone().invert();
  const frames: RunFrame[] = [];
  const commands: CommandEvent[] = [];
  const observations: Observation[] = [];
  let elapsedNs = 0n;
  let terminal: MissionRun['result']['status'] = 'completed';
  const elapsedS = () => Number(elapsedNs) / 1e9;

  function appendFrame(commandIndex: number, mode: RunMode, speedMps: number) {
    const orientation = orientationAt(current, heading, globe);
    const frame: RunFrame = {
      sequence: frames.length,
      elapsedS: elapsedS(),
      position: copyPoint(current),
      localPosition: plainVector(vector(current).sub(origin).applyQuaternion(sourceToLocal)),
      orientation: plainRotation(orientation),
      localOrientation: plainRotation(sourceToLocal.clone().multiply(orientation).normalize()),
      speedMps,
      distanceToGoalM: distanceMeters(current, mission.markers.goal.position),
      commandIndex,
      mode,
    };
    if (frames.at(-1)?.elapsedS === frame.elapsedS)
      frames[frames.length - 1] = { ...frame, sequence: frames.length - 1 };
    else frames.push(frame);
  }

  function sampleStep(
    durationS: number,
    index: number,
    mode: RunMode,
    speed: number,
    sample: (fraction: number) => TerrainPoint,
  ) {
    const durationNs = BigInt(Math.round(durationS * 1e9));
    const fixedNs = BigInt(Math.round(RUN_LIMITS.fixedStepS * 1e9));
    let completedNs = 0n;
    while (completedNs < durationNs) {
      const deltaNs = durationNs - completedNs < fixedNs ? durationNs - completedNs : fixedNs;
      if (
        frames.length >= RUN_LIMITS.maxFrames ||
        elapsedNs + deltaNs > BigInt(RUN_LIMITS.maxDurationS) * 1_000_000_000n
      )
        return false;
      completedNs += deltaNs;
      elapsedNs += deltaNs;
      const previous = current;
      current = sample(Number(completedNs) / Number(durationNs));
      if (mode === 'driving' && distanceMeters(previous, current) > 1e-10)
        heading = vector(current).sub(vector(previous));
      appendFrame(index, mode, speed);
    }
    return true;
  }

  appendFrame(-1, 'idle', 0);
  for (const [index, step] of plan.steps.entries()) {
    commands.push({
      sequence: commands.length,
      stepIndex: index,
      elapsedS: elapsedS(),
      phase: 'started',
      command: structuredClone(step),
    });
    if (step.action === 'drive_to') {
      const leg = legGeometry(current, step.target, globe);
      if (!sampleStep(leg.length / step.speedMps, index, 'driving', step.speedMps, leg.sample)) {
        terminal = 'budget-exhausted';
        break;
      }
      current = copyPoint(step.target);
      appendFrame(index, 'idle', 0);
    } else if (step.action === 'wait') {
      const held = copyPoint(current);
      if (!sampleStep(step.durationS, index, 'waiting', 0, () => copyPoint(held))) {
        terminal = 'budget-exhausted';
        break;
      }
      appendFrame(index, 'idle', 0);
    } else if (step.action === 'observe') {
      observations.push({
        sequence: observations.length,
        elapsedS: elapsedS(),
        stepIndex: index,
        kind: 'kinematic-state',
        synthetic: true,
        label: step.label,
        position: copyPoint(current),
        distanceToGoalM: distanceMeters(current, mission.markers.goal.position),
        speedMps: 0,
      });
    } else {
      terminal = 'stopped';
      appendFrame(index, 'stopped', 0);
    }
    commands.push({
      sequence: commands.length,
      stepIndex: index,
      elapsedS: elapsedS(),
      phase: 'completed',
      command: structuredClone(step),
    });
    if (terminal === 'stopped') break;
  }
  if (terminal === 'budget-exhausted') appendFrame(frames.at(-1)!.commandIndex, 'stopped', 0);
  const distanceToGoalM = distanceMeters(current, mission.markers.goal.position);
  const goalReached = distanceToGoalM <= RUN_LIMITS.goalToleranceM;
  return {
    schemaVersion: '1.0.0',
    runId: input.runId,
    robotId: input.robotId,
    startedAt: input.startedAt,
    endedAt: new Date(Date.parse(input.startedAt) + Math.round(elapsedS() * 1000)).toISOString(),
    robotProfile: Object.freeze({
      id: ROBOT_PROFILE.id,
      revision: ROBOT_PROFILE.revision,
      model: ROBOT_PROFILE.model,
      maxSpeedMps: ROBOT_PROFILE.maxSpeedMps,
    }),
    durationS: elapsedS(),
    seed: input.seed,
    seedUsage: 'unused-deterministic',
    planner,
    mission,
    plan,
    engine: {
      name: 'first-contact-kinematic',
      version: '1.0.0',
      fixedStepS: RUN_LIMITS.fixedStepS,
      trajectoryModel: globe ? 'spherical-arc-radial-interpolation' : 'linear-source-space',
      physicsValidated: false,
      terrainContactValidated: false,
      imageSensors: false,
      trainingRun: false,
      observationModel: 'derived-kinematic-state',
    },
    referenceFrame: {
      id: 'mission_local',
      sourceFrameId: 'terrain_source',
      originInSource: plainVector(origin),
      rotationToSource: plainRotation(localToSource),
      axes: 'x-forward-y-left-z-up',
      registration: 'derived-from-start-and-goal-not-surveyed',
    },
    frames,
    commands,
    observations,
    result: {
      status: terminal,
      goalReached,
      distanceToGoalM,
      reason:
        terminal === 'stopped'
          ? 'Plan issued stop; remaining commands were not executed.'
          : terminal === 'budget-exhausted'
            ? 'Execution reached its duration or sample budget.'
            : goalReached
              ? 'All commands completed and the selected goal was reached in the kinematic model.'
              : 'All commands completed; the selected mission goal was not reached.',
    },
  };
}
