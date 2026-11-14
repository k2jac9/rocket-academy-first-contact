# Planetary globes, robot episodes, and Atlas

## Intent

The user wants the Moon, Mars, and Earth as complete globes, with generative AI orchestrating exploration robots and producing MCAP recordings for training workflows. MongoDB Atlas should manage the terrain catalog, robots, missions, plans, runs, and recording references. The first implementation exposed only the public local Dingo Gap site without a Cesium token; that reconstructed site is a ground patch and cannot serve as the planetary entry point.

## Chosen implementation

Open on a full Mars globe. Offer public NASA imagery on explicit reference spheres for Mars, Moon, and Earth, with Dingo Gap separately identified as a local Mars reconstruction. Preserve optional Cesium ion measured-terrain access for Moon/Mars. Public imagery is not a digital elevation model. The source catalog and mission contract must distinguish those surface representations, body radii, and geographic-registration limitations.

Add a bounded robot episode pipeline: mission and objective → baseline or Gemini plan → validated commands → deterministic kinematic execution → replay and indexed MCAP export. Atlas stores structured records and initially stores recording bytes in GridFS. A local episode and MCAP download remain available when external services are not configured; the UI must state that such a run is local and whether its planner was baseline or Gemini.

These are implementation decisions made from the user's requested outcome, not additional requirements attributed to them.

## Approaches considered

1. Require Cesium ion for all planetary views. This provides prepared terrain but repeats the current access blocker. Keep it as an optional detail layer.
2. Public imagery globes plus a distinct scientific-terrain layer. This provides an immediate full-body entry point and preserves the difference between visual context and measured elevation. Selected for this slice.
3. Build the full physics/training environment immediately. This would require collision meshes, robot dynamics, sensors, and calibrated terrain registration before the recording pipeline can be exercised. Instead, implement a clearly labeled kinematic engine behind a versioned run contract, then replace that engine with a physics worker.

The service uses the existing Node 24/TypeScript runtime and shared mission/run validators for this slice. Rust is the intended option for a later simulation worker; Rust tooling is not installed in this workspace, and introducing a second implementation of the data contract does not help this first integration.

## Viewer and mission contract

- Modes: `mars`, `moon`, `earth`, `dingo-gap`; default `mars`.
- Layers: `imagery` and `terrain`; Dingo Gap always resolves to terrain. Earth terrain is not offered until an actual provider is implemented.
- Reference spheres: Moon 1,737,400 m; Mars 3,396,190 m; Earth 6,371,000 m. These are declared modeling radii, not a claim of ellipsoidal geodesy or measured relief.
- Source coordinates remain native XYZ in metres. Globe display transforms are inverted for picking. Moon/Mars texture longitude registration remains unverified where the supplied texture metadata does not establish it.
- Mission schema advances to 2.0.0 to explicitly record layer, surface model, radius, and imagery provenance. This slice has no mission-import UI; old 1.0.0 files remain historical exports and are not silently reinterpreted.
- Provide a short example traverse on each reference sphere and a selectable start/goal workflow. Source or layer changes clear previous markers and episode state.

## Robot execution and MCAP

- Plans contain only `drive_to`, `wait`, `observe`, and `stop` commands. No generated code, arbitrary URLs, or executable tool payloads.
- Validate each plan before execution. Bound speed, command count, duration, waypoint coordinates, leg distance, and generated frame count.
- Execute fixed 0.2 s steps. Globe paths follow a shortest spherical arc, not a chord through the planet. Dingo follows a local linear proxy; no terrain-contact or obstacle-safety claim.
- Preserve mission/source identity, robot identity, planner kind/model/prompt, seed semantics, engine/version, commands, observations, poses, timestamps, and terminal result.
- Render episode playback from actual recorded positions. A playback speed multiplier changes viewing time, not recorded simulation timestamps.
- MCAP uses indexed uncompressed chunks, embedded JSON schemas, official Foxglove pose/frame/scene messages where appropriate, and custom mission/command/observation messages.
- Preserve an explicit transform between a small mission-local replay frame and source coordinates. Record `physicsValidated: false`, `terrainContactValidated: false`, `imageSensors: false`, and `trainingRun: false`.
- This slice prepares the recording/evaluation pipeline; it does not train a policy, produce camera/LiDAR observations, or demonstrate transfer to physical robots.

## Gemini orchestration

- Server-only `GEMINI_API_KEY`; configurable model. Use the current documented Google REST structured-output interface.
- Gemini creates a bounded high-level plan from a validated mission and objective. The deterministic executor applies its commands.
- Validate the returned JSON using the same plan validator as baseline runs; reject malformed, unsafe, oversized, incomplete, and refused outputs.
- No credentials in browser bundles, mission files, MCAP metadata, or errors. Missing access is an explicit status, never a silent switch presented as AI.

## Atlas architecture

- Collections: `terrain_sources`, `robots`, `missions`, `plans`, `runs`, `decision_events`.
- Initial recording bucket: GridFS `run_artifacts`; store recording SHA-256, byte length, schema/version, run ID, and source identity in run metadata.
- Service routes: status/catalog reads; create mission/plan/run; bounded run list/detail; download recording.
- Idempotency protects retries. Record writes use explicit schemas and whitelisted metadata; failed saves must not appear successful.
- Source and robot catalogs are upserted on explicit saves/runs. No paid cluster provisioning or account creation is included.
- Use `MONGODB_URI` and `MONGODB_DB` only in the local service. The initial service listens on loopback and restricts browser origins. Public deployment requires a separate authentication/authorization design.
- Do not use Earth-calibrated geospatial distance operations for Moon/Mars. Index body/source/frame and store native coordinates; perform body-aware calculations in the domain layer.
- Vector retrieval of similar failures and object-storage migration for larger sensor recordings are subsequent integrations, not claimed as implemented here.

## Acceptance and verification

All three public globes resolve without ion credentials; terrain layers keep honest source identity. A short mission runs, replays, and exports an MCAP file whose channels and message timestamps can be independently read. Atlas/Gemini missing-config states are visible; configured paths use real adapters with validation and bounded failures. Run domain, credential, file-integrity, and API tests, production build, independent review, and browser checks. If the hosted browser still disables WebGL, record that limit rather than presenting a successful rendering check.
