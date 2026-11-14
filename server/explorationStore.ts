import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GridFSBucket } from 'mongodb';
import type { Document, GridFSFile } from 'mongodb';
import type { ExplorationArtifact, ExplorationRecord, ScenarioRecord } from '../src/scenarios/contracts.ts';
import { ApiError } from './errors.ts';
import { AtlasRepository } from './atlasConnection.ts';
import { bytesHash, jsonHash } from './hash.ts';
import { compileScenario, explorationRecord, validateExploration, validateScenario } from './scenarios.ts';

export const MAX_EXPLORATION_ARTIFACT_BYTES = 32 * 1024 * 1024;
export const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
export function validateArtifact(bytes: Uint8Array, mediaType: string): ExplorationArtifact['mediaType'] {
  if (!bytes.length || bytes.length > MAX_EXPLORATION_ARTIFACT_BYTES)
    throw new ApiError(413, 'ARTIFACT_SIZE', 'Choose a nonempty file up to 32 MiB.');
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const valid =
    mediaType === 'image/png'
      ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mediaType === 'image/jpeg'
        ? b[0] === 255 && b[1] === 216 && b[2] === 255
        : mediaType === 'image/webp'
          ? b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
          : mediaType === 'video/mp4'
            ? b.toString('ascii', 4, 8) === 'ftyp'
            : mediaType === 'video/webm'
              ? b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
              : false;
  if (!valid)
    throw new ApiError(
      415,
      'ARTIFACT_TYPE',
      'Choose a PNG, JPEG, WebP, MP4 or WebM with a matching file signature.',
    );
  if (mediaType.startsWith('image/') && bytes.length > MAX_REFERENCE_IMAGE_BYTES)
    throw new ApiError(413, 'IMAGE_SIZE', 'Reference images must be at most 8 MiB.');
  return mediaType as ExplorationArtifact['mediaType'];
}
type Saved<T> = Document & { _id: string; requestHash: string; createdAt: string; record: T };
function artifact(file: GridFSFile): ExplorationArtifact {
  return {
    sha256: file.metadata!.sha256,
    bytes: file.length,
    mediaType: file.metadata!.mediaType,
    createdAt: file.uploadDate.toISOString(),
    downloadUrl: `/api/explorations/artifacts/${file.metadata!.sha256}`,
  };
}
export class ExplorationStore extends AtlasRepository {
  private async bucket() {
    return this.operation(async () => {
      return new GridFSBucket(await this.database(), { bucketName: 'exploration_artifacts' });
    });
  }
  async findArtifact(sha256: string): Promise<ExplorationArtifact> {
    return this.operation(async () => {
      const bucket = await this.bucket();
      const file = await bucket.find({ 'metadata.sha256': sha256, 'metadata.verified': true }).next();
      if (!file || file.length !== file.metadata!.bytes)
        throw new ApiError(
          404,
          'ARTIFACT_NOT_FOUND',
          'Upload the referenced artifact before saving this exploration.',
        );
      return artifact(file);
    });
  }
  async upload(bytes: Uint8Array, type: string): Promise<ExplorationArtifact> {
    return this.operation(async () => {
      const mediaType = validateArtifact(bytes, type),
        sha256 = bytesHash(bytes),
        bucket = await this.bucket();
      const found = await bucket.find({ 'metadata.sha256': sha256, 'metadata.verified': true }).next();
      if (found) {
        if (found.metadata!.mediaType !== mediaType || found.length !== bytes.length)
          throw new ApiError(
            409,
            'ARTIFACT_CONFLICT',
            'The stored artifact metadata does not match this upload.',
          );
        return artifact(found);
      }
      const upload = bucket.openUploadStream(sha256, {
        metadata: { sha256, bytes: bytes.length, mediaType, verified: true, purpose: 'exploration-review' },
      });
      try {
        await pipeline(Readable.from([bytes]), upload, { signal: AbortSignal.timeout(120_000) });
        return await this.findArtifact(sha256);
      } catch (error) {
        // A completed GridFS file can be recovered by hash after a lost acknowledgement.
        const complete = await bucket
          .find({ _id: upload.id })
          .next()
          .catch(() => null);
        if (complete) return artifact(complete);
        await upload.abort().catch(() => undefined);
        throw error;
      }
    });
  }
  async download(sha256: string, range?: string | null) {
    return this.operation(async () => {
      const bucket = await this.bucket(),
        file = await bucket.find({ 'metadata.sha256': sha256, 'metadata.verified': true }).next();
      if (!file || file.length !== file.metadata!.bytes)
        throw new ApiError(404, 'ARTIFACT_NOT_FOUND', 'Artifact is unavailable.');
      let start = 0,
        end = file.length - 1;
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) throw new ApiError(416, 'INVALID_RANGE', 'Use one explicit byte range.');
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), end) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.length)
          throw new ApiError(416, 'INVALID_RANGE', 'The byte range is outside this artifact.');
      }
      return {
        artifact: artifact(file),
        start,
        end,
        partial: Boolean(range),
        stream: Readable.toWeb(
          bucket.openDownloadStream(file._id, { start, end: end + 1 }),
        ) as ReadableStream<Uint8Array>,
      };
    });
  }
  private async save<T>(collectionName: string, id: string, input: unknown, record: T): Promise<T> {
    return this.operation(async () => {
      const collection = (await this.database()).collection<Saved<T>>(collectionName),
        requestHash = jsonHash(input);
      try {
        await collection.updateOne(
          { _id: id },
          { $setOnInsert: { requestHash, createdAt: new Date().toISOString(), record } },
          { upsert: true },
        );
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
      const found = await collection.findOne({ _id: id });
      if (!found)
        throw new ApiError(
          503,
          'PUBLICATION_INCOMPLETE',
          'Publication could not be confirmed; retry with the same request ID.',
          true,
        );
      if (found.requestHash !== requestHash)
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This request ID belongs to different content.');
      return found.record;
    });
  }
  async create(id: string, value: unknown): Promise<ExplorationRecord> {
    return this.operation(async () => {
      const input = validateExploration(value),
        artifacts: ExplorationArtifact[] = [];
      for (const [sha256, kind] of [
        [input.referenceImageSha256, 'image/'],
        [input.recordingSha256, 'video/'],
      ] as const) {
        if (!sha256) continue;
        const file = await this.findArtifact(sha256);
        if (!file.mediaType.startsWith(kind))
          throw new ApiError(
            422,
            'ARTIFACT_ROLE',
            'Use an image as the reference and a video as the exploration recording.',
          );
        artifacts.push(file);
      }
      return this.save('world_model_explorations', id, input, explorationRecord(id, input, artifacts));
    });
  }
  async get(id: string): Promise<ExplorationRecord> {
    return this.operation(async () => {
      const doc = await (
        await this.database()
      )
        .collection<Saved<ExplorationRecord>>('world_model_explorations')
        .findOne({ _id: id });
      if (!doc) throw new ApiError(404, 'EXPLORATION_NOT_FOUND', 'Exploration not found.');
      return doc.record;
    });
  }
  async list(): Promise<ExplorationRecord[]> {
    return this.operation(async () => {
      const docs = await (
        await this.database()
      )
        .collection<Saved<ExplorationRecord>>('world_model_explorations')
        .find({})
        .sort({ createdAt: -1, _id: -1 })
        .limit(20)
        .toArray();
      return docs.map((d) => d.record);
    });
  }
  async createScenario(id: string, value: unknown): Promise<ScenarioRecord> {
    return this.operation(async () => {
      const input = validateScenario(value),
        source = await this.get(input.explorationId);
      return this.save('scenario_versions', id, input, compileScenario(id, input, source));
    });
  }
  async getScenario(id: string): Promise<ScenarioRecord> {
    return this.operation(async () => {
      const doc = await (
        await this.database()
      )
        .collection<Saved<ScenarioRecord>>('scenario_versions')
        .findOne({ _id: id });
      if (!doc) throw new ApiError(404, 'SCENARIO_NOT_FOUND', 'Scenario version not found.');
      return doc.record;
    });
  }
  async listScenarios(): Promise<ScenarioRecord[]> {
    return this.operation(async () => {
      const docs = await (
        await this.database()
      )
        .collection<Saved<ScenarioRecord>>('scenario_versions')
        .find({})
        .sort({ createdAt: -1, _id: -1 })
        .limit(20)
        .toArray();
      return docs.map((d) => d.record);
    });
  }
}
