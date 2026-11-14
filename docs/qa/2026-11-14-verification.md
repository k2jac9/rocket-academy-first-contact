# First terrain-planner verification

Date: 2026-11-14

## Completed checks

- `npm test`: **56 tests passed across four files**.
- `npm run build`: passed TypeScript checking and the Vite production build.
- NASA Dingo Gap root tileset and representative B3DM tile: accessible over HTTPS with cross-origin access; the sampled payload was a valid B3DM v1 file. This checks source access, not rendering.
- Browser interface: Dingo/Moon destination switching, scientific source details, missing-token state, empty connection submission, keyboard help, Escape dismissal, disabled placement/export before terrain readiness, and actionable WebGL failure/retry state.
- Independent code review completed; material findings were addressed before the first implementation commit.

## Review fixes

- Partial terrain-detail failures expose a retry action that preserves mission name and coordinates.
- Shift + arrows pan the local camera and target together. A visible center reticle supports keyboard placement. Regression tests use real Three.js geometry and raycasting to confirm distinct center picks.
- Unsupported ion `TERRAIN` and `CZML` endpoints are rejected; this slice uses planetary `3DTILES` assets.
- A startup deadline keeps an actionable error visible when metadata arrives after the timeout and content remains stalled. Actual visible readiness may recover automatically.
- Terrain bearer credentials, refresh, and content-version parameters are confined to the exact issued HTTPS origin. Cross-origin incoming authorization headers are removed.
- Major terrain-state transitions have concise live announcements. The layout permits 320-pixel viewports; narrow-width visual validation remains pending.

## Remaining validation

The managed QA browser reports disabled WebGL graphics. It could not render live terrain, so **live surface picks and a complete export from those picks remain unverified**. The screenshot below records that observed state, not a successful terrain render.

![Mission-planner interface showing the WebGL-unavailable recovery state](first-contact-ui.jpg)

On a WebGL-capable browser, confirm:

1. Dingo Gap reaches terrain-ready with visible streamed geometry.
2. Pointer placement produces two distinct native-coordinate markers and a valid export.
3. Keyboard panning and center placement produce distinct intended markers.
4. Source switching during loading cancels prior work cleanly.
5. Failed detail tiles expose a working retry without losing mission data.
6. Moon and Mars assets load with an appropriately restricted, authorized ion token.
7. Mission controls and dialogs remain usable at 320 pixels and with browser zoom.

## Build notes

The initial JavaScript bundle is approximately 1,012 kB minified / 273 kB gzip. Vite emits a chunk-size warning; splitting the terrain engine into a deferred chunk is a later performance improvement. The build completes successfully.

The local npm environment emits an `http-proxy` configuration warning. No application credentials or private terrain tokens were configured for these checks.
