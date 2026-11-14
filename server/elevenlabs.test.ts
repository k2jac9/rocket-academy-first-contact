import { describe, expect, it, vi } from 'vitest';
import { createElevenLabsSpeech, MAX_NARRATION_CHARACTERS } from './elevenlabs.ts';
import { readConfig } from './config.ts';
import { createApiHandler } from './app.ts';
import { AtlasStore } from './atlas.ts';
import { createGeminiPlanner } from './gemini.ts';

const config = readConfig({ ELEVENLABS_API_KEY: 'fixture-key-private' });
const signal = () => new AbortController().signal;
const input = { text: 'Mission audio is ready.', voiceId: 'voice-test' };
const audio = () =>
  new Response(new Uint8Array([73, 68, 51, 4, 0, 0, 1, 2]), { headers: { 'content-type': 'audio/mpeg' } });

describe('ElevenLabs server boundary', () => {
  it('never calls the provider without a key and never exposes credentials in status', async () => {
    const send = vi.fn<typeof fetch>();
    const speech = createElevenLabsSpeech(readConfig({}), send);
    expect(speech.status().configured).toBe(false);
    await expect(speech.generate(input, signal())).rejects.toMatchObject({ code: 'SPEECH_NOT_CONFIGURED' });
    await expect(speech.voices(signal())).rejects.toMatchObject({ code: 'SPEECH_NOT_CONFIGURED' });
    expect(send).not.toHaveBeenCalled();
    expect(JSON.stringify(createElevenLabsSpeech(config, send).status())).not.toContain(
      config.elevenLabsApiKey,
    );
  });

  it('returns only safe voice fields, deduplicates, and reuses a bounded list cache', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        voices: [
          { voice_id: 'voice-b', name: 'Zed', category: 'default', samples: [{ file_name: 'private.wav' }] },
          {
            voice_id: 'voice-a',
            name: 'Ada',
            category: 'default',
            sharing: { email: 'private@example.invalid' },
          },
          { voice_id: 'voice-b', name: 'Duplicate' },
          { voice_id: '../other', name: 'Invalid' },
        ],
        has_more: true,
      }),
    );
    const speech = createElevenLabsSpeech(config, send);
    const voices = await speech.voices(signal());
    expect(voices).toEqual({
      voices: [
        { id: 'voice-a', name: 'Ada', category: 'default' },
        { id: 'voice-b', name: 'Zed', category: 'default' },
      ],
      hasMore: true,
    });
    expect(await speech.voices(signal())).toEqual(voices);
    expect(send).toHaveBeenCalledOnce();
  });

  it('uses the server credential and pinned MP3 format, caching identical generation', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => audio());
    const speech = createElevenLabsSpeech(config, send);
    const first = await speech.generate(input, signal());
    const again = await speech.generate({ ...input, text: ` ${input.text} ` }, signal());
    expect(first).toMatchObject({
      cached: false,
      model: 'eleven_multilingual_v2',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(again.cached).toBe(true);
    expect(again.bytes).toEqual(first.bytes);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-test?output_format=mp3_44100_128',
    );
    expect(send.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { 'xi-api-key': config.elevenLabsApiKey },
    });
    expect(JSON.parse(String(send.mock.calls[0][1]?.body))).toEqual({
      text: input.text,
      model_id: config.elevenLabsModel,
    });
    await speech.generate({ ...input, voiceId: 'other-voice' }, signal());
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...input, text: '' },
    { ...input, text: 'x'.repeat(MAX_NARRATION_CHARACTERS + 1) },
    { ...input, voiceId: '../../admin' },
    { ...input, apiKey: 'injected' },
    { ...input, model_id: 'other' },
  ])('rejects invalid or injected requests before contacting the provider', async (value) => {
    const send = vi.fn<typeof fetch>();
    await expect(createElevenLabsSpeech(config, send).generate(value, signal())).rejects.toMatchObject({
      status: 422,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'SPEECH_ACCESS_DENIED'],
    [403, 'SPEECH_ACCESS_DENIED'],
    [429, 'SPEECH_QUOTA'],
    [402, 'SPEECH_QUOTA'],
    [500, 'SPEECH_UPSTREAM_ERROR'],
  ])('redacts provider HTTP %s without automatic retry', async (status, code) => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private-credential echoed by upstream', { status: Number(status) }));
    const failure = await createElevenLabsSpeech(config, send)
      .generate(input, signal())
      .catch((error) => error);
    expect(failure.code).toBe(code);
    expect(failure.message).not.toContain('private-credential');
    expect(send).toHaveBeenCalledOnce();
  });

  it('rejects a success response containing JSON instead of MP3', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'private details' }));
    await expect(createElevenLabsSpeech(config, send).generate(input, signal())).rejects.toMatchObject({
      code: 'SPEECH_INVALID_AUDIO',
    });
  });

  it('bounds response bytes before buffering a large declared body', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('oversized', {
        headers: { 'content-type': 'audio/mpeg', 'content-length': String(5 * 1024 * 1024) },
      }),
    );
    await expect(createElevenLabsSpeech(config, send).generate(input, signal())).rejects.toMatchObject({
      code: 'SPEECH_RESPONSE_TOO_LARGE',
    });
  });

  it('allows only one generation at a time and releases the slot after failure', async () => {
    let reject!: (error: Error) => void;
    const send = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          }),
      )
      .mockImplementation(async () => audio());
    const speech = createElevenLabsSpeech(config, send);
    const pending = speech.generate(input, signal());
    await expect(speech.generate(input, signal())).rejects.toMatchObject({ code: 'SPEECH_BUSY' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'SPEECH_UNAVAILABLE' });
    reject(new Error('private network details'));
    await rejected;
    expect((await speech.generate(input, signal())).bytes.length).toBeGreaterThan(0);
  });

  it('does not send an already cancelled request', async () => {
    const send = vi.fn<typeof fetch>();
    await expect(createElevenLabsSpeech(config, send).generate(input, AbortSignal.abort())).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('caps new requests per minute while allowing cached playback', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => audio());
    const speech = createElevenLabsSpeech(config, send);
    for (let i = 0; i < 6; i++) await speech.generate({ ...input, text: `Mission ${i}` }, signal());
    await expect(speech.generate(input, signal())).rejects.toMatchObject({ code: 'SPEECH_RATE_LIMIT' });
    expect((await speech.generate({ ...input, text: 'Mission 5' }, signal())).cached).toBe(true);
    expect(send).toHaveBeenCalledTimes(6);
  });

  it('keeps narration behind the local origin boundary and serves downloadable audio', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => audio());
    const api = createApiHandler({
      config,
      store: new AtlasStore(config),
      planner: createGeminiPlanner(config),
      speech: createElevenLabsSpeech(config, send),
    });
    const request = (origin: string) =>
      new Request('http://127.0.0.1:8787/api/speech', {
        method: 'POST',
        headers: { host: '127.0.0.1:8787', origin, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    expect((await api(request('https://untrusted.example'))).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
    const result = await api(request('http://127.0.0.1:5173'));
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe('audio/mpeg');
    expect(result.headers.get('content-disposition')).toContain('first-contact-narration.mp3');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('x-audio-sha256')).toMatch(/^[a-f0-9]{64}$/);
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(new Uint8Array(await audio().arrayBuffer()));
  });
});
