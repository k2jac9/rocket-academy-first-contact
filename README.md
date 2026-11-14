# Rocket Academy: First Contact

Explore Mars, the Moon, and Earth as complete globes, choose a robot mission, rehearse a bounded traverse, and export the episode as MCAP with its source and coordinate provenance.

**Version 0.2 opens on a full Mars globe without an account or token.** Public NASA imagery supplies the three globe overviews. Dingo Gap remains a separate, real local reconstruction on Mars; optional Cesium ion layers provide streamed Moon and Mars terrain. The robot executor is a deterministic **kinematic prototype**. Its recordings contain commands, poses, and derived state observations; contact physics, camera/LiDAR sensors, and policy training are future work.

The repository is [k2jac9/rocket-academy-first-contact](https://github.com/k2jac9/rocket-academy-first-contact). This slice is designed for local development. The Node API is bound to loopback and has no public-user authentication layer.

## Run locally

Use **Node.js 24** and npm. The 3D view needs a WebGL-capable browser with hardware acceleration. Public imagery and Dingo Gap need no credentials; remote imagery and tiles still require network access.

```bash
git clone https://github.com/k2jac9/rocket-academy-first-contact.git
cd rocket-academy-first-contact
npm ci
npm run dev
```

`npm run dev` starts both Vite and the Node API on loopback by default. Open the Vite URL, normally `http://127.0.0.1:5173`. The API listens at `http://127.0.0.1:8787`; Vite proxies `/api` to it. Both services are reachable only from the local machine with these defaults.

A missing `.env.local` is valid: public globes, the baseline planner, local episodes, replay, mission JSON, and MCAP downloads remain available. Gemini planning and Atlas persistence require the optional server configuration below. A local episode lives in page memory until it is downloaded or an Atlas run is saved; reloading the page does not preserve it.

## Try a 20 m episode

1. Open Mars, the Moon, or Earth with the **NASA globe** imagery layer.
2. Select **Load 20 m example**, or choose **Place rover** and **Set goal** to select nearby surface points. The example provides valid coordinates even when the current browser cannot render WebGL.
3. Select **Baseline plan**. Review the initial observation, drive, and final observation commands. The baseline drives at 0.75 m/s and does not call a generative model.
4. Select **Run locally**. The executor creates a bounded sequence of recorded states; it does not send motion commands to a physical robot.
5. Replay the recorded episode and inspect the rover position and trajectory. Playback speed affects viewing time, not the recorded timestamps.
6. Select **Export MCAP** to download the episode. **Export plan JSON** separately downloads the planned mission manifest.
7. With the optional services configured, choose **Gemini plan** for a model-generated proposal, or **Run & save to Atlas** to execute the validated plan on the server and store its run and recording.

The example is a 20 m arc on the application's declared reference sphere. It starts at native `(radius, 0, 0)` and moves toward native +Y along the equator. It does not identify a surveyed landing site or prove that a 20 m stretch of the displayed imagery is traversable. The overview images are much coarser than rover-scale detail.

Changing the source, layer, markers, or objective invalidates the corresponding plan and episode. A Gemini failure is reported explicitly; the application does not silently relabel a baseline plan as AI. **Run & save to Atlas creates a server episode from the mission and plan, rather than uploading a previously recorded browser episode.** Its run identifier and start time belong to that saved execution.

### View controls

Keyboard controls operate when the canvas has focus. Tab to it or click inside the view. An active placement tool shows a center reticle.

| Action | Control |
| --- | --- |
| Orbit or navigate | Drag; arrow keys |
| Zoom | Mouse wheel; `+` / `−` |
| Pan across Dingo Gap | **Shift + arrow keys** |
| Move faster around a globe | **Shift + arrow keys** |
| Place a marker with a pointer | Choose a placement tool, then click the visible surface |
| Place a marker with a keyboard | Move the surface under the reticle, then press **Enter** or **Space** |
| Reset to the complete globe or local site | **Home**, or the reset control |
| Cancel placement | Select the active placement tool again, or its cancel control |

Imagery-layer picks use an exact mathematical sphere. Terrain-layer picks use loaded terrain geometry. Clicking empty space does not create a marker. If an image fails to load, the view explicitly reports **Reference sphere only**; the plain sphere can still support a kinematic example. No measured terrain is invented to replace a failed tile request.

## Surfaces and scientific provenance

| View | Data | Surface model | Access |
| --- | --- | --- | --- |
| Mars imagery, default | NASA Mars texture, 1440 × 720; Viking imagery processed at USGS | Reference sphere, radius **3,396,190 m**; no elevation | Public remote image |
| Moon imagery | NASA LRO CGI Moon Kit, 2048 × 1024 | Reference sphere, radius **1,737,400 m**; no elevation | Bundled, unaltered image with SHA-256 |
| Earth imagery | NASA Blue Marble Next Generation, July 2004, 5400 × 2700 | Reference sphere, radius **6,371,000 m**; no elevation | Public remote image |
| Dingo Gap | NASA/JPL Curiosity colorized ground reconstruction, release `URS297920` | Streamed local 3D tiles on Mars | Public upstream tiles |
| Moon terrain | Cesium ion asset `2684829` | Provider's streamed planetary terrain | Restricted ion browser token |
| Mars terrain | Cesium ion asset `3644333` | Provider's streamed planetary terrain | Restricted ion browser token |

Earth terrain is not implemented. Blue Marble is a static image, not live weather or a WGS84 ellipsoid. The lunar color map is processed for visual presentation; it is not the accompanying LOLA displacement map. Imagery detail, terrain geometry, and authoritative collision geometry are separate inputs.

The [source catalog](src/domain/mission.ts) is the application authority for URLs, radii, frame descriptions, and supported source/layer combinations. [NOTICE.md](NOTICE.md) records asset links and credits, including the bundled Moon file's checksum. The upstream descriptions are [NASA Mars Image Texture](https://science.nasa.gov/3d-resources/mars/), [NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), and [NASA Blue Marble base maps](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/).

### Coordinates and revision identity

Reference globes use right-handed, body-centered XYZ in metres, with +Z toward the north pole. The model convention is:

```text
x = radius × cos(latitude) × cos(longitude)
y = radius × cos(latitude) × sin(longitude)
z = radius × sin(latitude)
```

Moon and Earth imagery have approximate spherical registration. Mars texture longitude registration is not established by this application. These are declared modeling frames, not a claim of surveyed geodesy. The display applies an X rotation of `−π/2`, and picks are transformed back to native source coordinates before storage. The sphere's radius is enforced by the mission validator.

Dingo Gap uses the native local XYZ frame of the [pinned NASA dataset](https://github.com/NASA-AMMOS/3DTilesSampleData/tree/76444abbb4faff1b05f46a09b81ca2c24602b333/msl-dingo-gap). Its revision is `76444abbb4faff1b05f46a09b81ca2c24602b333`. The display applies an X rotation of `+π/2`, mapping source XYZ to `(x, -z, y)`; source +Z points downward in that view. No geographic origin, north/east alignment, or latitude/longitude conversion is asserted for the local reconstruction.

Optional ion terrain retains provider-defined body-fixed coordinates. Asset IDs identify hosted datasets, not immutable snapshots, so exports mark these sources `provider-managed-unpinned`. The Mars texture is pinned to a NASA repository commit; the bundled Moon image is pinned by its bytes; the Earth image URL is not an immutable revision. Streamed tile level of detail is view dependent and is never recorded as a fixed collision mesh.

Mission JSON uses `rocket-academy.mission` schema **2.0.0**. It records the source/layer, surface model, radius, imagery provenance, native frame, units, marker positions, and explicit unvalidated simulation flags. It excludes credentials and unrelated application state. The validator rejects unsupported fields, mismatched provenance, invalid coordinates, and inconsistent distances. The current UI has no mission-import workflow; historical 1.0.0 exports are not silently migrated.

The mission's distance card and dashed connection use **Euclidean chord distance**. Globe execution follows a shortest spherical arc with interpolated endpoint radii; Dingo execution uses a straight line in local source coordinates. Neither execution samples terrain contact, slope, obstacles, or hazards, including when a measured terrain layer is visible.

## Plans, runs, and MCAP

Both planners produce the same versioned plan: a rationale and a sequence containing only `drive_to`, `wait`, `observe`, and `stop`. Shared validation runs before execution in both the browser and server. Generated code, arbitrary tools, and external action URLs are not accepted commands.

| Current execution bound | Value |
| --- | --- |
| Fixed simulation step | **0.2 s** |
| Drive speed | **0.01–2 m/s** |
| Maximum individual drive leg | **1,000 m** |
| Maximum planned duration | **1,800 s** |
| Maximum recorded frames | **10,000** |
| Maximum plan commands | **32** |
| Goal tolerance | **0.05 m** |

The engine is `first-contact-kinematic/1.0.0`. It records planner kind, optional model/objective, commands, command events, source and local poses, observation labels, timestamps, and terminal result. A seed is retained for forward compatibility and explicitly marked `unused-deterministic`; the current executor has no stochastic dynamics. An `observe` command records derived kinematic state with `synthetic: true`, not a camera image or a physical measurement.

MCAP exports use indexed, uncompressed chunks, UTF-8 JSON messages, and embedded JSON schemas. The robot is represented by a generic geometric symbol. Official Foxglove schemas describe poses, frame transforms, and the robot scene; application schemas describe the mission, commands, state, observations, and result.

| MCAP topic | Contents |
| --- | --- |
| `/mission/run` | Mission/source identity, plan, planner, engine, seed semantics, and replay-frame metadata |
| `/mission/commands` | Command start/completion events |
| `/tf` | `terrain_source` → `mission_local` → robot transforms |
| `/robots/rover-1/pose` | Foxglove pose in the small mission-local frame |
| `/robots/rover-1/state` | Native and local state, speed, goal distance, and command index |
| `/robots/rover-1/observations` | Explicitly synthetic kinematic observations |
| `/scene/robot` | Foxglove scene representation of the rover symbol |
| `/mission/result` | Terminal outcome and remaining goal distance |

The mission-local replay frame is derived from the start and goal, with X forward, Y left, and Z up. Its explicit origin and quaternion connect it to the native source frame. MCAP timestamps use the recorded UTC start plus simulation elapsed time. Files can be inspected with compatible MCAP/Foxglove readers; the app does not yet import arbitrary MCAP recordings.

Every run records `physicsValidated: false`, `terrainContactValidated: false`, `imageSensors: false`, and `trainingRun: false`. MCAP establishes a recording and replay path; it does not by itself make the data suitable for robot training.

## Optional service configuration

Copy the example once, fill in the integrations you want, and restart the development command:

```bash
cp .env.example .env.local
```

| Variable | Where it is used | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Node server only | Atlas database-user connection string |
| `MONGODB_DB` | Node server only | Dedicated application database; the example uses `first_contact`, while an unset value defaults to `rocket_academy` |
| `GEMINI_API_KEY` | Node server only | Gemini API credential for planning |
| `GEMINI_MODEL` | Node server only | Optional model override; `/api/status` reports the configured/default model |
| `VITE_CESIUM_ION_TOKEN` | Browser | Optional public, restricted ion token for Moon/Mars terrain |
| `FIRST_CONTACT_API_PORT` | Node and Vite configuration | Optional API port; default `8787` |
| `FIRST_CONTACT_ALLOWED_ORIGINS` | Node server only | Optional comma-separated exact HTTP(S) origins |

Keep database credentials and Gemini keys server-only: **never prefix them with `VITE_`**. Node loads `.env.local` through its native environment-file support. Vite exposes configured `VITE_` values to the browser and embeds those used by a production build. Do not put secrets in an objective, mission name, or other exported user text.

### MongoDB Atlas

Use an existing cluster and a dedicated database user with `readWrite` access limited to the application database, including the collections and indexes created there. Restrict that user to the intended cluster where appropriate. An Atlas account user and a database user are different identities; see [Atlas database-user configuration](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/).

In the project's [network access list](https://www.mongodb.com/docs/atlas/security/ip-access-list/), allow the current public egress IP of the machine running the Node service, preferably as a temporary entry during development. Use an exact IP or a narrowly scoped network; do not use an all-IP rule as the default setup. Set `MONGODB_URI` to the database user's connection string and `MONGODB_DB` to the database granted to that user. This project does not provision a cluster, purchase a tier, or create account credentials.

Atlas stores the following central records:

| Collection or bucket | Responsibility |
| --- | --- |
| `terrain_sources` | Versioned source/layer identities, body, coordinate metadata, and provider references |
| `robots` | Robot catalog revision and execution limits |
| `missions` | Validated mission manifests |
| `plans` | Validated plans and planner provenance linked to a mission |
| `runs` | Run state, complete episode, mission/plan references, and artifact metadata |
| `decision_events` | Execution commands, planner rationale/provenance, and terminal result |
| GridFS `run_artifacts` | MCAP bytes in `run_artifacts.files` and `run_artifacts.chunks` |

Run artifacts record byte length and SHA-256. Catalog records are upserted on explicit saves/runs; opening the catalog does not seed those records. Completed runs can be listed by body and their MCAP files downloaded. Failed or interrupted saves are not presented as completed runs. Same-request retries use idempotency keys; conflicting reuse is rejected.

Native coordinates remain attached to their body, source, and frame. The service does not apply Earth-specific geospatial distance calculations to Moon/Mars positions. Atlas vector retrieval, semantic failure search, and external object storage are future integrations.

### Gemini planning

Set `GEMINI_API_KEY` from your authorized Gemini account and, if necessary, `GEMINI_MODEL` to a model available to it. The service calls Google's structured-output REST interface with the validated mission and objective, then validates the returned plan against the same limits as a baseline plan. It does not give the model tools to execute code or drive a robot. The request sets `store: false`; provider account terms still govern API use.

**Configured** means the server has a key. It does not prove model access or quota. A successful planning request establishes that the selected account/model worked for that request. Authentication, quota, timeout, malformed output, and rejected-plan errors remain visible. The baseline planner stays a separately selected local option.

### Optional Cesium ion terrain

The public imagery globes need no ion token. For the **Measured terrain** layer on Moon or Mars, create a [read-only public browser token](https://ion.cesium.com/tokens) restricted to asset `2684829` and/or `3644333` and to the application origins where it will be used. Account access and the provider's content terms apply.

Enter the token in connection settings for the current page session, or set `VITE_CESIUM_ION_TOKEN` before starting/building the frontend. Session entry overrides the configured token and is not written to browser storage or mission exports. A build-time token is visible in the delivered JavaScript; use only a token intended for public clients. Removing it from a delivered build requires rebuilding.

### Check service status

```bash
curl http://127.0.0.1:8787/api/status
```

The response reports Atlas `configured` and `connected` separately, Gemini configuration/model, and execution limits. With no optional credentials, both integrations report unconfigured. The repository does not include working Atlas or Gemini credentials, and their live operation has not been established by the local no-credential checks.

The API accepts local hosts and an explicit origin allowlist. Defaults cover `localhost` and `127.0.0.1` at the development, preview, and API ports. If you deliberately change the frontend origin, configure its exact origin and restart. This is a local-development boundary, not a substitute for authentication and authorization on a public service.

## Local API

All POST bodies are JSON with `Content-Type: application/json`. The body limit is 256 KiB. Errors use `{ "error": { "code", "message", "retryable" } }` without returning provider credentials.

| Method and path | Request / behavior |
| --- | --- |
| `GET /api/status` | Service version, integration status, model, and limits; no external credentials required |
| `GET /api/catalog` | Supported source variants and the current robot catalog |
| `POST /api/plans` | `{ mission, objective }`; requests and validates a Gemini plan; requires Gemini configuration |
| `POST /api/missions` | `{ mission }`; validates and saves a mission in Atlas |
| `POST /api/runs` | `{ mission, plan, planner, seed? }`; validates, executes on the server, writes MCAP to GridFS, and saves the run in Atlas |
| `GET /api/runs?body=mars&limit=20` | Completed Atlas runs; optional body is `earth`, `moon`, or `mars`; limit is 1–50, default 20 |
| `GET /api/runs/:id` | A saved run and artifact metadata; `id` is a UUID |
| `GET /api/runs/:id/mcap` | The saved MCAP with `Content-Length` and `X-Artifact-SHA256` headers |

Use a UUID `Idempotency-Key` on mission and run POSTs, and retain it when retrying the same operation. Omitting it causes a new UUID to be generated. Reusing it with different content returns a conflict. Plan generation is not an idempotent save and does not automatically retry provider calls.

Server saves additionally bound run JSON to 8 MiB and MCAP to 16 MiB; the browser writer has a 64 MiB memory cap. The service permits at most two concurrent plan requests and two concurrent run-save operations. History/detail/download and save routes require a usable Atlas connection. There is no server fallback that pretends a local record was stored remotely.

## Architecture and verification

| Area | Responsibility |
| --- | --- |
| [App and components](src/App.tsx) | Planet/layer selection, mission editing, planning controls, replay, downloads, and connection state |
| [Mission contract](src/domain/mission.ts) | Source catalog, coordinates, schema 2.0.0, validation, and provenance |
| [Example mission](src/domain/exampleMission.ts) | A 20 m reference-sphere arc |
| [Terrain renderer](src/terrain/TerrainScene.tsx) | Three.js spheres, NASA tile streaming, native picking, robot/trail display, and resource cleanup |
| [Episode engine](src/simulation/missionRun.ts) | Plan validation and bounded deterministic kinematics |
| [MCAP recording](src/recording/mcap.ts) | Indexed writing, explicit schemas, timestamps, and frame transforms |
| [Local API](server/app.ts) | Shared validation, route/origin limits, and integration errors |
| [Gemini adapter](server/gemini.ts) | Bounded structured planning requests and output validation |
| [Atlas adapter](server/atlas.ts) | Catalog/mission/plan/run records, GridFS, hashes, and save retries |

The current service uses the existing **Node 24/TypeScript runtime and shared validators**. The production frontend build is not a bundled server; Node executes the server TypeScript directly. Rust remains an option for a later physics worker after terrain and robot contracts are fixed.

```bash
npm test
npm run typecheck
npm run build
```

The tests exercise mission/plan constraints, globe transforms and picking math, keyboard navigation, credential scoping, startup deadlines, deterministic episodes, MCAP readback, and controlled API/provider failures. GitHub Actions runs installation, tests, and the production build. Consult the latest CI and QA output for actual results; this README does not substitute a frozen test count for current verification.

To serve the production frontend locally, run `npm run preview`. Start `npm run start:api` in another terminal if you need Gemini or Atlas; preview proxies `/api` but does not launch the service. `npm run dev:ui` and `npm run dev:api` are also available separately.

**Live graphics and provider verification remain separate gates.** The hosted QA browser had WebGL disabled, so its checks could not establish successful GPU rendering or picks. No live Atlas/Gemini success is claimed without configured credentials. Before relying on a deployment, check each public globe in a working WebGL browser, two distinct pointer and keyboard picks, the 20 m replay, source/layer changes, and MCAP contents. With your authorized accounts, also check Gemini planning, Atlas save/retry/history/download, and optional ion terrain.

| Symptom | Next step |
| --- | --- |
| WebGL cannot start | Enable hardware acceleration or use a WebGL-capable browser; the example and local recording path can still be used |
| Plain globe with an imagery warning | Retry the image; check access to its host; no elevation is present in either case |
| Dingo Gap fails to load | Check `raw.githubusercontent.com` access and retry terrain |
| Moon/Mars terrain requests a token | Switch to public imagery or provide the restricted ion token |
| A plan exceeds the leg/duration limit | Use the 20 m example or choose closer waypoints |
| Local service is offline | Start `npm run dev` or `npm run dev:api`; local runs and MCAP downloads remain available |
| Atlas configured but disconnected | Check the database user, database name, current egress IP, and cluster network access |
| Gemini configured but planning fails | Inspect the reported model-access, quota, deadline, or schema error |
| API rejects an origin | Use a default local origin or explicitly configure the intended origin |

Dated evidence is kept in [the QA reports](docs/qa/). Check the version and environment recorded by each report; a successful check of an earlier slice is not evidence of successful live service calls in this one.

## Full Rocket Academy direction — future work

The broader goal is a traceable environment in which generative AI directs exploration robots and produces useful training/evaluation episodes. Version 0.2 establishes the mission → plan → execution → replay → MCAP → Atlas chain. The following capabilities are explicitly beyond the current implementation:

1. **Prepare immutable scientific terrain.** Ingest original Moon/Mars DEMs or suitable Earth elevation products; record hashes, body reference, horizontal/vertical units, no-data rules, crop bounds, resolution, and transforms. Build matching visual and collision meshes. Resolve geographic registration before connecting a local reconstruction to a global map.
2. **Add a physics worker and calibrated robot models.** A Rust worker can consume the existing versioned mission/run contract. Introduce mass, dimensions, wheel/contact parameters, slopes, friction, and obstacle handling; validate against controlled cases before claiming physical accuracy or route safety.
3. **Add sensors and learning evaluation.** Record camera, depth/LiDAR, odometry, environment state, commands, and rewards with explicit schemas and calibration. Build reproducible task suites, data-quality checks, failure labels, dataset splits, and policy evaluations before any training or real-robot transfer claims.
4. **Extend generative orchestration.** Let a planner propose bounded subgoals and react to recorded observations through validated interfaces. Genie or other generative world-model systems are optional experiments, subject to actual access and evaluation; no Genie integration or capability is implemented or assumed here.
5. **Grow Atlas into a retrieval and experiment catalog.** Add vector retrieval of similar missions/failures, evaluation metadata, comparisons across planner/robot/terrain versions, and object-storage references for larger sensor recordings. Current Atlas collections and GridFS are implemented; vector indexes and semantic retrieval are not.
6. **Enrich Earth analog environments where useful.** Google Earth Engine could supply terrestrial imagery/environmental analysis and Meteomatics could supply Earth weather inputs. Neither integration exists in this repository. Their proposed role is Earth analog enrichment; they are not substitutes for a validated Mars or lunar weather/environment model.

## Licensing and attribution

Application code is licensed under **[Apache-2.0](LICENSE)**. Dependencies retain their upstream licenses. Scientific imagery, reconstruction products, and hosted services have their own source notices and terms; the application's code license does not relicense them.

The Moon color JPEG is bundled unaltered with its provenance and SHA-256. Mars/Earth imagery and terrain tiles load from their upstream hosts. See [NOTICE.md](NOTICE.md) for exact sources, credits, and usage references. This is an independent prototype and does not imply endorsement by NASA, JPL, Cesium, Google, MongoDB, or the contributing data institutions.
