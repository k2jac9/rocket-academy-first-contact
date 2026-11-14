# Planetary runs and Atlas verification — 2026-11-14

This report covers the v0.2 planetary-globe, bounded robot episode, MCAP, Gemini adapter, and MongoDB Atlas/GridFS implementation. It supersedes neither the historical first-slice report nor the outstanding live-provider and graphics checks described below.

## Automated verification

The final local checks ran against the integrated source after review corrections:

| Check | Result |
| --- | --- |
| `git diff --check` | Passed |
| `npm test` | **123 tests passed across 8 files** |
| `npm run build` | TypeScript check and production Vite build passed |
| Independent code review | No unresolved Critical or Important findings after corrections |
| Focused correction review | Five Atlas recovery/Gemini provenance regression tests passed independently |
| Published implementation | `28c8aa4f9a12aabce249af67ba27a20f00e2ed40` on `main` |
| GitHub CI | [Run 43623051337](https://github.com/k2jac9/rocket-academy-first-contact/actions/runs/43623051337) **passed** `npm ci`, `npm test`, and `npm run build` |

The build emits a non-fatal warning for the main JavaScript chunk, approximately 1.05 MB minified / 285 KB gzip. MCAP serialization is a separate, lazily imported chunk of approximately 198 KB minified / 33 KB gzip. No bundle-size claim is made for future sensor/physics integrations.

Coverage includes mission schema 2.0.0, body/source identity, radius checks, source/display transforms, exact sphere picks, narrow-aspect camera fitting, startup deadlines, bounded plans, spherical trajectories, deterministic execution, explicit model limits, recording timestamps, frame transforms, indexed MCAP, API origins/hosts, credential redaction, controlled provider failures, and Atlas persistence boundaries.

The independent review identified an Atlas recovery dead end after an initial connection failure. `/api/status` now attempts a bounded reconnect when Atlas is configured but disconnected, returning fresh status even when the retry fails. A second improvement records the validated model returned by Gemini, preserving resolved model identity when an alias was requested. Both corrections received a focused re-review.

## Independent MCAP verification

The repository's TypeScript writer and browser download were checked with a separate implementation: Python `mcap==1.6.0` and `jsonschema==4.26.0`, using [`scripts/verify_mcap.py`](../../scripts/verify_mcap.py).

| Repository example | Bytes | Frames | Messages | Goal |
| --- | ---: | ---: | ---: | --- |
| [`first-contact-mars.mcap`](../../examples/recordings/first-contact-mars.mcap) | 230,696 | 101 | 314 | Reached |
| [`first-contact-moon.mcap`](../../examples/recordings/first-contact-moon.mcap) | 230,799 | 101 | 314 | Reached |
| [`first-contact-earth.mcap`](../../examples/recordings/first-contact-earth.mcap) | 233,631 | 101 | 314 | Reached |

The examples use a declared 20 m reference-sphere traverse at 1 m/s. All embedded JSON schemas, message counts, indexes, timestamp conversions, per-channel sequences, unit quaternions, native/local frame reconstruction, terminal goal consistency, chunk CRCs, and data-section CRCs passed. Their mission attachments also pass the current strict mission validator after the final source-credit corrections.

| File | SHA-256 |
| --- | --- |
| Mars example | `abebde410db71df63cbbd2d51b90de568d1c2cf08f80043c79df1322ee857047` |
| Moon example | `1b614db2a84f18774b5b10a873502751891351539c86a70478c69ef2fa2b17f0` |
| Earth example | `ebc7ef8ce31b924b51c5e7a6868adb4c536161ea7144d21b8b8efb5ece86e004` |

The **actual browser Export MCAP download** was also independently checked. This used the UI baseline at 0.75 m/s: **135 frames, 416 messages, 286,534 bytes**, completed with its goal reached. Its SHA-256 was `0290b2af717dd361d0449da1ba78e600c00110ab7fa89023bf30a4f16ab83e80`. It passed the same schema, index, time, transform, quaternion, and CRC checks. The temporary QA download is not an additional repository fixture.

These are JSON-encoded, indexed MCAP recordings with Foxglove-compatible schemas. A Foxglove GUI session was not exercised; this report establishes format/schema readback, not an unobserved application interaction.

## Browser workflow

The managed local preview was exercised at `http://127.0.0.1:4173/`:

- Default Mars destination and NASA globe layer; Moon, Earth, and Dingo Gap choices present.
- Moon and Earth selection changes source identity/credits and clears a prior mission, plan, and recording.
- Earth does not expose an unimplemented measured-terrain option.
- **Load 20 m example → Baseline plan → Run locally → Export MCAP** succeeds on Mars.
- The baseline is explicitly identified as deterministic; unconfigured Gemini is not presented as a successful AI call.
- Play advances through recorded states; Pause retains the selected position. Seeking to the terminal Earth frame shows 26.7 s and 0.00 m remaining.
- An Earth baseline episode also records 135 states and reaches its goal.
- Atlas and Gemini show **Not configured**, with dependent controls disabled. The running local service remains reachable through the Vite proxy.
- Connection settings describe server-only Atlas/Gemini values separately from the optional public ion token.
- The final UI state was captured in [`planetary-runs-atlas.jpg`](planetary-runs-atlas.jpg).

**The hosted browser cannot create a WebGL context.** The application displays the graphics failure and keeps example planning, execution, replay data, and MCAP export usable. This environment did not establish successful GPU rendering, visible texture orientation, interactive terrain picks, or animated rover rendering. Mathematical transforms and fitting were tested independently; those tests do not replace visual verification on a graphics-capable machine.

## Data access and source checks

Mars and Earth image endpoints were checked for successful image responses, declared dimensions, and usable cross-origin headers. The Moon uses the proper 2048 × 1024 LRO equirectangular color map, bundled without modification because its upstream cross-origin response was unsuitable for this browser workflow. Its SHA-256 is recorded in [NOTICE.md](../../NOTICE.md).

The NASA 3D Resources Moon photograph was rejected as a globe texture because it depicts a lunar disc, rather than an equirectangular map. The visual globes remain explicit reference spheres with no measured elevation. Optional ion terrain and Dingo Gap remain separate source variants.

## Outstanding checks and limits

No Atlas URI, Gemini key, or ion token was supplied for this verification. The following are **implemented but not live-provider verified**: Gemini planning; Atlas connection, writes, GridFS uploads/downloads, retries, and history; optional ion Moon/Mars loading. Tests use injected boundaries and controlled responses. No cluster or account was provisioned.

The executor remains kinematic, with no terrain-contact validation, obstacle avoidance, calibrated sensor generation, policy training, or hardware control. Each recording marks these limits. Google Earth Engine, Meteomatics, Genie, vector retrieval, external object storage, and a physics worker remain documented future integrations.

The API and default development frontend bind to loopback. Public deployment requires authentication and authorization work beyond this slice. CI checks installation, tests, and build on repository publication; the workflow run is the authority for the published commit's status.
