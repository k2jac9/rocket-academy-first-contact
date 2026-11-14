# Google Genie exploration integration

Adapter version 1.0.0. Implemented November 14, 2026. This is a manual exploration/import adapter, not a live connection to a Google world-model runtime.

## Verified access boundary

Google's [current Genie page](https://deepmind.google/models/genie/) describes Genie 4 as a trusted-tester research preview, with planned access through Project Genie and early Gemini API/AI Studio partners. Its [Genie 3 announcement](https://deepmind.google/blog/genie-3-a-new-frontier-for-world-models/) demonstrates SIMA navigation and describes geographic, interaction and multi-agent limitations. [Project Genie](https://labs.google/projectgenie) is a separate web application. These sources do not establish this application's API entitlement.

At 2026-11-14T21:11:48Z, the configured Gemini credential returned HTTP 200 from the official [models.list API](https://ai.google.dev/api/models); all returned pages contained no model with Genie in its name/display name. This is a model-visibility observation, not a determination of a separate trusted-tester entitlement. The desktop browser automation connection was unavailable, so signed-in Project Genie web access could not be inspected. No subscription, key, account or access setting was changed.

`GET /api/integrations/genie` reports the versioned adapter and six unverified gates: actions/observations; reset/timing; measured terrain import; state/ground truth; independent agents; account access/permitted automated use. `POST /api/integrations/genie/execute` returns 501 `GENIE_ACCESS_UNVERIFIED`. There is no configurable arbitrary endpoint and no fabricated SDK request. Existing Gemini planning remains a separate bounded API.

## Implemented workflow

`#/studio` prepares prompts, links to Project Genie, imports evidence, lists the latest 20 explorations and scenarios, exports JSON provenance, and opens a runnable scenario in Robot lab. It uses the shared catalog visual system. Uploaded media is checked for browser preview before submission. Native image/video controls provide evidence inspection.

Explorations retain the prompt, mission intent, requested body, operator-reported model identity, optional exact revision, settings notes, adapter identity and original artifact hashes. Missing backend revisions remain null. An import with no video is `exploration_brief`; a video-backed record is `imported_recording`. Neither claims a complete robot episode.

Records use `sourceKind: generative_world_model`, `referenceUse: visual_conditioning_only`, and server-owned eligibility. Exploration and review are allowed; perception, imitation, control and evaluation are false. Clients cannot submit eligibility or capability overrides. A review cannot fabricate missing observations, actions or ground truth.

Scenario versions contain the source exploration, intended body, two supported robot models, duration, speed, seed, bounded reference-controller contract and a canonical SHA-256. They are immutable by ID. New Moon/Earth/Mars versions pin Apollo 17, Amboy Crater or Dingo Gap respectively. Older design-only versions remain immutable. An adaptation records both the original exploration world and the chosen execution world. The natural-language objective is retained for design review; only the existing scripted reference traverse executes.

`POST /api/episodes` accepts an optional `scenarioVersionId`. The API resolves that canonical record, rejects blocked worlds, validates the measured patch and compares the submitted settings with the frozen version before launching the worker. Added `lineage` is preserved in the local output JSON, `/episode/manifest` MCAP channel and Atlas metadata. Existing requests without the optional field retain their behavior and idempotency hash.

## Storage and endpoints

| Endpoint | Behavior |
| --- | --- |
| `POST /api/explorations/artifacts` | Raw bounded image/video bytes; matching media-type signature; server SHA-256; original GridFS storage |
| `GET /api/explorations/artifacts/:sha256` | Original bytes, MIME type and hash header; single explicit byte-range support for video playback |
| `POST /api/explorations` | Validate input and resolve every artifact before publishing an immutable record |
| `GET /api/explorations` / `/:id` | Latest 20 records / one canonical record |
| `POST /api/scenarios` | Compile and freeze bounded settings, with capability blockers |
| `GET /api/scenarios` / `/:id` | Latest 20 versions / one canonical version |

Exploration/scenario writes use UUID `Idempotency-Key` values, canonical input hashes and `$setOnInsert`; a changed payload using an existing ID returns 409. Metadata is in `world_model_explorations` and `scenario_versions`. These are authoring records, not a second physical-execution registry. Existing `runs` and `physics_episodes` identities are unchanged. GridFS uses `exploration_artifacts.files/chunks`, with a hash lookup index. Latest-record queries have creation-time/ID indexes.

Uploads are capped at 32 MiB, images at 8 MiB. Server signature checks and byte hashes establish storage integrity, not full media validity or scientific fidelity; the browser checks decodability. Upload buffers are bounded in process memory. Concurrent duplicate uploads may retain duplicate identical GridFS objects; hash-based lookup remains valid. An interrupted upload before publication can leave unreferenced chunks/files. A production orphan reconciler, resumable large uploads, quotas, retention and external artifact storage are not yet implemented.

## Validation evidence

- 171 TypeScript tests pass. Tests reject forged eligibility/execution fields, unsupported worlds/models, invalid hashes, bounds violations and mismatched frozen settings; Gemini configuration cannot enable the Genie execution gate.
- Live Atlas image round trip: 457,942 bytes, SHA-256 `f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170` preserved. A bytes 0–15 request returned 206 and exactly 16 bytes. Same-content retry returned the original exploration; changed content returned 409.
- A locally generated, explicitly non-Genie 320 × 180 WebM tested binary transport and hashing. Temporary transport artifacts were removed after confirming that no exploration referenced them. No real Genie-generated recording was available for semantic validation.
- The UI rejects an undecodable video before uploading any bytes. A saved lunar version has a disabled run action; the explicit Mars adaptation opens the lab with models/seed locked.
- Exploration `fa930621-956f-4f7a-a228-a79c16885f34` is a real saved prompt brief, clearly stating that no Google generation occurred. Its Mars adaptation is scenario `6c45c808-b220-4bc3-91dc-d037ca4148e3`.
- Physical episode `6854413f-df0a-4896-b40c-ff203127b21e` reused a previously measured Dingo Gap patch: 5 seconds, 2 robots, 51 state frames, 22 RGB/depth pairs, 125 MCAP messages. The 891,272-byte MCAP hash is `5debdf84d35f6d2c7825e6decee277ec0709446a0178b3f88f9113bfbc86f9c5`. Independent Python checks passed for schema, CRC/indexes, timing, model/terrain hashes, image decoding and depth arrays. Local JSON, Atlas and MCAP retain the same scenario/exploration lineage.

## Activation gates that remain

A future executable adapter must pin the official interface and model revision, verify actual account access/permitted use, and demonstrate actions, observations, reset, timing, recording access and task-specific validity. Do not enable it merely because a model name appears in a list or a web page opens. Measured mesh import and calibrated labels need independent evidence. No current record is approved for robot learning.

The service remains loopback-only. Project/tenant authentication, worker identity, policy-based artifact access and governed dataset admission are prerequisites for external deployment. The broader training roadmap is tracked separately; this adapter does not implement Isaac Sim, Cosmos, FiftyOne, semantic retrieval, dataset freezing or policy training.
