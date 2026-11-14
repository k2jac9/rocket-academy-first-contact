import type { ServerConfig } from './config.ts';
import { ApiError, exactKeys, isRecord } from './errors.ts';
import { readBoundedBody } from './body.ts';
import { bytesHash, jsonHash } from './hash.ts';

export const MAX_NARRATION_CHARACTERS = 1_200;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const CACHE_TTL_MS = 10 * 60_000;
const VOICE_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const ORIGIN = 'https://api.elevenlabs.io';
export interface NarratorVoice {
  id: string;
  name: string;
  category: string;
}
export interface SpeechAudio {
  bytes: Uint8Array;
  sha256: string;
  model: string;
  voiceId: string;
  cached: boolean;
}
export interface ElevenLabsSpeech {
  status(): {
    configured: boolean;
    provider: 'elevenlabs';
    model: string;
    defaultVoiceId: string;
    maxCharacters: number;
  };
  voices(signal: AbortSignal): Promise<{ voices: NarratorVoice[]; hasMore: boolean }>;
  generate(value: unknown, signal: AbortSignal): Promise<SpeechAudio>;
}

export function createElevenLabsSpeech(config: ServerConfig, send: typeof fetch = fetch): ElevenLabsSpeech {
  const cache = new Map<string, { expires: number; audio: SpeechAudio }>();
  let voicesCache: { expires: number; voices: NarratorVoice[]; hasMore: boolean } | null = null;
  let generating = false;
  let attempts: number[] = [];

  function requireKey() {
    if (!config.elevenLabsApiKey)
      throw new ApiError(
        503,
        'SPEECH_NOT_CONFIGURED',
        'Add ELEVENLABS_API_KEY to the local server to generate mission audio.',
      );
  }
  async function upstream(path: string, init: RequestInit, signal: AbortSignal) {
    const response = await send(`${ORIGIN}${path}`, {
      ...init,
      signal,
      redirect: 'error',
      headers: { 'xi-api-key': config.elevenLabsApiKey, ...init.headers },
    });
    if (response.ok) return response;
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 401 || response.status === 403)
      throw new ApiError(
        502,
        'SPEECH_ACCESS_DENIED',
        'ElevenLabs rejected this request. Check the API key, Text to Speech access, Voices read permission, and voice availability.',
      );
    if (response.status === 402 || response.status === 429)
      throw new ApiError(
        429,
        'SPEECH_QUOTA',
        'ElevenLabs credits or rate limits were reached. Check the account before trying again.',
        true,
      );
    if (response.status === 400 || response.status === 404 || response.status === 422)
      throw new ApiError(
        422,
        'SPEECH_VOICE_UNAVAILABLE',
        'ElevenLabs could not use this voice and model. Refresh the voice list or check the server model setting.',
      );
    throw new ApiError(
      502,
      'SPEECH_UPSTREAM_ERROR',
      'ElevenLabs could not complete the request. No automatic retry was made.',
      response.status >= 500,
    );
  }
  function failure(error: unknown, signal: AbortSignal): never {
    if (error instanceof ApiError) throw error;
    if (signal.aborted)
      throw new ApiError(
        504,
        'SPEECH_TIMEOUT',
        'The narration request was cancelled or timed out. Check before retrying; the provider may have already processed it.',
        true,
      );
    throw new ApiError(
      502,
      'SPEECH_UNAVAILABLE',
      'The local server could not reach ElevenLabs. Try again when the connection is available.',
      true,
    );
  }
  async function body(response: Response, limit: number, signal: AbortSignal) {
    const tooLarge = new ApiError(
      502,
      'SPEECH_RESPONSE_TOO_LARGE',
      'The ElevenLabs response exceeded the narration limit.',
    );
    if (Number(response.headers.get('content-length') ?? 0) > limit) {
      await response.body?.cancel().catch(() => undefined);
      throw tooLarge;
    }
    return readBoundedBody(response.body, limit, signal, tooLarge);
  }

  return {
    status: () => ({
      configured: Boolean(config.elevenLabsApiKey),
      provider: 'elevenlabs',
      model: config.elevenLabsModel,
      defaultVoiceId: config.elevenLabsVoiceId,
      maxCharacters: MAX_NARRATION_CHARACTERS,
    }),
    async voices(requestSignal) {
      requireKey();
      requestSignal.throwIfAborted();
      if (voicesCache && voicesCache.expires > Date.now())
        return { voices: voicesCache.voices, hasMore: voicesCache.hasMore };
      const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(15_000)]);
      try {
        const response = await upstream('/v2/voices?page_size=100', { method: 'GET' }, signal);
        const data: unknown = JSON.parse(
          new TextDecoder().decode(await body(response, 2 * 1024 * 1024, signal)),
        );
        if (!isRecord(data) || !Array.isArray(data.voices))
          throw new ApiError(502, 'SPEECH_INVALID_RESPONSE', 'ElevenLabs returned an invalid voice list.');
        const voices: NarratorVoice[] = [];
        for (const voice of data.voices) {
          if (
            !isRecord(voice) ||
            typeof voice.voice_id !== 'string' ||
            !VOICE_ID.test(voice.voice_id) ||
            typeof voice.name !== 'string'
          )
            continue;
          if (voices.some((item) => item.id === voice.voice_id)) continue;
          voices.push({
            id: voice.voice_id,
            name: voice.name.slice(0, 100),
            category: typeof voice.category === 'string' ? voice.category.slice(0, 40) : 'available',
          });
          if (voices.length === 100) break;
        }
        voices.sort((a, b) => a.name.localeCompare(b.name));
        const hasMore = data.has_more === true || data.voices.length > 100;
        voicesCache = { expires: Date.now() + CACHE_TTL_MS, voices, hasMore };
        return { voices, hasMore };
      } catch (error) {
        return failure(error, signal);
      }
    },
    async generate(value, requestSignal) {
      exactKeys(value, ['text', 'voiceId']);
      if (
        typeof value.text !== 'string' ||
        !value.text.trim() ||
        value.text.trim().length > MAX_NARRATION_CHARACTERS
      )
        throw new ApiError(
          422,
          'SPEECH_INVALID_TEXT',
          `Narration must contain 1–${MAX_NARRATION_CHARACTERS} characters.`,
        );
      if (typeof value.voiceId !== 'string' || !VOICE_ID.test(value.voiceId))
        throw new ApiError(422, 'SPEECH_INVALID_VOICE', 'Choose an available narration voice.');
      requireKey();
      requestSignal.throwIfAborted();
      const text = value.text.trim(),
        voiceId = value.voiceId;
      const key = jsonHash({ text, voiceId, model: config.elevenLabsModel });
      const found = cache.get(key);
      if (found && found.expires > Date.now()) return { ...found.audio, cached: true };
      if (generating)
        throw new ApiError(
          429,
          'SPEECH_BUSY',
          'Another narration is being generated. Wait for it to finish.',
          true,
        );
      attempts = attempts.filter((time) => Date.now() - time < 60_000);
      if (attempts.length >= 6)
        throw new ApiError(
          429,
          'SPEECH_RATE_LIMIT',
          'The local narration limit is six new requests per minute. Try again shortly.',
          true,
        );
      generating = true;
      attempts.push(Date.now());
      const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(45_000)]);
      try {
        const response = await upstream(
          `/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'audio/mpeg' },
            body: JSON.stringify({ text, model_id: config.elevenLabsModel }),
          },
          signal,
        );
        const bytes = await body(response, MAX_AUDIO_BYTES, signal);
        const mime = response.headers.get('content-type')?.split(';')[0];
        const mp3 =
          (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) ||
          (bytes[0] === 255 && (bytes[1] & 224) === 224);
        if (
          !['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(mime ?? '') ||
          bytes.length < 4 ||
          !mp3
        )
          throw new ApiError(
            502,
            'SPEECH_INVALID_AUDIO',
            'ElevenLabs did not return a playable MP3 response.',
          );
        const audio: SpeechAudio = {
          bytes,
          sha256: bytesHash(bytes),
          model: config.elevenLabsModel,
          voiceId,
          cached: false,
        };
        for (const [id, item] of cache) if (item.expires <= Date.now()) cache.delete(id);
        while (cache.size >= 6) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: Date.now() + CACHE_TTL_MS, audio });
        return audio;
      } catch (error) {
        return failure(error, signal);
      } finally {
        generating = false;
      }
    },
  };
}
