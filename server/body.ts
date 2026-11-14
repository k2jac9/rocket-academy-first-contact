import { ApiError } from './errors.ts';

export const MAX_REQUEST_BYTES = 256 * 1024;

export async function readBoundedBody(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal,
  tooLarge: ApiError,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge;
      }
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export async function readJsonRequest(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'JSON_REQUIRED', 'Send this request with Content-Type: application/json.');
  }
  const encoding = request.headers.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity')
    throw new ApiError(415, 'ENCODING_UNSUPPORTED', 'Compressed request bodies are not supported.');
  const tooLarge = new ApiError(413, 'REQUEST_TOO_LARGE', 'The request exceeds the 256 KiB limit.');
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > MAX_REQUEST_BYTES) throw tooLarge;
  const deadline = AbortSignal.timeout(5_000);
  const signal = AbortSignal.any([request.signal, deadline]);
  try {
    const bytes = await readBoundedBody(request.body, MAX_REQUEST_BYTES, signal, tooLarge);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal.aborted)
      throw new ApiError(408, 'REQUEST_TIMEOUT', 'The request body did not arrive in time.', true);
    throw new ApiError(400, 'INVALID_JSON', 'The request body must contain valid JSON.');
  }
}
