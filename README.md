# Rocket Academy: First Contact

Plan a planetary rover mission on real terrain, choose a start and a science goal, and export the coordinates with their scientific provenance. First Contact is the first implemented slice of Rocket Academy: a React and TypeScript mission workspace using Three.js and NASA’s 3D Tiles renderer.

**Current scope: a terrain mission planner.** The application streams the public NASA Dingo Gap reconstruction and supports optional Cesium ion Moon and Mars terrain. It includes source inspection, marker placement, camera controls, loading and failure states, and a versioned JSON mission export. Physics simulation, terrain safety assessment, robot training, MCAP, MongoDB Atlas, Google Earth Engine, Meteomatics, and Genie integrations are not implemented.

Repository: [k2jac9/rocket-academy-first-contact](https://github.com/k2jac9/rocket-academy-first-contact). Repository access is private; there is no public deployment configured in this slice.

## Run locally

Use **Node.js 24** and npm. A WebGL-capable browser with hardware acceleration and access to the upstream terrain hosts is required for the 3D view. Dingo Gap does not require an account or token.

```bash
git clone https://github.com/k2jac9/rocket-academy-first-contact.git
cd rocket-academy-first-contact
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. Access to the private repository is required to clone it. The development server binds to `0.0.0.0`; use `npm run dev -- --host 127.0.0.1` if it should be reachable only from your machine.

```bash
npm test
npm run typecheck
npm run build
npm run preview
```

`npm run build` type-checks and creates the production frontend in `dist/`. `npm run preview` serves that build locally. The GitHub Actions workflow runs `npm ci`, unit tests, and the production build on pushes and pull requests.

## Optional Moon and Mars access

Create a **restricted, read-only public browser token** in [Cesium ion](https://ion.cesium.com/tokens). Allow only the required assets and the URLs where the app will run, including the development origin when needed. The catalog uses Moon asset `2684829` and Mars asset `3644333`; account access and the applicable provider terms still apply.

The simplest setup is **Connection settings → Cesium ion read-only token → Save connection**. The app keeps a token entered there in React state for the current page session. It does not write it to browser storage or mission exports. Reloading the page clears a session-entered token.

For a configured development or deployed build, copy `.env.example` to `.env.local` and set:

```dotenv
VITE_CESIUM_ION_TOKEN=your_restricted_public_browser_token
```

Restart Vite after changing the file. **Every `VITE_` value used by this app is delivered to the browser; a production build embeds this token in its JavaScript.** Use a token intended for public clients, never a secret, administrator token, or unrestricted credential. Removing a build-time token requires changing the environment and rebuilding. A token supplied through the session UI overrides the configured token until the next page load.

Without a token, the Moon and Mars modes show a connection prompt. The public Dingo Gap mode remains available.

## Make a mission

1. Choose **Dingo Gap**, **The Moon**, or **Mars** and wait for visible terrain.
2. Choose **Place rover** and select a point on the loaded surface.
3. Choose **Set goal** and select a second surface point.
4. Name the mission and select **Export mission** to download its JSON manifest.

Changing destinations clears the markers. **Clear markers** resets the current plan. The dashed connection and distance card show straight-line separation; they do not describe a traversable or safe terrain route. On planetary globes, the distance is a chord through 3D space, not a geodesic or surface distance.

### Controls

Keyboard controls operate when the terrain canvas has focus. Use Tab to reach it, or click inside the view.

| Action | Control |
| --- | --- |
| Orbit or navigate the view | Drag; arrow keys orbit |
| Zoom | Mouse wheel; `+` / `−` |
| Pan across the local Dingo Gap site | **Shift + arrow keys** |
| Place the active marker with a pointer | Click visible terrain after choosing Place rover or Set goal |
| Place the active marker with a keyboard | Move terrain under the center reticle, then press **Enter** or **Space** |
| Reset the camera | **Home**, or the reset icon in the view |
| Cancel placement | Select the active placement tool again, or its cancel button |

The local panning controls make it possible to choose different Dingo Gap points with the keyboard. On the Moon and Mars globes, Shift + arrows increases the orbit step. Placement uses a ray cast against loaded source terrain; an empty part of the view does not create a marker.

## Terrain sources and coordinates

| Mode | Source identity | Coordinate contract | Access |
| --- | --- | --- | --- |
| Dingo Gap | NASA/JPL Curiosity Dingo Gap, colorized ground tileset; release `URS297920` | Native local XYZ, metres, right-handed; geographic directions and geodetic tie are unverified | Public upstream tiles |
| Moon | Cesium ion asset `2684829` | Provider-defined Moon body-fixed XYZ, metres, right-handed | Restricted ion browser token |
| Mars | Cesium ion asset `3644333` | Provider-defined Mars body-fixed XYZ, metres, right-handed | Restricted ion browser token |

The source catalog lives in [`src/domain/mission.ts`](src/domain/mission.ts). Source detail, credits, and provider links are also visible in the application.

### Dingo Gap provenance

The renderer streams the colorized ground reconstruction from [NASA-AMMOS/3DTilesSampleData](https://github.com/NASA-AMMOS/3DTilesSampleData/tree/76444abbb4faff1b05f46a09b81ca2c24602b333/msl-dingo-gap), pinned to commit:

```text
76444abbb4faff1b05f46a09b81ca2c24602b333
```

The catalog and exported manifest include the complete pinned tileset URL and geometry identifier. The upstream dataset description identifies rover and orbital imagery processed through the Landform pipeline. Ground resolution is not specified in this catalog; visual detail varies with the reconstruction and streamed tile level.

Display rotation does not alter exported positions. For Dingo Gap, the view applies an X rotation of `+π/2`, so display XYZ is `(source.x, -source.z, source.y)`. Picks are transformed back to source XYZ before storage and export. Source +Z therefore points downward after this display orientation. No surveyed planetary origin, latitude/longitude conversion, or north/east alignment is asserted for this local reconstruction.

### Hosted planetary terrain

[Cesium Moon](https://cesium.com/platform/cesium-ion/content/cesium-moon/) and [Cesium Mars](https://cesium.com/platform/cesium-ion/content/cesium-mars/) document their component datasets, regional resolutions, and usage terms. The viewer applies an X rotation of `−π/2` for display, then transforms picked points back into the native body-fixed source frame. The provider defines the meridian and body reference; this application does not independently calibrate that registration.

The hosted asset IDs identify a service dataset, **not an immutable geometry snapshot**. Exports mark their revisions as `provider-managed-unpinned` with a null source revision. Even the pinned Dingo tileset is used here as view-dependent visualization: the manifest does not identify a fixed collision mesh or guarantee identical active tile geometry across cameras and sessions.

## Mission export contract

Exports use schema `rocket-academy.mission`, version `1.0.0`. The contract records:

- Mission name, canonical UTC creation time, destination mode, and celestial body.
- Source provider, source URL, dataset release and revision status, geometry identity, and attribution.
- Native coordinate frame, axis descriptions, handedness, origin description, and metre units.
- Rover and goal XYZ positions and their Euclidean straight-line separation.
- Explicit planning limits: `status: "planned"`, `terrainSafetyValidated: false`, `physicsValidated: false`, and `trainingRun: false`.

`createMissionManifest` copies an approved set of fields and excludes token or unrelated application state. `validateMissionManifest` rejects unsupported fields, incompatible source/body/frame metadata, missing markers, non-finite coordinates, and inconsistent distances. It also applies broad local/body-radius bounds to catch obvious frame mistakes. These bounds do not verify terrain intersection, navigation safety, or geographic accuracy.

The current validator supports the sources and schema in the shipped catalog. A future source or schema change needs an explicit compatibility or migration decision. This slice exports plans; it does not yet provide a mission import UI or persist mission state to a backend.

## Architecture

| Area | Responsibility |
| --- | --- |
| [`src/App.tsx`](src/App.tsx) | Mission state, destination selection, connection settings, source dialogs, and downloads |
| [`src/domain/mission.ts`](src/domain/mission.ts) | Typed source catalog, manifest construction, validation, and distance calculation |
| [`src/terrain/TerrainScene.tsx`](src/terrain/TerrainScene.tsx) | Three.js scene, NASA tile streaming, cameras, source-space picking, markers, and cleanup |
| [`src/terrain/ion.ts`](src/terrain/ion.ts) | Abortable ion access, scoped tile authorization, shared credential refresh, and provider credits |
| [`src/terrain/navigation.ts`](src/terrain/navigation.ts) | Local keyboard panning |
| [`src/terrain/startupDeadline.ts`](src/terrain/startupDeadline.ts) | Retryable startup timeout state |
| [`src/components/Dialog.tsx`](src/components/Dialog.tsx) | Accessible application dialogs |
| [`src/styles.css`](src/styles.css) | Responsive mission workspace styling |

The source service supplies terrain directly to the browser. Scene replacement and unmounting abort pending work and dispose renderer resources. The interface distinguishes missing-token, loading, ready, and error states; terrain failure never substitutes undisclosed synthetic geometry.

## Verification and troubleshooting

Unit tests and the production build pass for this implementation. Tests cover the mission contract, coordinate sanity, credential exclusion and request scoping, startup timeout behavior, and keyboard panning.

**Live 3D verification is still pending in a WebGL-capable browser.** The hosted QA browser had WebGL disabled, so that environment could exercise the interface and graphics-unavailable behavior but could not establish successful live terrain rendering, surface picks, or an end-to-end export from live picks. Automated contract tests and a successful build do not close that gap.

Before treating a deployment as validated, use a browser with working WebGL to load Dingo Gap, place two distinct surface markers with both pointer and keyboard controls, and inspect the exported native coordinates and source revision. Then exercise scene switching, retry, a narrow viewport, and the optional hosted globe modes with an authorized token.

| Symptom | Next step |
| --- | --- |
| WebGL cannot start | Enable hardware acceleration or use a WebGL-capable browser, then retry |
| Dingo Gap does not load | Check network access to `raw.githubusercontent.com`, then use Retry connection |
| Moon or Mars requests a connection | Add a restricted ion browser token |
| An ion connection fails | Check asset access and allowed URLs for the actual application origin, then retry |
| Some terrain is visible but details fail | Inspect the warning and retry terrain to reload missing detail |
| Loading exceeds the startup deadline | Check network/source access and retry; a late successful render can still recover |
| A marker is not placed | Choose a placement tool and select visible loaded terrain, or move terrain under the center reticle |

Detailed evidence and the observed browser state are recorded in [the verification report](docs/qa/2026-11-14-verification.md).

## Next slice: a reproducible simulation terrain

1. **Prepare a fixed terrain asset from an original scientific DEM.** Record the source product and checksum, body and coordinate reference, horizontal and vertical units, origin and transform, crop bounds, resolution, and no-data policy. Generate a deterministic visual mesh and collision mesh, with a checksum and transformation record for each. Resolve registration uncertainties before connecting local reconstructions to planetary coordinates.
2. **Introduce a Rust mission service.** Validate the mission contract at the API boundary and register immutable terrain assets. A small initial API can create terrain preparation jobs, store missions, and launch runs by explicit mission and terrain IDs. Keep source data, preparation parameters, and derived artifact hashes together.
3. **Add a bounded simulation run.** Start with known rover dimensions, mass, wheel/contact parameters, and a deterministic initial state on the fixed collision mesh. Verify basic contact, slope, and distance behavior against controlled cases before adding route safety or training claims.
4. **Record and replay runs with MCAP.** Define versioned schemas for timestamps, frame transforms, rover state, commands, and observations. Include mission and terrain identities so a recording can be replayed against the exact geometry and configuration used.
5. **Catalog missions and runs in MongoDB Atlas.** Store searchable metadata and links to immutable artifacts and MCAP recordings. Introduce external enrichment services only with a defined need, supported planetary coverage, and traceable provenance.

The transition to simulation starts with the terrain asset and coordinate contract. A visually convincing hill is not yet a collision model.

## Licensing and attribution

The application code is licensed under **[Apache-2.0](LICENSE)**. Third-party libraries retain their own licenses. **That code license does not license NASA/JPL sample terrain, component scientific imagery, or Cesium-hosted content.** Dataset attribution, provider account terms, and any redistribution permissions must be evaluated separately.

This repository streams upstream terrain and does not vendor the scientific tile payloads. See [`NOTICE.md`](NOTICE.md) for source credits, upstream references, and the distinction between software and data terms.
