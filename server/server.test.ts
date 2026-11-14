import { describe, expect, it } from 'vitest';
import { createMissionManifest } from '../src/domain/mission.ts';
import { createApiHandler } from './app.ts';
import { createGeminiPlanner } from './gemini.ts';
import { AtlasStore } from './atlas.ts';
import type { MissionStore, RunRecord } from './atlas.ts';
import { ApiError } from './errors.ts';
import { readConfig } from './config.ts';

const mission = () =>
  createMissionManifest({
    mode: 'dingo-gap',
    rover: { x: 0, y: 0, z: 0 },
    goal: { x: 5, y: 0, z: 0 },
    createdAt: '2026-11-14T12:00:00.000Z',
    missionName: 'Service contract test',
  });
const plan = {
  schemaVersion: '1.0.0',
  rationale: 'A bounded kinematic rehearsal.',
  steps: [
    { action: 'drive_to', target: { x: 5, y: 0, z: 0 }, speedMps: 0.5 },
    { action: 'observe', label: 'Inspect the goal' },
    { action: 'stop' },
  ],
};
const origin = 'http://localhost:5173';
function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://127.0.0.1:8787${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      host: '127.0.0.1:8787',
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function unconfiguredApi() {
  const config = readConfig({});
  return createApiHandler({ config, store: new AtlasStore(config), planner: createGeminiPlanner(config) });
}
function providerResponse(output: unknown, status = 'completed', model: unknown = 'gemini-3.8-flash') {
  return Response.json({
    id: 'provider-test-id',
    object: 'interaction',
    model,
    status,
    created: '2026-11-14T12:00:00Z',
    updated: '2026-11-14T12:00:01Z',
    steps: [
      { type: 'thought', summary: [{ type: 'text', text: 'Not the plan payload' }] },
      { type: 'model_output', content: [{ type: 'text', text: JSON.stringify(output) }] },
    ],
    usage: { total_input_tokens: 100, total_output_tokens: 80, total_tokens: 180 },
  });
}

describe('local orchestration boundary', () => {
  it('reports absent Atlas and Gemini configuration without pretending to be connected', async () => {
    const response = await unconfiguredApi()(request('/api/status'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.atlas).toEqual({ configured: false, connected: false });
    expect(body.planner).toMatchObject({ configured: false, provider: 'gemini' });
    expect(JSON.stringify(body)).not.toMatch(/mongodb\+srv:|apiKey|accessToken/);
  });

  it('actively checks Atlas on every status refresh, including when previously healthy', async () => {
    const config = readConfig({});
    const store = new AtlasStore(config);
    let checks = 0;
    store.checkHealth = async () => {
      checks += 1;
      return { configured: true, connected: checks === 1 };
    };
    const api = createApiHandler({ config, store, planner: createGeminiPlanner(config) });
    expect((await (await api(request('/api/status'))).json()).atlas.connected).toBe(true);
    const unavailable = await api(request('/api/status'));
    expect(unavailable.status).toBe(200);
    expect((await unavailable.json()).atlas.connected).toBe(false);
    expect(checks).toBe(2);
  });

  it('returns a specific unavailable state instead of fabricating an AI plan', async () => {
    const response = await unconfiguredApi()(
      request('/api/plans', { mission: mission(), objective: 'Inspect the goal' }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'PLANNER_NOT_CONFIGURED' } });
  });

  it('requires Atlas for saving instead of silently falling back to volatile storage', async () => {
    const response = await unconfiguredApi()(request('/api/missions', { mission: mission() }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'ATLAS_NOT_CONFIGURED' } });
  });

  describe.each(['amboy-crater', 'apollo-17'] as const)('%s mission requests', (mode) => {
    it.each([
      ['/api/missions', {}, 'ATLAS_NOT_CONFIGURED'],
      ['/api/plans', { objective: 'Inspect the goal' }, 'PLANNER_NOT_CONFIGURED'],
      ['/api/runs', { plan, planner: { kind: 'baseline' } }, 'ATLAS_NOT_CONFIGURED'],
    ] as const)('accepts JSON provenance before the %s service gate', async (path, input, code) => {
      const measuredMission = createMissionManifest({
        mode,
        rover: { x: 0, y: 0, z: 0 },
        goal: { x: 5, y: 0, z: 0 },
      });
      const response = await unconfiguredApi()(request(path, { mission: measuredMission, ...input }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code } });
    });
  });

  it('rejects an untrusted web origin before handling a mission', async () => {
    const response = await unconfiguredApi()(
      request('/api/missions', { mission: mission() }, { origin: 'https://untrusted.example' }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects non-local Host headers even if the Origin is allowed', async () => {
    const response = await unconfiguredApi()(
      request('/api/status', undefined, { host: 'untrusted.example:8787' }),
    );
    expect(response.status).toBe(403);
  });

  it('requires JSON for mutating requests and rejects unknown fields', async () => {
    const api = unconfiguredApi();
    expect(
      (await api(request('/api/missions', { mission: mission() }, { 'content-type': 'text/plain' }))).status,
    ).toBe(415);
    expect(
      (await api(request('/api/missions', { mission: mission(), token: 'not-an-accepted-field' }))).status,
    ).toBe(422);
  });

  it('rejects oversized request streams before parsing their content', async () => {
    const response = await unconfiguredApi()(
      request('/api/plans', { mission: mission(), objective: 'x'.repeat(256 * 1024) }),
    );
    expect(response.status).toBe(413);
  });

  it('validates mission provenance before reporting provider availability', async () => {
    const tampered = { ...mission(), body: 'moon' };
    const response = await unconfiguredApi()(
      request('/api/plans', { mission: tampered, objective: 'Inspect the goal' }),
    );
    expect(response.status).toBe(422);
  });

  it('requires Atlas before executing or saving a run', async () => {
    const response = await unconfiguredApi()(
      request('/api/runs', { mission: mission(), plan, planner: { kind: 'baseline' } }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'ATLAS_NOT_CONFIGURED' } });
  });

  it('executes the shared runner, writes real MCAP, and reuses the saved run on an idempotent retry', async () => {
    const records = new Map<string, { hash: string; value: RunRecord }>();
    let artifactBytes: Uint8Array = new Uint8Array();
    const store: MissionStore = {
      status: () => ({ configured: true, connected: true }),
      checkHealth: async () => ({ configured: true, connected: true }),
      connect: async () => {},
      close: async () => {},
      saveMission: async () => {
        throw new Error('Not used in this run fixture');
      },
      findRun: async (id, hash) => {
        const stored = records.get(id);
        if (stored && hash !== undefined && hash !== stored.hash)
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Different request.');
        return stored?.value ?? null;
      },
      saveRun: async (run, bytes, hash) => {
        artifactBytes = bytes;
        const value: RunRecord = {
          id: run.runId,
          run,
          missionId: 'mission-id',
          planId: 'plan-id',
          storage: 'atlas',
          artifact: {
            id: '0123456789abcdef01234567',
            sha256: 'fixture-artifact-hash',
            bytes: bytes.byteLength,
            storage: 'gridfs',
          },
          downloadUrl: `/api/runs/${run.runId}/mcap`,
        };
        records.set(run.runId, { hash, value });
        return value;
      },
      listRuns: async () => [],
      downloadRun: async () => {
        throw new Error('Not used in this fixture');
      },
    };
    const config = readConfig({});
    const api = createApiHandler({ config, store, planner: createGeminiPlanner(config) });
    const body = { mission: mission(), plan, planner: { kind: 'baseline' }, seed: 42 };
    const headers = { 'idempotency-key': '6fa459ea-ee8a-4ca4-894e-db77e160355e' };
    const first = await api(request('/api/runs', body, headers));
    expect(first.status).toBe(201);
    const saved = await first.json();
    expect(saved.run.runId).toBe('6fa459ea-ee8a-4ca4-894e-db77e160355e');
    expect(saved.run.durationS).toBe(10);
    expect(saved.run.frames.at(-1).position).toEqual({ x: 5, y: 0, z: 0 });
    expect(saved.run.engine.physicsValidated).toBe(false);
    expect(Array.from(artifactBytes.subarray(0, 8))).toEqual([137, 77, 67, 65, 80, 48, 13, 10]);
    const second = await api(request('/api/runs', body, headers));
    expect(second.status).toBe(200);
    expect((await second.json()).run.startedAt).toBe(saved.run.startedAt);
    expect((await api(request('/api/runs', { ...body, seed: 43 }, headers))).status).toBe(409);
  });
});

describe('Gemini structured planning adapter', () => {
  it('uses the verified REST format, keeps the key in its header, and validates the returned plan', async () => {
    let outgoing: Request | undefined;
    const planner = createGeminiPlanner(readConfig({ GEMINI_API_KEY: 'test-server-only-key' }), {
      fetch: async (input, init) => {
        outgoing = new Request(input, init);
        return providerResponse(plan);
      },
    });
    const result = await planner.generate(mission(), 'Inspect the goal', new AbortController().signal);
    expect(result.plan).toEqual(plan);
    expect(result.planner).toMatchObject({ kind: 'gemini', model: 'gemini-3.8-flash' });
    expect(outgoing?.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(outgoing?.headers.get('x-goog-api-key')).toBe('test-server-only-key');
    const payload = await outgoing!.json();
    expect(payload.store).toBe(false);
    expect(payload.response_format).toMatchObject({ type: 'text', mime_type: 'application/json' });
    // Gemini rejects counted arrays of command unions before generating a response.
    expect(payload.response_format.schema.properties.steps.maxItems).toBeUndefined();
    expect(payload.response_format.schema.properties.steps.items.anyOf).toHaveLength(4);
    expect(payload.tools).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('test-server-only-key');
    expect(JSON.stringify(result)).not.toContain('test-server-only-key');
  });

  it('records the returned model identifier when Gemini resolves a requested alias', async () => {
    const planner = createGeminiPlanner(
      readConfig({ GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-flash-latest' }),
      { fetch: async () => providerResponse(plan) },
    );
    const result = await planner.generate(mission(), 'Inspect the goal', new AbortController().signal);
    expect(result.planner.model).toBe('gemini-3.8-flash');
  });

  it('retains the configured model when the provider omits its model identifier', async () => {
    const planner = createGeminiPlanner(readConfig({ GEMINI_API_KEY: 'test-key' }), {
      fetch: async () => {
        const envelope = await providerResponse(plan).json();
        delete envelope.model;
        return Response.json(envelope);
      },
    });
    const result = await planner.generate(mission(), 'Inspect the goal', new AbortController().signal);
    expect(result.planner.model).toBe('gemini-3.8-flash');
  });

  it('rejects malformed provider model identifiers without copying their contents into provenance', async () => {
    const planner = createGeminiPlanner(readConfig({ GEMINI_API_KEY: 'test-key' }), {
      fetch: async () => providerResponse(plan, 'completed', 'https://private-model-host.example/'),
    });
    await expect(planner.generate(mission(), 'Inspect', new AbortController().signal)).rejects.toMatchObject({
      status: 502,
      code: 'PLANNER_INVALID_RESPONSE',
    });
  });

  it('redacts upstream authentication failures', async () => {
    const planner = createGeminiPlanner(readConfig({ GEMINI_API_KEY: 'private-test-value' }), {
      fetch: async () => new Response('private-test-value upstream diagnostics', { status: 401 }),
    });
    await expect(planner.generate(mission(), 'Inspect', new AbortController().signal)).rejects.toMatchObject({
      status: 502,
      code: 'PLANNER_AUTH_REJECTED',
    });
    try {
      await planner.generate(mission(), 'Inspect', new AbortController().signal);
    } catch (error) {
      expect(String(error)).not.toContain('private-test-value');
    }
  });

  it('refuses partial provider output instead of attempting to run it', async () => {
    const planner = createGeminiPlanner(readConfig({ GEMINI_API_KEY: 'test-key' }), {
      fetch: async () => providerResponse(plan, 'incomplete'),
    });
    await expect(planner.generate(mission(), 'Inspect', new AbortController().signal)).rejects.toMatchObject({
      code: 'PLANNER_INVALID_RESPONSE',
    });
  });

  it('rejects unsafe numerical values even when the provider returns JSON', async () => {
    const planner = createGeminiPlanner(readConfig({ GEMINI_API_KEY: 'test-key' }), {
      fetch: async () =>
        providerResponse({
          ...plan,
          steps: [{ action: 'drive_to', target: { x: 5, y: 0, z: 0 }, speedMps: 20 }],
        }),
    });
    await expect(planner.generate(mission(), 'Inspect', new AbortController().signal)).rejects.toMatchObject({
      code: 'PLANNER_INVALID_PLAN',
    });
  });

  it.each([
    {
      name: 'too many commands',
      candidate: { ...plan, steps: Array.from({ length: 33 }, () => ({ action: 'stop' })) },
    },
    { name: 'an empty plan', candidate: { ...plan, steps: [] } },
    {
      name: 'a long observation label',
      candidate: { ...plan, steps: [{ action: 'observe', label: 'x'.repeat(161) }] },
    },
    { name: 'an excessive wait', candidate: { ...plan, steps: [{ action: 'wait', durationS: 1801 }] } },
    { name: 'a long rationale', candidate: { ...plan, rationale: 'x'.repeat(2001) } },
  ])('enforces local bounds for $name after provider schema simplification', async ({ candidate }) => {
    const planner = createGeminiPlanner(readConfig({ GEMINI_API_KEY: 'test-key' }), {
      fetch: async () => providerResponse(candidate),
    });
    await expect(planner.generate(mission(), 'Inspect', new AbortController().signal)).rejects.toMatchObject({
      code: 'PLANNER_INVALID_PLAN',
    });
  });

  it('enforces its deadline on an upstream request that never completes', async () => {
    const planner = createGeminiPlanner(readConfig({ GEMINI_API_KEY: 'test-key' }), {
      timeoutMs: 20,
      fetch: async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        }),
    });
    await expect(planner.generate(mission(), 'Inspect', new AbortController().signal)).rejects.toMatchObject({
      status: 504,
      code: 'PLANNER_TIMEOUT',
    });
  });

  it('bounds the upstream response even when content-length is absent', async () => {
    const planner = createGeminiPlanner(readConfig({ GEMINI_API_KEY: 'test-key' }), {
      maxResponseBytes: 1024,
      fetch: async () => new Response('x'.repeat(1025)),
    });
    await expect(planner.generate(mission(), 'Inspect', new AbortController().signal)).rejects.toMatchObject({
      code: 'PLANNER_RESPONSE_TOO_LARGE',
    });
  });
});
