# ElevenLabs mission narration

Robot lab includes an editable mission briefing before execution and a summary when a saved physical episode is selected. Use **Mission audio** in the lab header to reach the panel, load available voices, generate audio, and play or download the MP3.

Default summaries use recorded site, robot identities, duration, termination, state-frame count and camera-sample count. A duration limit is not reported as mission success. Text can be edited before generation. The recording itself is unchanged: narration is presentation audio, not a robot observation, physics signal, timestamp-aligned annotation, or MCAP channel.

## Configure

Create an API key using the [ElevenLabs setup guide](https://elevenlabs.io/docs/eleven-api/quickstart/#create-an-api-key) with Text to Speech access and Voices read permission. The key remains on the Node server, outside the browser and Git history.

```dotenv
ELEVENLABS_API_KEY=
ELEVENLABS_MODEL=eleven_multilingual_v2
ELEVENLABS_VOICE_ID=
```

On Windows, the masked setup helper preserves existing `.env.local` entries:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/configure-elevenlabs.ps1
```

Restart the local API after configuration changes and select Refresh in Mission audio. The optional voice ID is preferred when it appears in the returned list. Otherwise the UI selects the documented George voice when available, then the first available voice. No voices are cloned or added to the account.

The integration uses ElevenLabs' official [list voices endpoint](https://elevenlabs.io/docs/api-reference/voices/search) and [text-to-speech endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert). Defaults are `eleven_multilingual_v2` and `mp3_44100_128`; account/model/voice eligibility is confirmed by the actual provider response.

## API and limits

| Endpoint | Behavior |
| --- | --- |
| `GET /api/speech/status` | Local configuration, model, preferred voice and character limit; no paid request and no key disclosure |
| `GET /api/speech/voices` | First 100 available voices; ID/name/category only; `hasMore` identifies a truncated list |
| `POST /api/speech` | JSON `{ text, voiceId }`; MP3 bytes with download filename, `X-Audio-SHA256`, `X-Narration-Model`, and `X-Narration-Cache` |

- Scripts are limited to 1,200 JavaScript string characters. The model comes from server configuration; the client cannot override provider URLs or credentials.
- One generation can run at a time; at most six new attempts per minute per API process. Voice-list calls have a 15-second deadline; speech has 45 seconds. Bodies are bounded to 2 MiB for voices and 4 MiB for audio.
- The server caches at most six successful clips for ten minutes, keyed by trimmed text, voice and model. The voice list is also cached for ten minutes. Cache lifetime ends on server restart. Playback and downloading a generated clip do not regenerate it.
- Generation is explicit and consumes the account's credits. The server does not automatically retry provider requests. Cancelling or timing out does not guarantee the provider avoided processing/billing the request.
- The default provider retention settings apply; this implementation does not claim enterprise zero-retention mode.
- Audio does not autoplay. Navigating away from Robot lab pauses playback and cancels pending browser work. Changing the script/context discards obsolete audio. Generated clips are held temporarily in memory; download the MP3 to keep it. They are not persisted to Atlas or included in training exports.
- Errors distinguish missing configuration, account/voice access, quota, invalid output, and network failures without returning provider response bodies or keys. Existing local host/origin restrictions apply.

## Verification

Automated tests cover credential scoping, input limits, safe voice projection, MP3 validation, byte caps, local origin checks, concurrent-request rejection, caching, rate limits and redacted provider failures. A live check additionally verifies account voice listing and browser-decoded MP3 output; see the dated [narration QA report](qa/2026-11-14-elevenlabs.md).
