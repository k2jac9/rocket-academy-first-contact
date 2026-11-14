import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEpisodeRequest } from '../src/simulation/episode.ts';
import type { EpisodeJob, PhysicsEpisode } from '../src/simulation/episode.ts';
import type { EpisodeStore } from './episodeStore.ts';
import type { EpisodeQuery } from './episodeQuery.ts';
import type { EpisodeFilters } from '../src/simulation/episodeQuery.ts';
import { encodeEpisodeMcap } from './episodeRecording.ts';
import { ApiError } from './errors.ts';
import { bytesHash, canonicalJson, jsonHash } from './hash.ts';
import type { ScenarioLineage } from '../src/scenarios/contracts.ts';
import { validateHeightfield, captureHeightfieldPatch } from '../src/terrain/surfaceHeightfield.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
export class EpisodeService {
  private readonly store: EpisodeStore;
  private readonly jobs = new Map<string, { hash: string; job: EpisodeJob }>();
  private creating = false;
  constructor(store: EpisodeStore) {
    this.store = store;
  }
  stats(signal?: AbortSignal, filters: EpisodeFilters = {}) {
    return this.store.stats(signal, filters);
  }
  async create(id: string, value: unknown, lineage?: ScenarioLineage): Promise<EpisodeJob> {
    let input;
    try {
      input = validateEpisodeRequest(value);
      if (input.terrain.source.geometryKind === 'heightfield') {
        const source = input.terrain.source;
        const bytes = await readFile(resolve(root, 'public', 'terrain', source.id, 'heightfield.json'));
        if (`sha256:${bytesHash(bytes)}` !== source.sourceRevision)
          throw new Error('Installed terrain checksum mismatch.');
        const data = validateHeightfield(JSON.parse(bytes.toString('utf8')), source);
        const expected = captureHeightfieldPatch(
          data,
          source,
          input.terrain.originInSource,
          input.terrain.capturedAt,
        );
        if (input.terrain.heights.some((h, i) => Math.abs(h - expected.heights[i]) > 1e-6))
          throw new Error(
            'Captured elevations do not match the pinned source package. Capture the terrain again.',
          );
      }
    } catch (error) {
      throw new ApiError(
        422,
        'INVALID_SCENARIO',
        error instanceof Error ? error.message : 'Invalid episode.',
      );
    }
    const hash = jsonHash(lineage ? { input, lineage } : input),
      pending = this.jobs.get(id);
    if (pending) {
      if (pending.hash !== hash)
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This episode ID belongs to a different scenario.');
      if (pending.job.state !== 'failed') return pending.job;
      this.jobs.delete(id);
    }
    if (this.creating || [...this.jobs.values()].some((v) => v.job.state === 'running'))
      throw new ApiError(429, 'EPISODE_BUSY', 'One local physics episode is already running.', true);
    this.creating = true;
    try {
      const found = await this.store.find(id, hash);
      if (found) return { id, state: 'complete', message: 'Loaded saved episode.', record: found };
      const python =
        process.env.FIRST_CONTACT_SIM_PYTHON ||
        resolve(root, process.platform === 'win32' ? '.venv-sim/Scripts/python.exe' : '.venv-sim/bin/python');
      try {
        await stat(python);
      } catch {
        throw new ApiError(
          503,
          'PHYSICS_NOT_INSTALLED',
          'Install the local simulation environment using simulation/README.md.',
        );
      }
      const directory = resolve(root, '.episodes', id);
      await mkdir(directory, { recursive: true });
      const inputPath = resolve(directory, 'input.json'),
        outputPath = resolve(directory, 'output.json');
      const request = {
        id,
        startedAt: new Date().toISOString(),
        input,
        terrainSha256: jsonHash(input.terrain),
        terrainCanonicalJson: canonicalJson(input.terrain),
        ...(lineage ? { lineage } : {}),
      };
      await writeFile(inputPath, JSON.stringify(request), 'utf8');
      const job: EpisodeJob = {
        id,
        state: 'running',
        message: 'Simulating two robots and rendering RGB/depth. This may take a minute.',
      };
      // Retain bounded job metadata; complete episodes are durable in Atlas.
      if (this.jobs.size >= 20) this.jobs.delete(this.jobs.keys().next().value!);
      this.jobs.set(id, { hash, job });
      void this.execute(python, inputPath, outputPath, hash, job, lineage);
      return job;
    } finally {
      this.creating = false;
    }
  }
  private async execute(
    python: string,
    input: string,
    output: string,
    hash: string,
    job: EpisodeJob,
    lineage?: ScenarioLineage,
  ) {
    let stage = 'simulation';
    try {
      await new Promise<void>((resolveJob, reject) => {
        const child = spawn(python, [resolve(root, 'simulation/worker.py'), input, output], {
          cwd: root,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          // The physics worker never receives Atlas, Gemini, or other inherited application secrets.
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
            PYTHONUTF8: '1',
          },
        });
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('Physics worker exceeded its three-minute limit.'));
        }, 180_000);
        let errorText = '';
        child.stderr.on('data', (chunk: Buffer) => {
          if (errorText.length < 12000) errorText += chunk.toString();
        });
        child.once('error', () => {
          clearTimeout(timer);
          reject(new Error('Could not start the physics worker.'));
        });
        child.once('close', (code) => {
          clearTimeout(timer);
          if (code === 0) resolveJob();
          else {
            void writeFile(resolve(root, '.episodes', job.id, 'worker-error.log'), errorText, 'utf8');
            reject(new Error('The physics worker failed. See its local worker-error.log for details.'));
          }
        });
      });
      if ((await stat(output)).size > 14 * 1024 * 1024)
        throw new Error('Episode output exceeded its size limit.');
      const episode = JSON.parse(await readFile(output, 'utf8')) as PhysicsEpisode;
      if (episode.id !== job.id || !episode.frames?.length || !episode.sensors?.length)
        throw new Error('The physics worker returned an incomplete episode.');
      if (lineage) {
        episode.lineage = lineage;
        // Retain lineage in the recoverable local output as well as MCAP and Atlas.
        await writeFile(output, JSON.stringify(episode), 'utf8');
      }
      job.message = 'Recording and saving the complete episode to Atlas…';
      stage = 'storage';
      const bytes = await encodeEpisodeMcap(episode);
      await writeFile(resolve(root, '.episodes', job.id, 'episode.mcap'), bytes);
      const { sensors, ...metadata } = episode;
      const cameraPreviews = episode.robotModels.map((robot) => {
        const sample = [...sensors].reverse().find((s) => s.robotId === robot.id)!;
        return { robotId: robot.id, elapsedS: sample.elapsedS, rgbPngBase64: sample.rgbPngBase64 };
      });
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          job.record = await this.store.save(
            { ...metadata, sensorSamples: sensors.length, cameraPreviews },
            bytes,
            hash,
          );
          break;
        } catch (error) {
          if ((error instanceof ApiError && !error.retryable) || attempt === 2) throw error;
          // Give the shared connection's recovery backoff time to expire.
          await new Promise((resolve) => setTimeout(resolve, 5_000));
        }
      }
      job.state = 'complete';
      job.message = 'Episode saved in Atlas. Replay or download the recording.';
    } catch (error) {
      job.state = 'failed';
      job.message =
        stage === 'storage'
          ? 'The episode was generated, but Atlas could not finish saving it. The local result is retained; retry when Atlas is available.'
          : error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'The physics worker failed.';
    }
  }
  async get(id: string): Promise<EpisodeJob> {
    const pending = this.jobs.get(id);
    if (pending) return pending.job;
    const record = await this.store.find(id);
    if (!record) throw new ApiError(404, 'EPISODE_NOT_FOUND', 'Episode not found.');
    return { id, state: 'complete', message: 'Saved episode loaded.', record };
  }
  list(query?: EpisodeQuery, signal?: AbortSignal) {
    return this.store.list(query, signal);
  }
  async download(id: string) {
    const record = await this.store.find(id);
    if (!record) throw new ApiError(404, 'EPISODE_NOT_FOUND', 'Episode not found.');
    const path = resolve(root, '.episodes', id, 'episode.mcap');
    // A verified local cache keeps replay downloads fast on a slow Atlas link.
    try {
      if ((await stat(path)).size === record.artifact.bytes && record.artifact.bytes <= 16 * 1024 * 1024) {
        const bytes = await readFile(path);
        if (bytesHash(bytes) === record.artifact.sha256)
          return {
            stream: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,
            artifact: record.artifact,
          };
      }
    } catch {
      /* Cache is optional. The durable GridFS artifact remains authoritative. */
    }
    return this.store.download(id);
  }
}
