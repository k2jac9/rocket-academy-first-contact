import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createApiHandler } from './app.ts';
import { AtlasStore } from './atlas.ts';
import { readConfig } from './config.ts';
import { createGeminiPlanner } from './gemini.ts';

const config = readConfig();
const store = new AtlasStore(config);
const handle = createApiHandler({ config, store, planner: createGeminiPlanner(config) });
const apiOrigin = `http://${config.host}:${config.port}`;

const server = createServer({ maxHeaderSize: 16 * 1024 }, async (incoming, outgoing) => {
  const cancellation = new AbortController();
  const cancel = () => {
    if (!outgoing.writableEnded) cancellation.abort();
  };
  incoming.once('aborted', cancel);
  outgoing.once('close', cancel);
  try {
    const url = new URL(incoming.url ?? '/', apiOrigin);
    if (url.origin !== apiOrigin) {
      outgoing.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      outgoing.end(
        JSON.stringify({
          error: { code: 'INVALID_URL', message: 'Use a local API path.', retryable: false },
        }),
      );
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else if (value !== undefined) headers.set(name, value);
    }
    const method = incoming.method ?? 'GET';
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers,
      signal: cancellation.signal,
      ...(['GET', 'HEAD'].includes(method)
        ? {}
        : { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: 'half' as const }),
    };
    const response = await handle(new Request(url, init));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body)
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
        outgoing,
        { signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(30_000)]) },
      );
    else outgoing.end();
  } catch {
    if (!outgoing.headersSent && !outgoing.destroyed) {
      outgoing.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      outgoing.end(
        JSON.stringify({
          error: {
            code: 'TRANSPORT_ERROR',
            message: 'The local API could not finish the request.',
            retryable: true,
          },
        }),
      );
    } else outgoing.destroy();
  } finally {
    incoming.removeListener('aborted', cancel);
    outgoing.removeListener('close', cancel);
  }
});
server.requestTimeout = 40_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.on('error', () => {
  console.error('The local API could not bind its loopback port.');
  process.exitCode = 1;
});
server.listen(config.port, config.host, () => {
  console.info(`First Contact local API: ${apiOrigin}`);
  console.info(
    `Gemini: ${config.geminiApiKey ? 'configured; requests will verify access' : 'not configured'}. Atlas: ${config.mongodbUri ? 'configured; connecting' : 'not configured'}.`,
  );
});
if (config.mongodbUri)
  void store.connect().catch(() => {
    console.warn('Atlas is configured but unavailable. Inspect the server setup and network access.');
  });

let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  server.close(() => {
    void store.close().then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.exitCode = 1;
      },
    );
  });
  server.closeIdleConnections();
  const force = setTimeout(() => {
    server.closeAllConnections();
    void store.close().catch(() => {
      process.exitCode = 1;
    });
  }, 5_000);
  force.unref();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
