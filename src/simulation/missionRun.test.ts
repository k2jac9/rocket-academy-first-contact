import { describe, expect, it } from 'vitest';
import { createMissionManifest } from '../domain/mission.ts';
import {
  createBaselinePlan,
  runMission,
  validatePlan,
  type MissionPlan,
  type RunInput,
} from './missionRun.ts';

const startedAt = '2026-11-14T12:00:00.000Z';

function localMission() {
  return createMissionManifest({
    mode: 'dingo-gap',
    rover: { x: 0, y: 0, z: 2 },
    goal: { x: 20, y: 0, z: 2 },
    createdAt: startedAt,
  });
}

function input(overrides: Partial<RunInput> = {}): RunInput {
  const mission = localMission();
  return {
    mission,
    plan: createBaselinePlan(mission),
    planner: { kind: 'baseline' },
    runId: 'test-run',
    robotId: 'rover-1',
    startedAt,
    seed: 42,
    ...overrides,
  };
}

describe('bounded mission plans', () => {
  it('creates a valid baseline plan that reaches the selected goal', () => {
    const mission = localMission();
    const plan = createBaselinePlan(mission);
    const result = validatePlan(plan, mission);

    expect(result.valid).toBe(true);
    expect(plan.steps.find((step) => step.action === 'drive_to')).toMatchObject({
      action: 'drive_to',
      target: { x: 20, y: 0, z: 2 },
    });
  });

  it.each([
    ['unknown action', { action: 'execute_code', code: 'alert(1)' }],
    ['nonfinite coordinate', { action: 'drive_to', target: { x: NaN, y: 0, z: 2 }, speedMps: 1 }],
    ['too fast', { action: 'drive_to', target: { x: 20, y: 0, z: 2 }, speedMps: 3 }],
    ['zero speed', { action: 'drive_to', target: { x: 20, y: 0, z: 2 }, speedMps: 0 }],
    ['negative wait', { action: 'wait', durationS: -1 }],
    ['oversized wait', { action: 'wait', durationS: 2000 }],
    ['empty observation label', { action: 'observe', label: '  ' }],
    ['unknown credential property', { action: 'stop', apiKey: 'private-value' }],
  ])('rejects %s', (_label, step) => {
    const result = validatePlan({ schemaVersion: '1.0.0', rationale: 'Test', steps: [step] }, localMission());
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).not.toContain('private-value');
  });

  it('rejects a long traverse instead of teleporting or increasing its speed', () => {
    const mission = createMissionManifest({
      mode: 'moon',
      rover: { x: 1_737_400, y: 0, z: 0 },
      goal: { x: 0, y: 1_737_400, z: 0 },
      createdAt: startedAt,
    });
    const result = validatePlan(
      {
        schemaVersion: '1.0.0',
        rationale: 'Far goal',
        steps: [{ action: 'drive_to', target: mission.markers.goal.position, speedMps: 2 }],
      },
      mission,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).toMatch(/1,?000|leg/i);
  });

  it('rejects a plan exceeding the total duration budget', () => {
    const result = validatePlan(
      {
        schemaVersion: '1.0.0',
        rationale: 'Too long',
        steps: [
          { action: 'wait', durationS: 1000 },
          { action: 'wait', durationS: 1000 },
        ],
      },
      localMission(),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects extra top-level data and too many commands', () => {
    expect(validatePlan({ ...createBaselinePlan(localMission()), token: 'private-value' }).valid).toBe(false);
    expect(
      validatePlan({
        schemaVersion: '1.0.0',
        rationale: 'Too many',
        steps: Array.from({ length: 33 }, () => ({ action: 'stop' })),
      }).valid,
    ).toBe(false);
  });
});

describe('deterministic kinematic execution', () => {
  it('captures the exact immutable robot model revision used for execution', () => {
    const run = runMission(input());
    expect(run.robotProfile).toEqual({
      id: 'rover-1',
      revision: '1.0.0',
      model: 'kinematic-point-rover',
      maxSpeedMps: 2,
    });
    const another = runMission(input());
    expect(run.robotProfile).not.toBe(another.robotProfile);
  });

  it('rejects an unregistered robot instead of attributing another model to it', () => {
    expect(() => runMission(input({ robotId: 'rover-2' }))).toThrow(/robot/i);
  });

  it('reaches the goal, preserves source identity, and records explicit modeling limits', () => {
    const run = runMission(input());
    const last = run.frames.at(-1)!;

    expect(run.result.goalReached).toBe(true);
    expect(run.result.status).toBe('completed');
    expect(last.position).toEqual({ x: 20, y: 0, z: 2 });
    expect(run.frames[0]!.localPosition).toEqual({ x: 0, y: 0, z: 0 });
    expect(run.engine).toMatchObject({
      physicsValidated: false,
      terrainContactValidated: false,
      imageSensors: false,
      trainingRun: false,
    });
    expect(run.mission.source.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(run.seedUsage).toBe('unused-deterministic');
    expect(
      run.observations.every(
        (observation) => observation.synthetic && observation.kind === 'kinematic-state',
      ),
    ).toBe(true);
  });

  it('repeats exactly for the same inputs and does not mutate mission state', () => {
    const request = input();
    const original = structuredClone(request);
    expect(runMission(request)).toEqual(runMission(request));
    expect(request).toEqual(original);
    const run = runMission(request);
    request.mission.markers.rover.position.x = 99;
    expect(run.mission.markers.rover.position.x).toBe(0);
  });

  it('uses monotonic bounded samples and finite unit quaternions', () => {
    const run = runMission(input());
    expect(run.frames.length).toBeLessThanOrEqual(10_000);
    expect(run.durationS).toBeLessThanOrEqual(1800);
    for (let index = 0; index < run.frames.length; index += 1) {
      const frame = run.frames[index]!;
      if (index > 0) expect(frame.elapsedS).toBeGreaterThan(run.frames[index - 1]!.elapsedS);
      expect(frame.speedMps).toBeLessThanOrEqual(2);
      expect(Object.values(frame.position).every(Number.isFinite)).toBe(true);
      expect(
        Math.hypot(frame.orientation.x, frame.orientation.y, frame.orientation.z, frame.orientation.w),
      ).toBeCloseTo(1, 10);
    }
  });

  it('reports an early stop without claiming the goal was reached', () => {
    const plan: MissionPlan = {
      schemaVersion: '1.0.0',
      rationale: 'Inspect before driving',
      steps: [
        { action: 'wait', durationS: 1 },
        { action: 'stop' },
        { action: 'drive_to', target: { x: 20, y: 0, z: 2 }, speedMps: 1 },
      ],
    };
    const run = runMission(input({ plan }));
    expect(run.result.status).toBe('stopped');
    expect(run.result.goalReached).toBe(false);
    expect(run.frames.at(-1)!.position).toEqual({ x: 0, y: 0, z: 2 });
    expect(run.commands.some((command) => command.stepIndex === 2)).toBe(false);
  });

  it('handles a zero-distance drive without NaN or duplicate timestamps', () => {
    const mission = localMission();
    mission.markers.goal.position = { ...mission.markers.rover.position };
    mission.traverse.straightLineDistanceM = 0;
    const run = runMission(input({ mission, plan: createBaselinePlan(mission) }));
    expect(run.result.goalReached).toBe(true);
    expect(run.frames).toHaveLength(1);
  });

  it('keeps a short globe route on its spherical proxy and preserves exact endpoints', () => {
    const radius = 1_737_400;
    const angle = 100 / radius;
    const mission = createMissionManifest({
      mode: 'moon',
      rover: { x: radius, y: 0, z: 0 },
      goal: { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: 0 },
      createdAt: startedAt,
    });
    const run = runMission(input({ mission, plan: createBaselinePlan(mission) }));
    expect(run.engine.trajectoryModel).toBe('spherical-arc-radial-interpolation');
    expect(run.frames.at(-1)!.position).toEqual(mission.markers.goal.position);
    for (const frame of run.frames)
      expect(Math.hypot(frame.position.x, frame.position.y, frame.position.z)).toBeCloseTo(radius, 6);
    expect(run.result.goalReached).toBe(true);
  });

  it.each([
    { seed: -1 },
    { seed: 1.5 },
    { startedAt: 'invalid' },
    { robotId: '../secrets' },
    { planner: { kind: 'fake-ai' } },
    { planner: { kind: 'baseline', apiKey: 'private-value' } },
  ])('rejects invalid run metadata: %j', (overrides) => {
    expect(() => runMission(input(overrides as Partial<RunInput>))).toThrow();
  });
});
