import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoNetworkError, MongoServerError } from 'mongodb';
import { AtlasStore } from './atlas.ts';
import { readConfig } from './config.ts';
import { ApiError } from './errors.ts';
import { createApiHandler } from './app.ts';
import { createGeminiPlanner } from './gemini.ts';

const driver = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  command: vi.fn(),
  findOne: vi.fn(),
  createIndex: vi.fn(),
  toArray: vi.fn(),
  clients: [] as { emit: (name: string, value?: unknown) => void; options: Record<string, unknown> }[],
}));
vi.mock('mongodb', async (original) => {
  const mongodb = await original<typeof import('mongodb')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...mongodb,
    MongoClient: class extends EventEmitter {
      options: Record<string, unknown>;
      constructor(_uri: string, options: Record<string, unknown>) {
        super();
        this.options = options;
        driver.clients.push(this);
      }
      connect = driver.connect;
      close = driver.close;
      db() {
        return {
          command: driver.command,
          collection: () => ({
            createIndex: driver.createIndex,
            findOne: driver.findOne,
            find: () => ({ sort: () => ({ limit: () => ({ toArray: driver.toArray }) }) }),
            aggregate: () => ({ toArray: driver.toArray }),
          }),
        };
      }
    },
  };
});

const config = readConfig({ MONGODB_URI: 'mongodb://test.invalid' });
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  driver.clients.length = 0;
  driver.connect.mockResolvedValue(undefined);
  driver.close.mockResolvedValue(undefined);
  driver.command.mockResolvedValue({ ok: 1 });
  driver.findOne.mockResolvedValue(null);
  driver.createIndex.mockResolvedValue('index');
  driver.toArray.mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Atlas connection resilience', () => {
  it.each(['list', 'stats'] as const)('keeps Atlas healthy when the browser cancels %s', async (kind) => {
    const store = new AtlasStore(config);
    await store.connect();
    const controller = new AbortController();
    const cancelled = new DOMException('Browser left the page', 'AbortError');
    driver.toArray.mockImplementationOnce(async () => {
      controller.abort(cancelled);
      throw controller.signal.reason;
    });
    const operation =
      kind === 'list'
        ? store.episodes.list(undefined, controller.signal)
        : store.episodes.stats(controller.signal);
    await expect(operation).rejects.toBe(cancelled);
    expect(store.status().connected).toBe(true);
    await expect(store.episodes.list()).resolves.toEqual({ episodes: [], nextCursor: null });
    expect(driver.connect).toHaveBeenCalledOnce();
  });
  it('still reports a query deadline or network failure as unhealthy', async () => {
    const store = new AtlasStore(config);
    await store.connect();
    driver.toArray.mockRejectedValueOnce(new DOMException('Internal deadline', 'TimeoutError'));
    await expect(store.episodes.list(undefined, new AbortController().signal)).rejects.toMatchObject({
      code: 'ATLAS_UNAVAILABLE',
    });
    expect(store.status().connected).toBe(false);
  });
  it('shares concurrent startup and reuses one bounded majority-write client', async () => {
    const store = new AtlasStore(config);
    await Promise.all([store.connect(), store.connect(), store.checkHealth()]);
    expect(driver.clients).toHaveLength(1);
    expect(driver.connect).toHaveBeenCalledTimes(1);
    expect(driver.clients[0].options).toMatchObject({
      maxPoolSize: 5,
      retryReads: true,
      retryWrites: true,
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
    expect(driver.clients[0].options).not.toHaveProperty('timeoutMS');
    expect(store.status()).toMatchObject({
      configured: true,
      connected: true,
      lastCheckedAt: expect.any(String),
    });
    await store.connect();
    expect(driver.connect).toHaveBeenCalledTimes(1);
    await store.checkHealth();
    expect(driver.command).toHaveBeenCalledTimes(2);
    expect(driver.findOne).toHaveBeenCalledTimes(2);
    expect(driver.createIndex).toHaveBeenCalledTimes(7);
    await store.close();
  });

  it('does not confuse an individual secondary heartbeat with application readiness', async () => {
    const store = new AtlasStore(config);
    await store.connect();
    driver.clients[0].emit('serverHeartbeatFailed');
    expect(store.status().connected).toBe(true);
    driver.clients[0].emit('topologyDescriptionChanged', { newDescription: { type: 'ReplicaSetNoPrimary' } });
    expect(store.status().connected).toBe(false);
    driver.clients[0].emit('serverHeartbeatSucceeded');
    expect(store.status().connected).toBe(false);
    expect((await store.checkHealth()).connected).toBe(true);
  });

  it('detects loss of authenticated access, redacts the error, and recovers after backoff', async () => {
    const store = new AtlasStore(config);
    await store.connect();
    driver.findOne.mockRejectedValueOnce(new MongoNetworkError('mongodb+srv://secret@private-host'));
    const down = await store.checkHealth();
    expect(down).toMatchObject({ connected: false, errorCode: 'ATLAS_UNAVAILABLE', latencyMs: null });
    expect(JSON.stringify(down)).not.toMatch(/secret|private-host|mongodb/);
    await store.checkHealth();
    expect(driver.command).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_001);
    const recovered = await store.checkHealth();
    expect(recovered.connected).toBe(true);
    expect(recovered.errorCode).toBeUndefined();
    expect(driver.clients).toHaveLength(1);
  });

  it.each(['episode', 'exploration', 'scenario'] as const)(
    'reports %s operation failures through the shared connection',
    async (kind) => {
      const store = new AtlasStore(config);
      await store.connect();
      driver.findOne.mockRejectedValueOnce(new MongoNetworkError('private details'));
      const call =
        kind === 'episode'
          ? store.episodes.find('test')
          : kind === 'exploration'
            ? store.explorations.get('test')
            : store.explorations.getScenario('test');
      await expect(call).rejects.toMatchObject({ status: 503, code: 'ATLAS_UNAVAILABLE', retryable: true });
      expect(store.status().connected).toBe(false);
    },
  );

  it('returns retryable 503 errors for new storage routes and keeps status readable during an outage', async () => {
    const store = new AtlasStore(config);
    await store.connect();
    driver.toArray.mockRejectedValueOnce(new MongoNetworkError('secret connection details'));
    const api = createApiHandler({
      config,
      store,
      explorations: store.explorations,
      planner: createGeminiPlanner(config),
    });
    const request = (path: string) =>
      new Request(`http://127.0.0.1:8787/api/${path}`, { headers: { host: '127.0.0.1:8787' } });
    const response = await api(request('scenarios'));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatchObject({ code: 'ATLAS_UNAVAILABLE', retryable: true });
    expect(JSON.stringify(body)).not.toContain('secret');
    const status = await api(request('status'));
    expect(status.status).toBe(200);
    expect((await status.json()).atlas.connected).toBe(false);
  });

  it('distinguishes permission failures from transient network outages', async () => {
    const store = new AtlasStore(config);
    driver.findOne.mockRejectedValueOnce(new MongoServerError({ code: 13, errmsg: 'private auth details' }));
    await expect(store.connect()).rejects.toMatchObject({ code: 'ATLAS_ACCESS_DENIED', retryable: false });
    expect(store.status()).toMatchObject({ connected: false, errorCode: 'ATLAS_ACCESS_DENIED' });
    driver.clients[0].emit('serverHeartbeatSucceeded');
    expect(store.status().connected).toBe(false);
  });

  it('does not postpone recovery when requests continue during the cooldown', async () => {
    const store = new AtlasStore(config);
    await store.connect();
    driver.findOne.mockRejectedValueOnce(new MongoNetworkError('outage'));
    await expect(store.episodes.find('test')).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(store.explorations.get('test')).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(1_001);
    expect((await store.checkHealth()).connected).toBe(true);
    expect(driver.clients).toHaveLength(1);
  });

  it('keeps validation errors and programming errors distinct from connectivity', async () => {
    const store = new AtlasStore(config);
    await store.connect();
    await expect(store.explorations.get('missing')).rejects.toMatchObject({ code: 'EXPLORATION_NOT_FOUND' });
    driver.findOne.mockRejectedValueOnce(new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Different input.'));
    await expect(store.episodes.find('conflict')).rejects.toMatchObject({ status: 409 });
    driver.findOne.mockRejectedValueOnce(new TypeError('code defect'));
    await expect(store.episodes.find('test')).rejects.toThrow(TypeError);
    expect(store.status().connected).toBe(true);
  });

  it('does not resurrect the connection when shutdown races startup', async () => {
    let finish!: () => void;
    driver.connect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const store = new AtlasStore(config);
    const opening = store.connect();
    const rejected = expect(opening).rejects.toMatchObject({ code: 'ATLAS_UNAVAILABLE' });
    const closing = store.close();
    finish();
    await rejected;
    await closing;
    expect(driver.close).toHaveBeenCalledOnce();
    expect(store.status().connected).toBe(false);
    await expect(store.connect()).rejects.toMatchObject({ status: 503 });
    expect(driver.connect).toHaveBeenCalledOnce();
  });
});
