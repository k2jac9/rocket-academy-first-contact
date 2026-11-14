# Planetary Runs and Atlas Implementation Plan

> **For agentic workers:** Root coordinates the authorized implementation with independent renderer, episode/MCAP, and service work. Shared contracts below take precedence over guessed interfaces. Review and verify the integrated branch before publication.

**Goal:** Open full Moon/Mars/Earth globes and create replayable, exportable robot episodes with Gemini planning and Atlas persistence adapters.

**Architecture:** React/Three.js viewer; shared TypeScript mission and bounded episode contracts; MCAP writer; loopback Node service for Gemini and MongoDB Atlas/GridFS. External integrations report their configuration and connection state explicitly.

**Tech Stack:** Existing Node 24/React/TypeScript/Three.js, official `@mcap/core` and `@foxglove/schemas`, official `mongodb` driver, Google REST API.

**Spec:** ../specs/2026-11-14-planetary-runs-atlas-design.md

## Global constraints

- No provider secrets in frontend code, logs, exports, or recordings.
- Public imagery spheres must never be represented as measured relief.
- Source-frame coordinates and body identity remain attached to every artifact.
- Kinematic execution is explicitly unvalidated for physics, contact, and training.
- Shared files have one owner; root integrates and publishes.

## Review focus

- Provider/schema failures cannot execute arbitrary actions or hide a planner fallback.
- Changing source, layer, or markers invalidates a plan and its episode.
- MCAP time, source/local frame transforms, and recorded terminal outcomes must agree.
- Atlas save retries cannot create duplicate runs or report an unsuccessful save as successful.
- Missing credentials and WebGL must leave useful, truthful recovery paths.

### Task 1: Source and mission contract (root)

- [x] Add explicit imagery/terrain source variants, Earth, reference radii, and schema 2.0.0.
- [x] First reproduce missing Earth/public-globe behavior in tests, then implement and run the contract suite.
- [x] Add short reference-sphere example missions without claiming surveyed coordinates.

### Task 2: Globe and episode rendering (terrain agent)

- [x] Consume `getSource(mode, layer)` fields `geometryKind`, `radiusM`, and `imageryUrl`.
- [x] Add public reference spheres, native-frame picks, optional ion terrain, and resource cleanup.
- [x] Extend scene props with `layer`, `robotPosition`, `trajectory`, and `focusMissionSignal`.
- [x] Verify coordinate transforms, sphere picks, view resets, and lifecycle states.

### Task 3: Episode and MCAP (mission agent)

- [x] Implement and test strict `MissionPlan` validation, baseline planning, and `runMission`.
- [x] Enforce 0.2 s steps, 2 m/s speed, 1,000 m leg, 1,800 s duration, and 10,000 frame limits.
- [x] Implement `encodeRunMcap` and indexed readback; verify independently with Python where available.

### Task 4: Gemini and Atlas service (service agent)

- [x] Implement status/catalog/missions/plans/runs/recording endpoints under `server/`.
- [x] Consume the shared mission/plan validators and episode/MCAP implementation.
- [x] Add bounded structured Gemini output and explicit unconfigured errors.
- [x] Add Atlas records, GridFS recordings, checksums, indexes, and retry-safe saves.
- [x] Test API validation, credential redaction, provider failures, origins, and persistence boundaries.

### Task 5: Interface and delivery (root)

- [x] Wire planet/layer controls, example traverse, baseline/Gemini planner, replay, MCAP download, and Atlas saves/history.
- [x] Add service startup/proxy, environment examples, data architecture, and precise setup documentation.
- [x] Run full tests/build, independent review, source access checks, and available browser checks.
- [x] Publish the tested source and verify GitHub CI; state live-provider and graphics verification limits.

Implementation and verification are complete. Source commit `28c8aa4f9a12aabce249af67ba27a20f00e2ed40` was published to `main`; [GitHub CI](https://github.com/k2jac9/rocket-academy-first-contact/actions/runs/43623051337) passed installation, tests, and build. See [the v0.2 QA report](../../qa/2026-11-14-planetary-runs-atlas.md) for observed results and remaining live-provider/graphics limits.
