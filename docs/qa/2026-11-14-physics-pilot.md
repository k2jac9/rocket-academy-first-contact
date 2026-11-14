# Local map and multi-robot physics pilot — 2026-11-14

Validated locally on Windows, Node 26.13.0, MuJoCo 3.3.7 and Python 3.12.10. Source changes remain local. The existing Atlas configuration and server-only Gemini configuration were preserved.

## Delivered

- Dingo Gap map is the default workspace, with pan, cursor zoom, orbit toggle, top view, bearing reset, keyboard controls and reduced-motion-aware camera transitions.
- Separate Explore worlds / Robot lab views. Hidden scenes pause rendering after loading. Mars, Moon and Earth overview images are served locally; their reference spheres remain explicitly distinct from measured elevation.
- Robot menus independently select four-wheel scouts or six-wheel survey rovers. The pilot runs two instances in a shared contact world on a complete frozen 65 × 65 Dingo Gap heightfield.
- State/action recording, RGB/depth camera pairs, Atlas metadata, GridFS MCAP, verified local download cache, stored-state replay, camera previews and saved episode history.

## Evidence

The UI generated and saved `e08d73b5-1c45-4ad7-88f1-2bb0f8bfce75`, with the default model order reversed through the menus:

- Robot 1: six-wheel surveyor. Robot 2: four-wheel scout.
- Duration: 5 seconds, `duration_reached`.
- 51 shared-time state frames, 22 RGB/depth pairs, 125 MCAP messages.
- Zstandard-compressed MCAP: 1,017,520 bytes.
- SHA-256: `3026ea76cfed582e31784c0f6d651a4138cd70c0b278f46cf1e69c9794bcb0f9`.
- A separate Node process read the complete artifact directly from Atlas GridFS and verified its hash. The browser Download MCAP action also completed successfully.
- Python's independent MCAP reader checked indexes, CRCs, embedded JSON schemas, per-channel sequences, shared-clock timestamps, both robot identities, terrain/model hashes, PNG decoding, and metric depth array size/finiteness.

Two earlier 12-second pilot episodes were also saved. The first encountered a transient database pool timeout; its retained local result was recovered into Atlas. Subsequent UI generation/save completed normally. Large uncompressed GridFS downloads were slow on this connection; new recordings use Zstandard, hash-checked local caching, and a bounded longer remote streaming deadline. This is a local service, not a distributed durable job queue.

## Checks

- 141 TypeScript tests passed; production build passed. A non-fatal main-bundle size warning remains.
- 6 Python physics checks passed: rest/contact, driven motion and repeatability, independent model selection, heightfield axes/scale, robot-to-robot collision, and RGB/depth geometry against a known plane.
- Browser: drag pan, keyboard orbit, zoom, top view and reset; all three overview images loaded; view switching preserves the intended map/lab separation.
- Desktop 1600 × 1000 and mobile 390 × 844 layouts inspected. No horizontal overflow. A mobile selector-specificity issue was corrected so the map is hidden while the lab is active.
- Screenshots and downloaded recordings are in ignored `playwright-report/` for local review.

## Limits

Physics is currently restricted to Dingo Gap. Moon/Earth physics terrain adapters remain unimplemented. The robots, rigid wheels, uniform friction, terrain sampling and clean synthetic sensors are experimental; no photorealism, physical-robot calibration, downstream training benefit or sim-to-real transfer is claimed. The controller runs at 200 Hz while state/action samples are recorded at 10 Hz. Camera samples are 128 × 96 at 2 Hz.
