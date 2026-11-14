# Rocket Academy: First Contact

## Intent and approved direction

Build the first working planetary mission-planning slice described in the conversation: NASA terrain in an interactive browser, visible scientific provenance, rover and goal placement, and a path to a fixed simulation terrain asset. The user approved implementation and explicitly requested a new repository on November 14, 2026.

## Approaches considered

- NASA MMGIS: complete planetary GIS, with a larger application/PostGIS deployment.
- CesiumJS: strong geospatial viewer with prepared Moon and Mars content.
- NASA 3DTilesRendererJS: selected for a custom React/Three.js mission interface and reusable local/global terrain rendering.

## First deliverable

React + TypeScript + Vite frontend with a real streamed NASA Dingo Gap site, terrain loading/error states, orbit controls, rover/start and goal markers, source/provenance panel, a downloadable versioned mission manifest, and Moon/Mars globe modes using an optional Cesium ion token. A bounded, clearly labeled route rehearsal may visualize the proposed traverse, but must not be presented as physics, training, or a verified safe route.

## Constraints

- A missing ion token must not block the public NASA Dingo Gap site.
- A failed terrain request must show an actionable error; never replace it with undisclosed synthetic terrain.
- No embedded credentials. Browser ion tokens are intentionally public, should be read-only and domain-restricted, and must not be stored in mission exports.
- Data provenance, body, frame, axes, units, source URL, source revision and geometry identity belong in the mission manifest.
- Visual tile LOD is not the authoritative collision terrain.
- No claim of MCAP ingestion, MongoDB connectivity, robot learning, or physically calibrated simulation until implemented and verified.
- Existing research links and public sample access do not automatically grant redistribution rights. Stream upstream assets and retain attribution.
- Responsive keyboard-accessible UI with a coherent mission-control visual style.

## Architecture

`src/domain/mission.ts` owns the typed source catalog, markers and manifest validation. `src/terrain/TerrainScene.tsx` owns all Three.js/NASA renderer lifecycle. `src/App.tsx` owns product state, controls and panels. The terrain source can be swapped without changing the exported mission contract. A future Rust service prepares a fixed DEM/mesh from original scientific data; Atlas catalogs runs and MCAP records observations.

## Verification

Build and type-check the production app. Test manifest body/frame/unit validation, exclusion of tokens, bounded marker handling, and source identity. Exercise the actual browser for NASA terrain loading, marker interaction, mission export, no-token globe state, retry behavior and narrow layouts. Inspect failures before choosing any fallback.
