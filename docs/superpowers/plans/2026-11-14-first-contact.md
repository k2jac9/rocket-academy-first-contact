# First Contact Terrain Explorer Implementation Plan

> **For agentic workers:** Use the approved implementation plan task by task. Root coordinates independent domain and renderer work and reviews the integrated application.

**Goal:** Ship a real NASA terrain mission planner as the first Rocket Academy: First Contact build.

**Architecture:** React/TypeScript UI with NASA 3DTilesRendererJS, a strict mission manifest, and optional hosted planetary globes. Keep scientific sources and UI state separate from future physics/training services.

**Tech Stack:** React, TypeScript, Vite, Three.js, 3d-tiles-renderer, Vitest.

**Spec:** ../specs/2026-11-14-first-contact-design.md

## Global Constraints

- No secrets in source, logs or exported manifests.
- No undisclosed synthetic terrain or simulated training claims.
- Use the Mars/Moon body and reference frame explicitly.
- NASA source attribution remains visible.
- Stream upstream terrain; do not vendor large scientific assets.

## Review Focus

- Network errors and partial tile failures produce useful UI states.
- Tokenless Moon/Mars modes remain clear and recoverable.
- Scene switching/unmounting cancels pending work and disposes GPU resources.
- Terrain markers and exports retain consistent axes and units.
- Keyboard users and narrow screens can operate mission controls.

### Task 1: Source catalog and mission contract

**Files:** src/domain/mission.ts; src/domain/mission.test.ts

- [x] Define the source catalog, types and manifest contract.
- [x] Add meaningful tests for malformed coordinates, body mismatch and token exclusion.
- [x] Implement export validation and stable source identifiers.
- [x] Run focused tests.

### Task 2: NASA terrain renderer

**Files:** src/terrain/TerrainScene.tsx; src/terrain/types.ts

- [x] Verify source datasets and current renderer APIs.
- [x] Implement public Dingo Gap loading, orbit controls and marker placement.
- [x] Add optional Moon/Mars ion content, loading/error states and lifecycle cleanup.
- [x] Verify interface states in a browser and pass type checking.
- [ ] Verify live terrain rendering and pointer/keyboard picks in a WebGL-capable browser; hosted QA graphics are disabled.

### Task 3: Mission interface and repository

**Files:** src/App.tsx; src/styles.css; src/main.tsx; package.json; README.md; .github/workflows/ci.yml

- [x] Bootstrap a reproducible Vite build and accessible mission UI.
- [x] Wire renderer state, source selector, token settings, mission actions and JSON export.
- [x] Document exact setup, data attribution, limitations and next steps.
- [x] Run production build, domain tests and browser checks.
- [x] Obtain an independent code review and fix material findings.
- [x] Commit and push to the authorized new private GitHub repository.

## Verification record

See [the first-slice verification report](../../qa/2026-11-14-verification.md) for completed checks, review fixes, and the remaining live WebGL validation.
