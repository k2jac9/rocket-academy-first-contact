import { describe, expect, it } from 'vitest';
import { createMissionManifest } from '../domain/mission.ts';
import { createBaselinePlan, runMission } from '../simulation/missionRun.ts';
import { encodeRunMcap, inspectRunMcap } from './mcap.ts';

function sampleRun() {
  const mission = createMissionManifest({
    mode: 'dingo-gap',
    rover: { x: 0, y: 0, z: 2 },
    goal: { x: 2, y: 0, z: 2 },
    createdAt: '2026-11-14T12:00:00.000Z',
  });
  return runMission({
    mission,
    plan: createBaselinePlan(mission),
    planner: { kind: 'baseline' },
    runId: 'mcap-test',
    robotId: 'rover-1',
    startedAt: mission.createdAt,
    seed: 42,
  });
}

describe('real MCAP recording', () => {
  it('writes indexed, self-describing JSON channels and decodes all messages', async () => {
    const run = sampleRun();
    const bytes = await encodeRunMcap(run);
    const inspection = await inspectRunMcap(bytes);
    const magic = [0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 0x0d, 0x0a];

    expect([...bytes.subarray(0, 8)]).toEqual(magic);
    expect([...bytes.subarray(-8)]).toEqual(magic);
    expect(inspection.profile).toBe('');
    expect(inspection.chunkCount).toBeGreaterThan(0);
    expect(
      inspection.channels.every(
        (channel) => channel.messageEncoding === 'json' && channel.schemaEncoding === 'jsonschema',
      ),
    ).toBe(true);
    expect(inspection.channels.map((channel) => channel.schemaName)).toEqual(
      expect.arrayContaining(['foxglove.PoseInFrame', 'foxglove.FrameTransforms', 'foxglove.SceneUpdate']),
    );
    const poses = inspection.messages.filter((message) => message.topic === '/robots/rover-1/pose');
    const states = inspection.messages.filter((message) => message.topic === '/robots/rover-1/state');
    expect(poses).toHaveLength(run.frames.length);
    expect(states).toHaveLength(run.frames.length);
    expect(states.at(-1)?.data).toMatchObject({ position: { x: 2, y: 0, z: 2 } });
    expect(inspection.attachments.map((attachment) => attachment.name)).toEqual([
      'mission.json',
      'plan.json',
    ]);
  });

  it('retains source registration, actual terminal result, and synthetic-data labels', async () => {
    const run = sampleRun();
    const inspection = await inspectRunMcap(await encodeRunMcap(run));
    const metadata = inspection.messages.find((message) => message.topic === '/mission/run')!.data;
    const result = inspection.messages.find((message) => message.topic === '/mission/result')!.data;
    const observations = inspection.messages.filter(
      (message) => message.topic === '/robots/rover-1/observations',
    );
    const transforms = inspection.messages.find((message) => message.topic === '/tf')!.data;

    expect(metadata).toMatchObject({
      seed: 42,
      seedUsage: 'unused-deterministic',
      robotProfile: { id: 'rover-1', revision: '1.0.0', model: 'kinematic-point-rover', maxSpeedMps: 2 },
      mission: { source: { sourceRevision: '76444abbb4faff1b05f46a09b81ca2c24602b333' } },
      engine: {
        physicsValidated: false,
        terrainContactValidated: false,
        imageSensors: false,
        trainingRun: false,
      },
    });
    expect(result).toMatchObject({ status: 'completed', goalReached: true });
    expect(observations.every((message) => (message.data as { synthetic: boolean }).synthetic)).toBe(true);
    expect(transforms).toMatchObject({
      transforms: [
        { parent_frame_id: 'terrain_source', child_frame_id: 'mission_local' },
        { parent_frame_id: 'mission_local', child_frame_id: 'rover-1' },
      ],
    });
    expect(inspection.metadata.find((entry) => entry.name === 'rocketacademy.run')?.values).toMatchObject({
      robot_id: 'rover-1',
      robot_revision: '1.0.0',
      robot_model: 'kinematic-point-rover',
    });
  });

  it('uses exact integer nanosecond times and monotonic per-channel sequences', async () => {
    const run = sampleRun();
    const inspection = await inspectRunMcap(await encodeRunMcap(run));
    const base = BigInt(Date.parse(run.startedAt)) * 1_000_000n;
    const poses = inspection.messages.filter((message) => message.topic === '/robots/rover-1/pose');
    expect(poses[0]!.logTime).toBe(base);
    expect(poses[1]!.logTime - poses[0]!.logTime).toBe(200_000_000n);
    expect(poses.map((message) => message.sequence)).toEqual(poses.map((_message, index) => index));
    expect(
      inspection.messages.every(
        (message, index, messages) => index === 0 || message.logTime >= messages[index - 1]!.logTime,
      ),
    ).toBe(true);
  });

  it('does not include unrelated credentials attached to a run object', async () => {
    const bytes = await encodeRunMcap({ ...sampleRun(), apiKey: 'private-test-token' } as ReturnType<
      typeof sampleRun
    >);
    expect(new TextDecoder().decode(bytes)).not.toContain('private-test-token');
  });

  it('rejects corrupted payload data through chunk CRC validation', async () => {
    const bytes = await encodeRunMcap(sampleRun());
    const corrupted = bytes.slice();
    const needle = Buffer.from('"elapsedS":0.2');
    const offset = Buffer.from(corrupted).indexOf(needle);
    expect(offset).toBeGreaterThan(0);
    corrupted[offset + needle.length - 1] = '3'.charCodeAt(0);
    await expect(inspectRunMcap(corrupted)).rejects.toThrow(/crc|checksum/i);
  });

  it('rejects truncated files rather than claiming a valid recording', async () => {
    const bytes = await encodeRunMcap(sampleRun());
    await expect(inspectRunMcap(bytes.slice(0, -20))).rejects.toThrow();
  });
});
