import { McapWriter } from '@mcap/core';
import { zstdCompressSync } from 'node:zlib';
import type { PhysicsEpisode } from '../src/simulation/episode.ts';

const encoder = new TextEncoder();
const json = (value: unknown) => encoder.encode(JSON.stringify(value));
const vector = (length: number) => ({
  type: 'array',
  items: { type: 'number' },
  minItems: length,
  maxItems: length,
});
const stateSchema = {
  title: 'first_contact.PhysicsRobotState',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'elapsedS',
    'position',
    'orientationWxyz',
    'velocity',
    'jointPosition',
    'jointVelocity',
    'action',
    'contacts',
  ],
  properties: {
    id: { enum: ['rover-1', 'rover-2'] },
    elapsedS: { type: 'number', minimum: 0 },
    position: vector(3),
    orientationWxyz: vector(4),
    velocity: vector(6),
    jointPosition: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 6 },
    jointVelocity: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 6 },
    action: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 6 },
    contacts: { type: 'integer', minimum: 0 },
  },
};
const sensorSchema = {
  title: 'first_contact.RgbDepthSample',
  type: 'object',
  additionalProperties: false,
  required: ['elapsedS', 'robotId', 'rgbPngBase64', 'depthF32LEBase64', 'position', 'rotation'],
  properties: {
    elapsedS: { type: 'number', minimum: 0 },
    robotId: { enum: ['rover-1', 'rover-2'] },
    rgbPngBase64: { type: 'string', contentEncoding: 'base64' },
    depthF32LEBase64: { type: 'string', contentEncoding: 'base64' },
    position: vector(3),
    rotation: vector(9),
  },
};

/** One common simulation clock. Manifest includes the full frozen heightfield and MJCF. */
export async function encodeEpisodeMcap(episode: PhysicsEpisode): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0n;
  const writer = new McapWriter({
    writable: {
      position: () => size,
      write: async (bytes: Uint8Array) => {
        chunks.push(bytes.slice());
        size += BigInt(bytes.length);
      },
    },
    useChunks: true,
    useMessageIndex: true,
    useChunkIndex: true,
    useStatistics: true,
    compressChunk: (data) => ({ compression: 'zstd', compressedData: zstdCompressSync(data) }),
  });
  await writer.start({ profile: '', library: 'first-contact-physics-pilot/1.0.0' });
  const register = async (topic: string, schema: object) => {
    const schemaId = await writer.registerSchema({
      name: (schema as { title: string }).title,
      encoding: 'jsonschema',
      data: json(schema),
    });
    return writer.registerChannel({
      topic,
      schemaId,
      messageEncoding: 'json',
      metadata: new Map([
        ['episode_id', episode.id],
        ['data_class', 'synthetic-contact-physics-experimental'],
      ]),
    });
  };
  const manifest = await register('/episode/manifest', {
    title: 'first_contact.PhysicsEpisodeManifest',
    type: 'object',
    required: [
      'id',
      'input',
      'engine',
      'modelXml',
      'terrainSha256',
      'modelSha256',
      'camera',
      'robotModels',
      'limitations',
    ],
    properties: {
      id: { type: 'string' },
      modelXml: { type: 'string' },
      terrainSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      modelSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    },
  });
  const stateChannels = new Map<string, number>(),
    sensorChannels = new Map<string, number>();
  for (const robot of episode.robotModels) {
    stateChannels.set(robot.id, await register(`/robots/${robot.id}/state_action`, stateSchema));
    sensorChannels.set(robot.id, await register(`/robots/${robot.id}/camera/rgb_depth`, sensorSchema));
  }
  const start = BigInt(Date.parse(episode.startedAt)) * 1_000_000n;
  const sequences = new Map<number, number>();
  const add = (channelId: number, elapsedS: number, data: object) => {
    const sequence = sequences.get(channelId) ?? 0;
    sequences.set(channelId, sequence + 1);
    return writer.addMessage({
      channelId,
      sequence,
      logTime: start + BigInt(Math.round(elapsedS * 1e9)),
      publishTime: start + BigInt(Math.round(elapsedS * 1e9)),
      data: json(data),
    });
  };
  const { frames, sensors, ...metadata } = episode;
  await add(manifest, 0, {
    ...metadata,
    stateRateHz: 10,
    actionUnits: 'wheel velocity targets, rad/s',
    actionTiming:
      'Targets active from this sample until the next controller update; controller updates every 5 ms. State/action channels sample at 10 Hz.',
    sensorSamples: sensors.length,
  });
  const events = [
    ...frames.flatMap((f) =>
      f.robots.map((r) => ({
        t: f.elapsedS,
        channel: stateChannels.get(r.id)!,
        data: { ...r, elapsedS: f.elapsedS },
      })),
    ),
    ...sensors.map((s) => ({ t: s.elapsedS, channel: sensorChannels.get(s.robotId)!, data: s })),
  ].sort((a, b) => a.t - b.t);
  for (const event of events) await add(event.channel, event.t, event.data);
  await writer.end();
  const bytes = new Uint8Array(Number(size));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
