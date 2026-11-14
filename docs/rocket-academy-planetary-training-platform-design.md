# FIRST CONTACT — platform design 2.1 implementation map

November 14, 2026. This document operationalizes the user's supplied version 2.1 blueprint and records the current implementation status. It does not mark the full architecture complete.

**Product:** Create worlds. Train robotic teams. Learn from every mission.

The intended learning loop is mission intent → validated scenario → physical execution → synchronized evidence → Atlas discovery and governance → frozen datasets → learning and held-out evaluation → curriculum. Generative exploration and appearance are separate, traceable branches.

## Component responsibilities and current state

| Component | Responsibility | Implemented state |
| --- | --- | --- |
| Gemini | Structured mission authoring and evidence explanation | Existing bounded kinematic planner; no general physical multi-agent scenario compiler yet |
| Google Genie | Interactive world exploration and optional agent research | Versioned manual exploration/import adapter and capability gates; no live programmatic connection |
| Physics backend | Authoritative dynamics, contacts and sensor capture | Experimental local MuJoCo worker, measured Dingo Gap / Apollo 17 / Amboy Crater patches, body-specific gravity, two Husky/Jackal robots, scripted control, RGB/depth and MCAP |
| Isaac Sim / Isaac Lab | Proposed cinematic sensor and learning workers | Not installed/integrated/benchmarked for this platform |
| Cosmos | Simulation-conditioned visual variants | Planned; no generated observation pipeline or label validation |
| Atlas | Authoring, episode identities, provenance and governance | Existing runs/physics episodes plus immutable exploration/scenario records, original artifacts and lineage; governed training datasets remain future work |
| FiftyOne | Advanced evidence inspection | Compatibility evaluation still required |

The blueprint's baseline description was tied to commit `b16bbaf...` and said the app was kinematic-only. The current working tree now includes an experimental physical pilot. That does not upgrade legacy kinematic records or establish robot calibration, planetary validity or learning benefit. See [the physics architecture](synthetic-episode-lab.md) and its QA records.

## Runtime ownership

React/TypeScript/Three.js remains the control plane. Node validates requests and publishes records. The Python worker owns its physics/control loop locally. Atlas is not queried for the next motor action. Genie prompts and imported videos cannot directly alter physical state. The active backend owns a complete contact interaction; no mixed authoritative solvers are introduced.

Authoring uses one Studio route integrated with Worlds, Catalog and Robot lab. A frozen scenario pins its bounded pilot settings and original exploration. At execution, the actual engine/controller/model/source hashes and sensor contract are recorded. Full immutable asset/policy registries and leased durable jobs remain milestones, not hidden capabilities of the current scenario compiler.

## Evidence contracts retained from the blueprint

- Separate measured observations, reconstructed terrain, collision/material models, generated detail and visual appearance. Reference images never establish measured geometry.
- Record native source coordinates and explicit local metric transforms. Dingo Gap does not acquire invented geographic registration.
- Separate director views, robot sensor streams and privileged ground truth. Preserve the observations actually consumed by any future policy.
- Keep identities and existing MCAP schemas compatible; extend records with versioned optional fields. Preserve physics/validation limits on legacy recordings.
- Treat execution outcome, publication, search projection, review and purpose eligibility as separate states. Current imported Genie media is exploration/review only.
- Retain failed episodes and derivatives with their actual evidence. A visual derivative's failure need not invalidate its physical parent.
- Future dataset manifests must pin membership, segments, artifacts, eligibility/review revisions, transformations and split groups. Related trajectories and rerenders must not cross training/evaluation splits.
- Learned policies must be compared with a baseline on a frozen suite; generated hours and visual fidelity do not establish improvement.

## Completed implementation slice

Scenario Studio supports prompts, operator-reported Genie 3/4/unknown identity, original reference/video imports, hash-based artifact retrieval, immutable scenario settings, explicit world adaptations and a linked physics execution. A 5-second physical episode has been saved and independently verified with the original exploration/scenario lineage. See [the integration contract and evidence](google-genie-integration.md).

This demonstrates the authoring → provenance → bounded physical execution link. It does not demonstrate autonomous cooperative logistics, a learned policy, a validated lunar environment, semantic dataset search, governed training admission or live Genie control.

## Remaining milestone acceptance gates

| Milestone | Required next evidence |
| --- | --- |
| Trustworthy physical episode | Expand contact/sensor validation to a pinned environment and asset package; durable recoverable job leases/publication; benchmark representative workloads |
| Agents and heterogeneous participants | Scout/carrier behavior, explicit policy/action/observation contracts, communications and interventions; reject privileged-input leakage |
| Atlas discovery and governed datasets | Ontology, evidence intervals, purpose-specific admission, immutable manifests, split groups, exact retrieval and stale-approval/revocation checks |
| Measured learning | Learning worker, baseline, consumed observation records, checkpoint registry, development suite and untouched final test |
| Generative observations | Pinned Cosmos interface, parent lineage, sensor/label correspondence, temporal/multi-view validation and failed-derivative quarantine |
| Planetary expansion | Apollo 17 and Amboy Crater measured packages and constant-gravity profiles are now implemented; validate contact/sensing/material assumptions for each domain. Orbital dynamics remains a separate later adapter. |
| Executable Genie research | Verified API/SDK and entitlement, allowed automated use, robot actions/observations, reset/timing, recording and task validity |
| External deployment | Authentication, tenant-scoped access, worker identities, budgets, artifact authorization and measured capacity |

## Compute and access findings

Local hardware discovery reports NVIDIA GeForce RTX 2060, 6,144 MiB VRAM, driver 621.01. The [current Isaac Sim requirements](https://docs.isaacsim.omniverse.nvidia.com/latest/installation/requirements.html) list RTX 4080 / 16 GB VRAM as minimum and note additional training demands. The local GPU is below that published minimum; no representative Isaac workload benchmark or compatible remote host has been established. Keep MuJoCo operational while selecting and authorizing an appropriate worker host. No paid host or GPU software download was provisioned in this implementation.

The existing Gemini credential's official model listing succeeded but exposed no Genie model. The signed-in Project Genie browser could not be inspected because desktop automation was unavailable. [Google's current Genie page](https://deepmind.google/models/genie/) describes a trusted-tester preview and future broader access. Keep the executable adapter gated until the actual interface and account entitlement are verified.

Measured source expansion: [Apollo 17 and Amboy Crater](surface-sites.md) now execute in the local MuJoCo pilot, alongside Dingo Gap. These add real topography and explicit gravity profiles; domain calibration and learning remain separate acceptance gates.
