import { LIBRARY_IDENTIFIER, McapIndexedReader, McapWriter, type IWritable } from '@mcap/core';
import {
  FrameTransforms as frameTransformsSchema,
  PoseInFrame as poseSchema,
  SceneUpdate as sceneSchema,
} from '@foxglove/schemas/dist/jsonschema/index.js';
import type { FrameTransforms, PoseInFrame, SceneUpdate, Time } from '@foxglove/schemas';
import { validateMissionManifest, type TerrainPoint } from '../domain/mission.ts';
import {
  ROBOT_PROFILE,
  RUN_LIMITS,
  validatePlan,
  type MissionRun,
  type MissionStep,
  type Orientation,
} from '../simulation/missionRun.ts';
import { commandSchema, observationSchema, resultSchema, runMetadataSchema, stateSchema } from './schemas.ts';

const MAX_RECORDING_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const identity = { x: 0, y: 0, z: 0, w: 1 };

function json(value: unknown): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'number' && !Number.isFinite(item))
        throw new Error('Recording contains a non-finite number');
      return item;
    }),
  );
}
function xyz(value: TerrainPoint): TerrainPoint {
  return { x: value.x, y: value.y, z: value.z };
}
function xyzw(value: Orientation): Orientation {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}
function time(value: bigint): Time {
  return { sec: Number(value / 1_000_000_000n), nsec: Number(value % 1_000_000_000n) };
}
function command(value: MissionStep): MissionStep {
  if (value.action === 'drive_to')
    return { action: 'drive_to', target: xyz(value.target), speedMps: value.speedMps };
  if (value.action === 'wait') return { action: 'wait', durationS: value.durationS };
  if (value.action === 'observe') return { action: 'observe', label: value.label };
  if (value.action === 'stop') return { action: 'stop' };
  throw new Error('Unsupported recorded command');
}

/** Copy every writer buffer: MCAP may reuse its internal backing storage after write returns. */
class MemoryWritable implements IWritable {
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  private length = 0;
  async write(buffer: Uint8Array): Promise<void> {
    if (this.length + buffer.byteLength > MAX_RECORDING_BYTES)
      throw new Error('Recording exceeds the 64 MiB browser export limit');
    this.chunks.push(new Uint8Array(buffer));
    this.length += buffer.byteLength;
  }
  position(): bigint {
    return BigInt(this.length);
  }
  bytes(): Uint8Array<ArrayBuffer> {
    const output = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}

function runMetadata(run: MissionRun) {
  return {
    schemaVersion: run.schemaVersion,
    runId: run.runId,
    robotId: run.robotId,
    robotProfile: {
      id: run.robotProfile.id,
      revision: run.robotProfile.revision,
      model: run.robotProfile.model,
      maxSpeedMps: run.robotProfile.maxSpeedMps,
    },
    startedAt: run.startedAt,
    durationS: run.durationS,
    seed: run.seed,
    seedUsage: run.seedUsage,
    dataClass: 'synthetic-kinematic',
    planner: {
      kind: run.planner.kind,
      ...(run.planner.model !== undefined ? { model: run.planner.model } : {}),
      ...(run.planner.prompt !== undefined ? { prompt: run.planner.prompt } : {}),
      ...(run.planner.generatedAt !== undefined ? { generatedAt: run.planner.generatedAt } : {}),
    },
    mission: run.mission,
    plan: {
      schemaVersion: run.plan.schemaVersion,
      rationale: run.plan.rationale,
      steps: run.plan.steps.map(command),
    },
    engine: {
      name: run.engine.name,
      version: run.engine.version,
      fixedStepS: run.engine.fixedStepS,
      trajectoryModel: run.engine.trajectoryModel,
      physicsValidated: false,
      terrainContactValidated: false,
      imageSensors: false,
      trainingRun: false,
      observationModel: run.engine.observationModel,
    },
    referenceFrame: {
      id: run.referenceFrame.id,
      sourceFrameId: run.referenceFrame.sourceFrameId,
      originInSource: xyz(run.referenceFrame.originInSource),
      rotationToSource: xyzw(run.referenceFrame.rotationToSource),
      axes: run.referenceFrame.axes,
      registration: run.referenceFrame.registration,
    },
  };
}

/** Portable geometry proxy only; its dimensions and contact behavior are not a calibrated robot asset. */
function roverScene(run: MissionRun, timestamp: Time): SceneUpdate {
  return {
    deletions: [],
    entities: [
      {
        timestamp,
        frame_id: run.robotId,
        id: 'rover-proxy',
        lifetime: { sec: 0, nsec: 0 },
        frame_locked: true,
        metadata: [
          { key: 'representation', value: 'generic geometric rover proxy' },
          { key: 'physicsValidated', value: 'false' },
        ],
        arrows: [],
        spheres: [],
        lines: [],
        triangles: [],
        texts: [],
        models: [],
        cubes: [
          {
            pose: { position: { x: 0, y: 0, z: 0.52 }, orientation: identity },
            size: { x: 1.5, y: 0.9, z: 0.45 },
            color: { r: 0.86, g: 0.76, b: 0.59, a: 1 },
          },
        ],
        cylinders: [-0.55, 0, 0.55].flatMap((x) =>
          [-0.58, 0.58].map((y) => ({
            pose: {
              position: { x, y, z: 0.22 },
              orientation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
            },
            size: { x: 0.44, y: 0.44, z: 0.16 },
            bottom_scale: 1,
            top_scale: 1,
            color: { r: 0.2, g: 0.24, b: 0.27, a: 1 },
          })),
        ),
      },
    ],
  };
}

/**
 * Real indexed MCAP, with UTF-8 JSON and embedded official Foxglove schemas.
 * https://mcap.dev/docs/typescript/classes/_mcap_core.McapWriter
 * https://docs.foxglove.dev/docs/getting-started/custom/custom-schema-encodings
 * Every writer operation is awaited sequentially, including finalization.
 */
export async function encodeRunMcap(run: MissionRun): Promise<Uint8Array<ArrayBuffer>> {
  if (!validateMissionManifest(run.mission).valid || !validatePlan(run.plan, run.mission).valid)
    throw new Error('Recording requires a valid mission and plan');
  if (
    run.robotId !== ROBOT_PROFILE.id ||
    run.robotProfile.id !== ROBOT_PROFILE.id ||
    run.robotProfile.revision !== ROBOT_PROFILE.revision ||
    run.robotProfile.model !== ROBOT_PROFILE.model ||
    run.robotProfile.maxSpeedMps !== ROBOT_PROFILE.maxSpeedMps
  )
    throw new Error('Recording robot profile does not match the supported model revision');
  if (
    run.engine.name !== 'first-contact-kinematic' ||
    run.engine.physicsValidated !== false ||
    run.engine.terrainContactValidated !== false ||
    run.engine.trainingRun !== false ||
    run.engine.imageSensors !== false
  )
    throw new Error('Unsupported run model or validation claim');
  if (run.frames.length < 1 || run.frames.length > RUN_LIMITS.maxFrames)
    throw new Error('Recording requires a bounded nonempty trajectory');
  if (!Number.isFinite(Date.parse(run.startedAt))) throw new Error('Recording start time is invalid');
  for (const [index, frame] of run.frames.entries()) {
    if (
      !Number.isFinite(frame.elapsedS) ||
      frame.elapsedS < 0 ||
      frame.elapsedS > RUN_LIMITS.maxDurationS ||
      (index > 0 && frame.elapsedS <= run.frames[index - 1]!.elapsedS)
    )
      throw new Error('Recording frame times must increase within the run budget');
  }
  const start = BigInt(Date.parse(run.startedAt)) * 1_000_000n;
  const timestamp = (elapsedS: number) => start + BigInt(Math.round(elapsedS * 1e9));
  const sink = new MemoryWritable();
  const writer = new McapWriter({
    writable: sink,
    useChunks: true,
    useMessageIndex: true,
    useChunkIndex: true,
    useStatistics: true,
  });
  await writer.start({ profile: '', library: `rocket-academy-kinematic/1.0.0; ${LIBRARY_IDENTIFIER}` });

  const channels = new Map<string, number>();
  const channelSpecs = [
    ['/mission/run', runMetadataSchema],
    ['/mission/commands', commandSchema],
    ['/tf', frameTransformsSchema],
    [`/robots/${run.robotId}/pose`, poseSchema],
    [`/robots/${run.robotId}/state`, stateSchema],
    [`/robots/${run.robotId}/observations`, observationSchema],
    ['/scene/robot', sceneSchema],
    ['/mission/result', resultSchema],
  ] as const;
  for (const [topic, schema] of channelSpecs) {
    const schemaId = await writer.registerSchema({
      name: schema.title,
      encoding: 'jsonschema',
      data: json(schema),
    });
    const channelId = await writer.registerChannel({
      schemaId,
      topic,
      messageEncoding: 'json',
      metadata: new Map([
        ['data_class', 'synthetic-kinematic'],
        ['run_id', run.runId],
        ['robot_id', run.robotId],
      ]),
    });
    channels.set(topic, channelId);
  }

  const events: { elapsedS: number; priority: number; topic: string; data: object }[] = [];
  const add = (elapsedS: number, priority: number, topic: string, data: object) =>
    events.push({ elapsedS, priority, topic, data });
  add(0, 0, '/mission/run', runMetadata(run));
  for (const event of run.commands)
    add(event.elapsedS, 1, '/mission/commands', {
      runId: run.runId,
      robotId: run.robotId,
      sequence: event.sequence,
      stepIndex: event.stepIndex,
      elapsedS: event.elapsedS,
      phase: event.phase,
      command: command(event.command),
    });
  for (const frame of run.frames) {
    const stamp = time(timestamp(frame.elapsedS));
    const transforms: FrameTransforms = {
      transforms: [
        {
          timestamp: stamp,
          parent_frame_id: run.referenceFrame.sourceFrameId,
          child_frame_id: run.referenceFrame.id,
          translation: xyz(run.referenceFrame.originInSource),
          rotation: xyzw(run.referenceFrame.rotationToSource),
        },
        {
          timestamp: stamp,
          parent_frame_id: run.referenceFrame.id,
          child_frame_id: run.robotId,
          translation: xyz(frame.localPosition),
          rotation: xyzw(frame.localOrientation),
        },
      ],
    };
    const pose: PoseInFrame = {
      timestamp: stamp,
      frame_id: run.referenceFrame.id,
      pose: { position: xyz(frame.localPosition), orientation: xyzw(frame.localOrientation) },
    };
    add(frame.elapsedS, 2, '/tf', transforms);
    add(frame.elapsedS, 3, `/robots/${run.robotId}/pose`, pose);
    add(frame.elapsedS, 4, `/robots/${run.robotId}/state`, {
      runId: run.runId,
      robotId: run.robotId,
      sequence: frame.sequence,
      elapsedS: frame.elapsedS,
      frameId: run.referenceFrame.sourceFrameId,
      position: xyz(frame.position),
      orientation: xyzw(frame.orientation),
      localFrameId: run.referenceFrame.id,
      localPosition: xyz(frame.localPosition),
      localOrientation: xyzw(frame.localOrientation),
      speedMps: frame.speedMps,
      distanceToGoalM: frame.distanceToGoalM,
      commandIndex: frame.commandIndex,
      mode: frame.mode,
      synthetic: true,
    });
  }
  for (const observation of run.observations)
    add(observation.elapsedS, 5, `/robots/${run.robotId}/observations`, {
      runId: run.runId,
      robotId: run.robotId,
      sequence: observation.sequence,
      elapsedS: observation.elapsedS,
      stepIndex: observation.stepIndex,
      kind: observation.kind,
      synthetic: true,
      label: observation.label,
      frameId: run.referenceFrame.sourceFrameId,
      position: xyz(observation.position),
      distanceToGoalM: observation.distanceToGoalM,
      speedMps: observation.speedMps,
    });
  add(0, 6, '/scene/robot', roverScene(run, time(start)));
  add(run.durationS, 7, '/mission/result', {
    runId: run.runId,
    robotId: run.robotId,
    endedAt: run.endedAt,
    durationS: run.durationS,
    status: run.result.status,
    goalReached: run.result.goalReached,
    distanceToGoalM: run.result.distanceToGoalM,
    reason: run.result.reason,
    physicsValidated: false,
    trainingRun: false,
  });
  events.sort((a, b) => a.elapsedS - b.elapsedS || a.priority - b.priority);
  const sequences = new Map<number, number>();
  for (const event of events) {
    const channelId = channels.get(event.topic)!;
    const sequence = sequences.get(channelId) ?? 0;
    const logTime = timestamp(event.elapsedS);
    await writer.addMessage({ channelId, sequence, logTime, publishTime: logTime, data: json(event.data) });
    sequences.set(channelId, sequence + 1);
  }
  await writer.addMetadata({
    name: 'rocketacademy.run',
    metadata: new Map([
      ['run_id', run.runId],
      ['robot_id', run.robotId],
      ['robot_revision', run.robotProfile.revision],
      ['robot_model', run.robotProfile.model],
      ['source_id', run.mission.source.sourceId],
      ['source_revision', run.mission.source.sourceRevision ?? 'unversioned'],
      ['source_revision_status', run.mission.source.revisionStatus],
      ['engine', 'first-contact-kinematic/1.0.0'],
      ['data_class', 'synthetic-kinematic'],
      ['seed', String(run.seed)],
      ['physics_validated', 'false'],
      ['training_run', 'false'],
    ]),
  });
  await writer.addAttachment({
    name: 'mission.json',
    logTime: start,
    createTime: start,
    mediaType: 'application/json',
    data: json(run.mission),
  });
  await writer.addAttachment({
    name: 'plan.json',
    logTime: start,
    createTime: start,
    mediaType: 'application/json',
    data: json({
      schemaVersion: run.plan.schemaVersion,
      rationale: run.plan.rationale,
      steps: run.plan.steps.map(command),
    }),
  });
  await writer.end();
  return sink.bytes();
}

export interface McapInspection {
  profile: string;
  library: string;
  chunkCount: number;
  channels: {
    topic: string;
    schemaName: string;
    messageEncoding: string;
    schemaEncoding: string;
    messageCount: number;
  }[];
  messages: {
    topic: string;
    schemaName: string;
    sequence: number;
    logTime: bigint;
    publishTime: bigint;
    data: unknown;
  }[];
  attachments: { name: string; mediaType: string; data: unknown }[];
  metadata: { name: string; values: Record<string, string> }[];
}

/** Indexed readback of this application's bounded, uncompressed JSON recordings, with CRC checks. */
export async function inspectRunMcap(bytes: Uint8Array): Promise<McapInspection> {
  if (bytes.byteLength > MAX_RECORDING_BYTES)
    throw new Error('Recording exceeds the 64 MiB inspection limit');
  const reader = await McapIndexedReader.Initialize({
    readable: {
      size: async () => BigInt(bytes.byteLength),
      read: async (offset, length) => {
        if (offset < 0n || length < 0n || offset + length > BigInt(bytes.byteLength))
          throw new Error('MCAP read is outside the file');
        return bytes.slice(Number(offset), Number(offset + length));
      },
    },
  });
  const channels = [...reader.channelsById.values()].map((channel) => ({
    topic: channel.topic,
    schemaName: reader.schemasById.get(channel.schemaId)?.name ?? '',
    messageEncoding: channel.messageEncoding,
    schemaEncoding: reader.schemasById.get(channel.schemaId)?.encoding ?? '',
    messageCount: Number(reader.statistics?.channelMessageCounts.get(channel.id) ?? 0n),
  }));
  const messages: McapInspection['messages'] = [];
  for await (const message of reader.readMessages({ validateCrcs: true })) {
    const channel = reader.channelsById.get(message.channelId)!;
    if (channel.messageEncoding !== 'json') throw new Error('This inspector supports JSON recordings only');
    messages.push({
      topic: channel.topic,
      schemaName: reader.schemasById.get(channel.schemaId)?.name ?? '',
      sequence: message.sequence,
      logTime: message.logTime,
      publishTime: message.publishTime,
      data: JSON.parse(decoder.decode(message.data)) as unknown,
    });
    if (messages.length > RUN_LIMITS.maxFrames * 8) throw new Error('Recording message budget exceeded');
  }
  const attachments: McapInspection['attachments'] = [];
  for await (const attachment of reader.readAttachments({ validateCrcs: true })) {
    attachments.push({
      name: attachment.name,
      mediaType: attachment.mediaType,
      data:
        attachment.mediaType === 'application/json'
          ? (JSON.parse(decoder.decode(attachment.data)) as unknown)
          : decoder.decode(attachment.data),
    });
  }
  const metadata: McapInspection['metadata'] = [];
  for await (const entry of reader.readMetadata())
    metadata.push({ name: entry.name, values: Object.fromEntries(entry.metadata) });
  return {
    profile: reader.header.profile,
    library: reader.header.library,
    chunkCount: reader.chunkIndexes.length,
    channels,
    messages,
    attachments,
    metadata,
  };
}
