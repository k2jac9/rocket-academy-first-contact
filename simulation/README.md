# Local physics episode pilot

The Robot lab runs two independently selectable Clearpath Husky or Jackal robots in one MuJoCo world, using the published source visual meshes, collision shapes, joints and inertias. A searchable library includes a Unitree Go2 inspection model; Go2 cannot generate episodes until a legged controller is integrated. Legacy scout/surveyor recordings retain their original generic bodies. The simulator freezes a 16 × 16 m heightfield from Dingo Gap, Apollo 17, or Amboy Crater. Body-specific constant gravity is applied without altering robot mass. This is an experimental surface-contact pilot; soil, atmosphere, thermal effects and planetary qualification are not established. See [surface-site sources and frames](../docs/surface-sites.md).

From the repository root on Windows:

```powershell
python -m venv .venv-sim
.\.venv-sim\Scripts\python.exe -m pip install -r simulation/requirements-check.txt
npm run dev
```

On Linux/macOS use `.venv-sim/bin/python`. An absolute `FIRST_CONTACT_SIM_PYTHON` environment variable can override the interpreter. The existing server-only Atlas configuration is required for episode creation and saving. The worker receives no inherited Gemini or Atlas secrets. It runs with a three-minute deadline and no arbitrary input code or model XML.

In **Explore worlds**, select Dingo Gap, place the rover near the middle of a fully reconstructed patch, then select **Use patch in robot lab**. Missing elevation samples stop capture; they are never replaced by flat ground. In **Robot lab**, choose each robot model, duration, speed and seed, then **Generate & save episode**. Replay loads saved states without calling the planner or physics engine again. Saved recordings remain available after a server restart.

## Recorded contract

- MuJoCo 3.3.7; 5 ms steps; Mars gravity 3.711 m/s²; one shared clock and collision world.
- Source Husky (56.582 kg description mass) or Jackal (18.432 kg description mass), each with four driven joints. These are source-model totals, not advertised hardware specifications. Each instance has a distinct ID regardless of model choice.
- A bounded lane controller starts after 1 second of settling. Its version and source hash are recorded. The seed changes initial yaw only.
- States and sampled wheel velocity targets at 10 Hz; RGB and metric optical-axis depth at 2 Hz, 128 × 96. Controller commands update at 200 Hz; the MCAP records sampled actions, not every controller tick.
- `/episode/manifest` contains the complete terrain, source provenance, frame transform, MJCF, terrain/model hashes, camera intrinsics, engine/platform identity, limits, and termination. Source robot entries include the revision, GLB/MJCF/mesh hashes and asset base URL. Source-model mesh bytes remain in `public/robots/<model>/meshes/`, not inside the MCAP: preserve those assets alongside exported episodes. Runtime MJCF uses portable `rover-N_<filename>` names; `real_robots.py` supplies the corresponding local bytes.
- `/robots/rover-N/state_action` contains world position, wxyz orientation, free-joint velocities, joint states, wheel targets in rad/s, and contact counts. Linear free-joint velocity is world-frame; angular free-joint velocity is body-frame.
- `/robots/rover-N/camera/rgb_depth` contains base64 PNG RGB, little-endian float32 depth in metres, and the camera-to-world OpenGL pose. Image rows run top to bottom. Camera +X is right, +Y is up and -Z is forward; positive depth is distance along the optical axis. Far-plane background depth remains in the data.
- Atlas `physics_episodes` stores metadata and replay states. `episode_artifacts` GridFS stores Zstandard-compressed MCAP. Local `.episodes/<UUID>/` preserves the scenario, worker output and recording, including after a save error. Downloads use the local recording only after its length and SHA-256 match Atlas metadata; otherwise they stream from GridFS with a bounded timeout. These generated files are Git-ignored and may be large.

The browser replay uses the same sampled heightfield and recorded poses, with source robot geometry and simple elevation shading. Sensor RGB uses simple MuJoCo materials. Neither is a photorealistic reconstruction. Uniform friction, rigid wheels, no suspension, no regolith deformation, no noise model, uncalibrated wheel motors and virtual front cameras limit training use. The source collision proxies differ from detailed tire meshes (Husky tread protrudes approximately 12.7 mm beyond its nominal collision cylinder). A 0.25 m sample interval does not establish source measurement accuracy or wheel-scale obstacle coverage. No downstream training or physical transfer has been validated.

## Verification

```powershell
npm test
npm run build
.\.venv-sim\Scripts\python.exe -m unittest discover -s simulation -p 'test_*.py' -v
.\.venv-sim\Scripts\python.exe scripts/verify_physics_episode.py path/to/episode.mcap
```

The Python checks cover rest/contact, forward motion, model selections, source mass preservation, duplicate real robots, browser/physics wheel-frame alignment, shared-world collision, heightfield axes/scale, repeatability on this engine/platform, and metric camera depth against a known plane. The independent MCAP reader checks indexes, CRCs, embedded schemas, timestamps, robot identities, model hash, image decoding and depth shape/finiteness. New recordings also preserve canonical terrain JSON for independent SHA-256 verification.

## Regenerating robot assets

Runtime uses the bundled, pinned files; conversion dependencies are unnecessary for running the app. For regeneration, install `simulation/requirements-assets.txt`, clone `https://github.com/husky/husky.git` into `.robot-sources/husky` and `https://github.com/jackal/jackal.git` into `.robot-sources/jackal`. Check out the exact source revisions from their bundled manifests. Run `python scripts/prepare_real_robots.py` using the simulation interpreter. The script verifies checkout revisions and downloads the pinned Menagerie Go2 description and meshes when absent. Upstream clones and conversion scratch files are Git-ignored. See [asset notices](../NOTICE.md).

Next: registered Moon/Earth terrain adapters, higher-fidelity assets and contacts, calibrated sensors, complete fixed-rate action logs, dataset splitting/export, and downstream policy evaluation. See [the architecture](../docs/synthetic-episode-lab.md).
