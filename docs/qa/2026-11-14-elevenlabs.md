# ElevenLabs narration verification — 2026-11-14

Scope: local mission briefings and saved-episode narration in Robot lab. Narration is presentation audio independent of the simulation timeline; it is not saved to Atlas, included in MCAP, or admitted as robot training evidence.

## Automated checks

- `npm test`: 203 tests across 15 files passed, including 19 narration API tests.
- `npm run build`: TypeScript validation and production build passed. Vite retains the existing large-chunk warning.
- The narration tests exercise server-only credentials, input validation, origin restrictions, voice-list projection, bounded output, MP3 validation, caching, rate and concurrency limits, cancellation before dispatch, and redacted provider failures without automatic retries.
- The masked Windows PowerShell helper was exercised with dummy credentials in an ignored fixture directory. Existing environment entries were preserved. The atomic replacement now uses an explicit ignored backup filename, avoiding Windows PowerShell 5's null-to-empty conversion for `File.Replace`.

## Live local checks

- The real key was saved to ignored `.env.local`; no credential value is included in this report.
- Local speech status returned configured. ElevenLabs returned 21 available voices.
- Through the browser UI, George generated: “Welcome to First Contact. Your mission audio is ready.” This was one 54-character generation using `eleven_multilingual_v2`.
- The returned MP3 contained 56,885 bytes. `ffprobe` identified MP3, 44,100 Hz, mono, with a duration of 3.482993 seconds. The browser decoded the clip, playback advanced, and Download MP3 produced the expected file.
- Navigating away from Robot lab paused playback. Audio did not autoplay.
- Desktop (1440 × 1000) and mobile (390 × 844) screenshots were inspected. Voice selection, script editing, generation and download controls remained usable without horizontal overflow.
- Selecting the saved Apollo 17 episode populated a replay summary with the two recorded robot identities, 5.0 seconds, 51 state frames and 22 RGB/depth pairs. Reaching the configured duration was described as a termination condition, without claiming mission success. Loading the replay did not generate audio automatically.

Local screenshots and the smoke-test MP3 remain under ignored `test-results/`. They are not committed. The live smoke check establishes this account's access to the selected voice/model at the time of testing; it does not verify every voice or future account availability.
