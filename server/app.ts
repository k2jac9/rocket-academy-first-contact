import { randomUUID } from 'node:crypto';
import { validateMissionManifest } from '../src/domain/mission.ts';
import type { CelestialBody, MissionManifest } from '../src/domain/mission.ts';
import { ROBOT_PROFILE, RUN_LIMITS, runMission, validatePlan } from '../src/simulation/missionRun.ts';
import type { MissionRun, PlannerProvenance } from '../src/simulation/missionRun.ts';
import type { MissionStore, RunRecord } from './atlas.ts';
import { MAX_MCAP_BYTES, MAX_RUN_JSON_BYTES } from './atlas.ts';
import { MAX_REQUEST_BYTES, readJsonRequest, readBoundedBody } from './body.ts';
import { ROBOT_CATALOG, SOURCE_CATALOG } from './catalog.ts';
import type { ServerConfig } from './config.ts';
import { ApiError, exactKeys, publicError } from './errors.ts';
import { MAX_OBJECTIVE_LENGTH } from './gemini.ts';
import type { GeminiPlanner } from './gemini.ts';
import { jsonHash } from './hash.ts';
import type { EpisodeService } from './episodes.ts';
import type { ExplorationStore } from './explorationStore.ts';
import { MAX_EXPLORATION_ARTIFACT_BYTES } from './explorationStore.ts';
import { SHA256, verifyScenarioExecution } from './scenarios.ts';
import { GENIE_ADAPTER } from '../src/scenarios/contracts.ts';
import { createElevenLabsSpeech } from './elevenlabs.ts';
import type { ElevenLabsSpeech } from './elevenlabs.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requestId(request: Request): string {
  const supplied = request.headers.get('idempotency-key');
  if (supplied === null) return randomUUID();
  if (!UUID.test(supplied))
    throw new ApiError(422, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be a UUID.');
  return supplied.toLowerCase();
}
function validatedMission(value: unknown): MissionManifest {
  const result = validateMissionManifest(value);
  if (!result.valid)
    throw new ApiError(
      422,
      'INVALID_MISSION',
      'The mission has invalid coordinates, source identity, or metadata. Recreate it from the current terrain view.',
    );
  return result.manifest;
}
function validatedPlanner(value: unknown): PlannerProvenance {
  exactKeys(value, ['kind'], ['model', 'prompt', 'generatedAt']);
  if (value.kind !== 'baseline' && value.kind !== 'gemini')
    throw new ApiError(422, 'INVALID_PLANNER', 'The planner must be baseline or gemini.');
  if (
    value.model !== undefined &&
    (typeof value.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value.model))
  )
    throw new ApiError(422, 'INVALID_PLANNER', 'The planner model identifier is invalid.');
  if (value.kind === 'gemini' && !value.model)
    throw new ApiError(422, 'INVALID_PLANNER', 'Gemini provenance requires its model identifier.');
  if (
    value.prompt !== undefined &&
    (typeof value.prompt !== 'string' || value.prompt.length > 4_000 || value.prompt.trim().length === 0)
  )
    throw new ApiError(422, 'INVALID_PLANNER', 'The planner objective is invalid.');
  if (
    value.generatedAt !== undefined &&
    (typeof value.generatedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.generatedAt)) ||
      new Date(value.generatedAt).toISOString() !== value.generatedAt)
  )
    throw new ApiError(422, 'INVALID_PLANNER', 'The planner timestamp must be canonical UTC ISO.');
  return {
    kind: value.kind,
    ...(value.model !== undefined ? { model: value.model as string } : {}),
    ...(value.prompt !== undefined ? { prompt: value.prompt as string } : {}),
    ...(value.generatedAt !== undefined ? { generatedAt: value.generatedAt as string } : {}),
  };
}

export function createApiHandler(dependencies: {
  config: ServerConfig;
  store: MissionStore;
  planner: GeminiPlanner;
  episodes?: EpisodeService;
  explorations?: ExplorationStore;
  speech?: ElevenLabsSpeech;
}) {
  const { config, store, planner } = dependencies;
  const speech = dependencies.speech ?? createElevenLabsSpeech(config);
  const pendingRuns = new Map<
    string,
    { hash: string; promise: Promise<{ record: RunRecord; status: number }> }
  >();
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    try {
      const host = request.headers.get('host');
      if (!host || !config.allowedHosts.includes(host.toLowerCase()))
        throw new ApiError(403, 'HOST_FORBIDDEN', 'This service accepts local API hosts only.');
      const origin = request.headers.get('origin');
      if (
        (origin !== null && !config.allowedOrigins.includes(origin)) ||
        (origin === null && request.headers.get('sec-fetch-site') === 'cross-site')
      ) {
        throw new ApiError(
          403,
          'ORIGIN_FORBIDDEN',
          'This web origin is not allowed to use the local service.',
        );
      }
      if (origin) {
        headers.set('access-control-allow-origin', origin);
        headers.set('vary', 'Origin');
      }
      if (request.method === 'OPTIONS') {
        const method = request.headers.get('access-control-request-method');
        const requestedHeaders =
          request.headers
            .get('access-control-request-headers')
            ?.split(',')
            .map((value) => value.trim().toLowerCase()) ?? [];
        if (
          !origin ||
          !method ||
          !['GET', 'POST'].includes(method) ||
          requestedHeaders.some((value) => !['content-type', 'idempotency-key'].includes(value))
        ) {
          throw new ApiError(403, 'PREFLIGHT_FORBIDDEN', 'This request is not allowed by the local service.');
        }
        headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
        headers.set('access-control-allow-headers', 'Content-Type, Idempotency-Key');
        headers.set('access-control-max-age', '600');
        return new Response(null, { status: 204, headers });
      }
      const url = new URL(request.url);
      if (url.pathname === '/api/speech/status' && request.method === 'GET') return json(speech.status());
      if (url.pathname === '/api/speech/voices' && request.method === 'GET')
        return json(await speech.voices(request.signal));
      if (url.pathname === '/api/speech' && request.method === 'POST') {
        const audio = await speech.generate(await readJsonRequest(request), request.signal);
        headers.set('content-type', 'audio/mpeg');
        headers.set('content-length', String(audio.bytes.length));
        headers.set('content-disposition', 'attachment; filename="first-contact-narration.mp3"');
        headers.set('x-audio-sha256', audio.sha256);
        headers.set('x-narration-model', audio.model);
        headers.set('x-narration-cache', audio.cached ? 'hit' : 'miss');
        return new Response(new Uint8Array(audio.bytes), { headers });
      }
      if (url.pathname === '/api/integrations/genie' && request.method === 'GET') return json(GENIE_ADAPTER);
      if (url.pathname === '/api/integrations/genie/execute' && request.method === 'POST')
        throw new ApiError(
          501,
          'GENIE_ACCESS_UNVERIFIED',
          'Automated Genie experiments require verified account access, an action/observation API, timing, reset and recording capabilities. Use the exploration/import workflow.',
        );
      if (url.pathname.startsWith('/api/explorations') || url.pathname.startsWith('/api/scenarios')) {
        const explorations = dependencies.explorations;
        if (!explorations)
          throw new ApiError(503, 'EXPLORATIONS_UNAVAILABLE', 'The exploration store is unavailable.');
        if (url.pathname === '/api/explorations/artifacts' && request.method === 'POST') {
          const encoding = request.headers.get('content-encoding');
          if (encoding && encoding !== 'identity')
            throw new ApiError(415, 'ENCODING_UNSUPPORTED', 'Compressed uploads are not supported.');
          const tooLarge = new ApiError(413, 'ARTIFACT_SIZE', 'Exploration files must be at most 32 MiB.');
          if (Number(request.headers.get('content-length') ?? 0) > MAX_EXPLORATION_ARTIFACT_BYTES)
            throw tooLarge;
          const bytes = await readBoundedBody(
            request.body,
            MAX_EXPLORATION_ARTIFACT_BYTES,
            AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
            tooLarge,
          );
          return json(
            await explorations.upload(bytes, request.headers.get('content-type')?.split(';')[0] ?? ''),
            201,
          );
        }
        const asset = /^\/api\/explorations\/artifacts\/([^/]+)$/.exec(url.pathname);
        if (asset && request.method === 'GET') {
          if (!SHA256.test(asset[1]))
            throw new ApiError(422, 'INVALID_ARTIFACT_ID', 'Artifact ID must be a SHA-256 hash.');
          const result = await explorations.download(asset[1], request.headers.get('range'));
          headers.set('content-type', result.artifact.mediaType);
          headers.set('content-length', String(result.end - result.start + 1));
          headers.set('accept-ranges', 'bytes');
          headers.set('x-artifact-sha256', result.artifact.sha256);
          if (result.partial)
            headers.set('content-range', `bytes ${result.start}-${result.end}/${result.artifact.bytes}`);
          return new Response(result.stream, { status: result.partial ? 206 : 200, headers });
        }
        if (url.pathname === '/api/explorations' && request.method === 'POST')
          return json(await explorations.create(requestId(request), await readJsonRequest(request)), 201);
        if (url.pathname === '/api/explorations' && request.method === 'GET')
          return json({ explorations: await explorations.list() });
        if (url.pathname === '/api/scenarios' && request.method === 'POST')
          return json(
            await explorations.createScenario(requestId(request), await readJsonRequest(request)),
            201,
          );
        if (url.pathname === '/api/scenarios' && request.method === 'GET')
          return json({ scenarios: await explorations.listScenarios() });
        const detail = /^\/api\/(explorations|scenarios)\/([^/]+)$/.exec(url.pathname);
        if (detail && request.method === 'GET') {
          if (!UUID.test(detail[2])) throw new ApiError(422, 'INVALID_ID', 'Record ID must be a UUID.');
          return json(
            await (detail[1] === 'explorations'
              ? explorations.get(detail[2].toLowerCase())
              : explorations.getScenario(detail[2].toLowerCase())),
          );
        }
        throw new ApiError(404, 'NOT_FOUND', 'Exploration route not found.');
      }
      if (url.pathname === '/api/episodes' || url.pathname.startsWith('/api/episodes/')) {
        const episodes = dependencies.episodes;
        if (!episodes)
          throw new ApiError(503, 'PHYSICS_UNAVAILABLE', 'The physics episode service is unavailable.');
        if (url.pathname === '/api/episodes/stats' && request.method === 'GET') {
          if (url.search)
            throw new ApiError(422, 'INVALID_QUERY', 'Episode statistics do not accept query parameters.');
          return json(await episodes.stats(request.signal));
        }
        if (url.pathname === '/api/episodes' && request.method === 'POST') {
          const value = await readJsonRequest(request);
          if (value && typeof value === 'object' && 'scenarioVersionId' in value) {
            const { scenarioVersionId, ...input } = value;
            if (typeof scenarioVersionId !== 'string' || !UUID.test(scenarioVersionId))
              throw new ApiError(422, 'INVALID_SCENARIO_ID', 'Scenario version ID must be a UUID.');
            if (!dependencies.explorations)
              throw new ApiError(503, 'EXPLORATIONS_UNAVAILABLE', 'The scenario store is unavailable.');
            const scenario = await dependencies.explorations.getScenario(scenarioVersionId.toLowerCase());
            return json(
              await episodes.create(requestId(request), input, verifyScenarioExecution(scenario, input)),
              202,
            );
          }
          return json(await episodes.create(requestId(request), value), 202);
        }
        if (url.pathname === '/api/episodes' && request.method === 'GET')
          return json({ episodes: await episodes.list() });
        const path = /^\/api\/episodes\/([^/]+)(\/mcap)?$/.exec(url.pathname);
        if (path && request.method === 'GET') {
          const id = path[1].toLowerCase();
          if (!UUID.test(id)) throw new ApiError(422, 'INVALID_EPISODE_ID', 'Episode ID must be a UUID.');
          if (!path[2]) return json(await episodes.get(id));
          const { stream, artifact } = await episodes.download(id);
          headers.set('content-type', 'application/octet-stream');
          headers.set('content-disposition', `attachment; filename="first-contact-physics-${id}.mcap"`);
          headers.set('content-length', String(artifact.bytes));
          headers.set('x-artifact-sha256', artifact.sha256);
          return new Response(stream, { headers });
        }
        throw new ApiError(404, 'NOT_FOUND', 'Episode route not found.');
      }
      if (request.method === 'GET' && url.pathname === '/api/status') {
        const atlas = await store.checkHealth();
        return json({
          service: 'first-contact-local',
          version: '0.2.0',
          atlas,
          planner: {
            configured: Boolean(config.geminiApiKey),
            provider: 'gemini',
            model: config.geminiModel,
          },
          limits: { ...RUN_LIMITS, maxRequestBytes: MAX_REQUEST_BYTES, maxMcapBytes: MAX_MCAP_BYTES },
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/catalog') {
        return json({
          sources: SOURCE_CATALOG,
          robots: ROBOT_CATALOG,
          catalogVersion: '1.0.0',
          atlas: store.status(),
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/runs') {
        if (
          [...url.searchParams.keys()].some((key) => !['body', 'limit'].includes(key)) ||
          url.searchParams.getAll('body').length > 1 ||
          url.searchParams.getAll('limit').length > 1
        ) {
          throw new ApiError(422, 'INVALID_QUERY', 'Only body and limit are supported when listing runs.');
        }
        const body = url.searchParams.get('body');
        if (body !== null && !['earth', 'moon', 'mars'].includes(body))
          throw new ApiError(422, 'INVALID_BODY', 'The body must be earth, moon, or mars.');
        const limitText = url.searchParams.get('limit') ?? '20';
        const limit = Number(limitText);
        if (!/^\d+$/.test(limitText) || !Number.isInteger(limit) || limit < 1 || limit > 50)
          throw new ApiError(422, 'INVALID_LIMIT', 'The run limit must be between 1 and 50.');
        return json({ runs: await store.listRuns((body as CelestialBody | null) ?? undefined, limit) });
      }
      const savedRunPath = /^\/api\/runs\/([^/]+)(\/mcap)?$/.exec(url.pathname);
      if (request.method === 'GET' && savedRunPath) {
        const id = savedRunPath[1].toLowerCase();
        if (!UUID.test(id))
          throw new ApiError(422, 'INVALID_RUN_ID', 'The saved run identifier must be a UUID.');
        if (savedRunPath[2]) {
          const { stream, artifact } = await store.downloadRun(id);
          headers.set('content-type', 'application/octet-stream');
          headers.set('content-disposition', `attachment; filename="first-contact-${id}.mcap"`);
          headers.set('content-length', String(artifact.bytes));
          headers.set('x-artifact-sha256', artifact.sha256);
          return new Response(stream, { headers });
        }
        const record = await store.findRun(id);
        if (!record) throw new ApiError(404, 'RUN_NOT_FOUND', 'This saved run was not found.');
        return json(record);
      }
      if (request.method === 'POST' && url.pathname === '/api/plans') {
        const input = await readJsonRequest(request);
        exactKeys(input, ['mission', 'objective']);
        const mission = validatedMission(input.mission);
        if (
          typeof input.objective !== 'string' ||
          !input.objective.trim() ||
          input.objective.length > MAX_OBJECTIVE_LENGTH
        )
          throw new ApiError(422, 'INVALID_OBJECTIVE', 'Provide an objective containing 1–2000 characters.');
        return json(await planner.generate(mission, input.objective, request.signal));
      }
      if (request.method === 'POST' && url.pathname === '/api/missions') {
        const input = await readJsonRequest(request);
        exactKeys(input, ['mission']);
        const mission = validatedMission(input.mission);
        return json(await store.saveMission(requestId(request), mission, jsonHash(mission)), 201);
      }
      if (request.method === 'POST' && url.pathname === '/api/runs') {
        const input = await readJsonRequest(request);
        exactKeys(input, ['mission', 'plan', 'planner'], ['seed']);
        const mission = validatedMission(input.mission);
        const validation = validatePlan(input.plan, mission);
        if (!validation.valid)
          throw new ApiError(
            422,
            'INVALID_PLAN',
            'The plan is outside the mission schema or execution limits.',
          );
        const provenance = validatedPlanner(input.planner);
        const seed = input.seed === undefined ? 1 : input.seed;
        if (typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
          throw new ApiError(422, 'INVALID_SEED', 'The seed must be an unsigned 32-bit integer.');
        const id = requestId(request);
        const hash = jsonHash({ mission, plan: validation.plan, planner: provenance, seed });
        const pending = pendingRuns.get(id);
        if (pending) {
          if (pending.hash !== hash)
            throw new ApiError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'This request identifier is already processing a different run.',
            );
          return json((await pending.promise).record);
        }
        if (pendingRuns.size >= 2)
          throw new ApiError(
            429,
            'RUN_SERVICE_BUSY',
            'Two runs are already being saved. Try again shortly.',
            true,
          );
        const operation = (async () => {
          await store.connect();
          const existing = await store.findRun(id, hash);
          if (existing) return { record: existing, status: 200 };
          request.signal.throwIfAborted();
          let run: MissionRun;
          try {
            run = runMission({
              mission,
              plan: validation.plan,
              planner: provenance,
              seed,
              runId: id,
              robotId: ROBOT_PROFILE.id,
              startedAt: new Date().toISOString(),
            });
          } catch {
            throw new ApiError(
              422,
              'RUN_REJECTED',
              'The mission could not run within the supported execution contract.',
            );
          }
          if (Buffer.byteLength(JSON.stringify(run)) > MAX_RUN_JSON_BYTES)
            throw new ApiError(
              413,
              'RUN_TOO_LARGE',
              'This run exceeds the metadata size limit. Shorten the plan.',
            );
          const { encodeRunMcap } = await import('../src/recording/mcap.ts');
          const bytes = await encodeRunMcap(run);
          request.signal.throwIfAborted();
          if (bytes.byteLength > MAX_MCAP_BYTES)
            throw new ApiError(
              413,
              'RUN_TOO_LARGE',
              'This run exceeds the 16 MiB recording limit. Shorten the plan.',
            );
          return { record: await store.saveRun(run, bytes, hash), status: 201 };
        })();
        pendingRuns.set(id, { hash, promise: operation });
        try {
          const result = await operation;
          return json(result.record, result.status);
        } finally {
          pendingRuns.delete(id);
        }
      }
      throw new ApiError(404, 'NOT_FOUND', 'The local API route was not found.');
    } catch (error) {
      const failure = request.signal.aborted
        ? new ApiError(499, 'REQUEST_CANCELLED', 'The request was cancelled.')
        : publicError(error);
      return json(
        { error: { code: failure.code, message: failure.message, retryable: failure.retryable } },
        failure.status,
      );
    }
  };
}
