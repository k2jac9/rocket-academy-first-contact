import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GridFSBucket, ObjectId } from 'mongodb';
import type { Document } from 'mongodb';
import type { EpisodeMetadata, EpisodeRecord } from '../src/simulation/episode.ts';
import { bytesHash } from './hash.ts';
import { ApiError } from './errors.ts';
import { AtlasRepository } from './atlasConnection.ts';

type Stored = Document & {
  _id: string;
  requestHash: string;
  state: 'persisting' | 'complete';
  episode?: EpisodeMetadata;
  artifact?: { id: string; sha256: string; bytes: number };
};
function record(doc: Stored): EpisodeRecord {
  if (!doc.episode || !doc.artifact)
    throw new ApiError(409, 'EPISODE_INCOMPLETE', 'The episode save is incomplete.');
  return {
    id: doc._id,
    episode: doc.episode,
    artifact: doc.artifact,
    downloadUrl: `/api/episodes/${doc._id}/mcap`,
  };
}
export class EpisodeStore extends AtlasRepository {
  async find(id: string, hash?: string): Promise<EpisodeRecord | null> {
    return this.operation(async () => {
      const doc = await (await this.database()).collection<Stored>('physics_episodes').findOne({ _id: id });
      if (!doc) return null;
      if (hash && hash !== doc.requestHash)
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This episode ID belongs to a different scenario.');
      if (doc.state !== 'complete')
        throw new ApiError(
          409,
          'EPISODE_INCOMPLETE',
          'This episode save was interrupted or is still in progress.',
        );
      return record(doc);
    });
  }
  async list() {
    return this.operation(async () => {
      const docs = await (
        await this.database()
      )
        .collection<Stored>('physics_episodes')
        .find(
          { state: 'complete' },
          {
            projection: {
              _id: 1,
              'episode.startedAt': 1,
              'episode.durationS': 1,
              'episode.termination': 1,
              'episode.input.terrain.source.label': 1,
              'episode.input.terrain.source.body': 1,
              artifact: 1,
            },
          },
        )
        .sort({ 'episode.startedAt': -1 })
        .limit(20)
        .toArray();
      return docs.map((d) => ({
        id: d._id,
        startedAt: d.episode!.startedAt,
        durationS: d.episode!.durationS,
        termination: d.episode!.termination,
        site: d.episode!.input?.terrain?.source?.label ?? 'Legacy site',
        body: d.episode!.input?.terrain?.source?.body ?? null,
        downloadUrl: `/api/episodes/${d._id}/mcap`,
      }));
    });
  }
  async save(episode: EpisodeMetadata, bytes: Uint8Array, requestHash: string) {
    return this.operation(async () => {
      if (bytes.length > 16 * 1024 * 1024 || Buffer.byteLength(JSON.stringify(episode)) > 4 * 1024 * 1024)
        throw new ApiError(413, 'EPISODE_TOO_LARGE', 'This pilot episode exceeds its storage limit.');
      const db = await this.database(),
        collection = db.collection<Stored>('physics_episodes');
      const existing = await this.find(episode.id, requestHash);
      if (existing) return existing;
      await collection.insertOne({ _id: episode.id, requestHash, state: 'persisting' });
      const bucket = new GridFSBucket(db, { bucketName: 'episode_artifacts' });
      const artifactId = new ObjectId();
      const artifact = { id: artifactId.toHexString(), sha256: bytesHash(bytes), bytes: bytes.length };
      const upload = bucket.openUploadStreamWithId(artifactId, `${episode.id}.mcap`, {
        metadata: { episodeId: episode.id, sha256: artifact.sha256 },
      });
      let uploaded = false;
      try {
        await pipeline(Readable.from([bytes]), upload, { signal: AbortSignal.timeout(30_000) });
        uploaded = true;
        await collection.updateOne(
          { _id: episode.id, state: 'persisting' },
          { $set: { state: 'complete', episode, artifact } },
        );
        return record({ _id: episode.id, requestHash, state: 'complete', episode, artifact });
      } catch (error) {
        // An acknowledgement can be lost after a successful write. Preserve such a recording.
        const check = await collection.findOne({ _id: episode.id }).catch(() => undefined);
        if (check?.state === 'complete') return record(check);
        if (check !== undefined) {
          if (uploaded) await bucket.delete(artifactId).catch(() => undefined);
          else await upload.abort().catch(() => undefined);
          await collection.deleteOne({ _id: episode.id, state: 'persisting' }).catch(() => undefined);
        }
        throw error;
      }
    });
  }
  async download(id: string) {
    return this.operation(async () => {
      const found = await this.find(id);
      if (!found) throw new ApiError(404, 'EPISODE_NOT_FOUND', 'Episode not found.');
      const doc = await (await this.database()).collection<Stored>('physics_episodes').findOne({ _id: id });
      const bucket = new GridFSBucket(await this.database(), { bucketName: 'episode_artifacts' });
      const artifactId = new ObjectId(doc!.artifact!.id);
      const file = await bucket.find({ _id: artifactId }).next();
      if (!file || file.length !== found.artifact.bytes)
        throw new ApiError(409, 'ARTIFACT_UNAVAILABLE', 'Episode recording is unavailable.');
      return {
        stream: Readable.toWeb(bucket.openDownloadStream(artifactId)) as ReadableStream<Uint8Array>,
        artifact: found.artifact,
      };
    });
  }
}
