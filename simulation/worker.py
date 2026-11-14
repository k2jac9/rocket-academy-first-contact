"""Bounded local MuJoCo pilot. Inputs are data, never user-supplied MJCF or Python."""
import base64
import hashlib
import io
import json
import math
import platform
import sys
from pathlib import Path

import mujoco
import numpy as np
from PIL import Image
from real_robots import SUPPORTED, attach, description

DT = 0.005
WIDTH, HEIGHT = 128, 96
MODELS = [
    dict(id="scout", label="Scout · four wheels", wheels=4, massKg=24, lengthM=0.9, widthM=0.65, wheelRadiusM=0.18, color="#67d9c6"),
    dict(id="surveyor", label="Surveyor · six wheels", wheels=6, massKg=65, lengthM=1.3, widthM=0.9, wheelRadiusM=0.23, color="#f3b67c"),
]


def robots_for(scenario):
    return [dict(description(model_id) if model_id in SUPPORTED else next(model for model in MODELS if model["id"] == model_id), id=f"rover-{index+1}", modelId=model_id)
            for index, model_id in enumerate(scenario["robotModels"])]


def build_world(scenario):
    terrain = scenario["terrain"]
    body = terrain.get('source', {}).get('body', 'mars')
    gravity = {'moon': 1.62, 'mars': 3.711, 'earth': 9.80665}[body]
    ground_color = {'moon': '0.46 0.46 0.46 1', 'mars': '0.53 0.39 0.26 1', 'earth': '0.37 0.32 0.27 1'}[body]
    heights = np.array(terrain["heights"], dtype=float).reshape(terrain["rows"], terrain["cols"])
    low, high = float(heights.min()), float(heights.max())
    span = max(high - low, 0.01)
    half = (terrain["rows"] - 1) * terrain["resolutionM"] / 2
    bodies, actuators, mesh_elements, mesh_assets = [], [], [], {}
    rng = np.random.default_rng(scenario["seed"])
    for index, robot in enumerate(robots_for(scenario)):
        rid = robot["id"]
        y = (-1 if index == 0 else 1) * 1.8
        row, col = round((y + half) / terrain["resolutionM"]), round((-4 + half) / terrain["resolutionM"])
        z = float(heights[row-3:row+4, col-4:col+5].max()) + robot["wheelRadiusM"] + 0.17
        yaw = float(rng.uniform(-0.02, 0.02))
        if robot['modelId'] in SUPPORTED:
            z = float(heights[row-3:row+4, col-4:col+5].max()) + robot['rootToGroundM'] + .05
            body, motors, meshes, assets = attach(robot, [-4, y, z], yaw)
            bodies.append(body)
            actuators.append(motors)
            mesh_elements.append(meshes)
            mesh_assets.update(assets)
            continue
        wheel_bodies = []
        xs = [-robot["lengthM"] * .36, robot["lengthM"] * .36]
        if robot["wheels"] == 6:
            xs.insert(1, 0)
        for side in [-1, 1]:
            for x in xs:
                wid = f'{rid}_wheel_{len(wheel_bodies)}'
                wheel_bodies.append(f'''<body name="{wid}" pos="{x} {side * robot['widthM'] / 2} -0.12">
                  <joint name="{wid}" type="hinge" axis="0 1 0" damping="0.1" armature="0.02"/>
                  <geom type="cylinder" size="{robot['wheelRadiusM']} 0.065" quat="0.7071067812 0.7071067812 0 0" mass="1" rgba="0.10 0.14 0.15 1"/>
                </body>''')
                actuators.append(f'<velocity name="{wid}" joint="{wid}" kv="5" ctrllimited="true" ctrlrange="-5 5" forcelimited="true" forcerange="-12 12"/>')
        color = "0.40 0.85 0.77 1" if index == 0 else "0.95 0.71 0.49 1"
        bodies.append(f'''<body name="{rid}" pos="-4 {y} {z}" euler="0 0 {yaw}">
          <freejoint name="{rid}_root"/>
          <geom type="box" size="{robot['lengthM']/2} {robot['widthM']*.38} 0.12" mass="{robot['massKg']-robot['wheels']-0.5}" rgba="{color}"/>
          <geom type="cylinder" pos="0.25 0 0.28" size="0.025 0.18" mass="0.2" rgba="0.6 0.7 0.7 1"/>
          <geom type="box" pos="0.25 0 0.48" size="0.07 0.10 0.05" mass="0.3" rgba="0.2 0.3 0.35 1"/>
          <camera name="{rid}_camera" pos="0.33 0 0.48" xyaxes="0 -1 0 0.173648 0 0.984808" fovy="60"/>
          {''.join(wheel_bodies)}
        </body>''')
    xml = f'''<mujoco model="first-contact-contact-pilot-v1">
      <compiler angle="radian"/>
      <option timestep="{DT}" gravity="0 0 -{gravity}" integrator="implicitfast" iterations="60"/>
      <visual><global offwidth="{WIDTH}" offheight="{HEIGHT}"/><map znear="0.01" zfar="100"/></visual>
      <default><geom friction="0.8 0.005 0.0001" condim="4" solref="0.02 1"/></default>
      <asset><hfield name="terrain" nrow="{terrain['rows']}" ncol="{terrain['cols']}" size="{half} {half} {span} 1"/>{''.join(mesh_elements)}</asset>
      <worldbody>
        <light pos="0 0 20" dir="0.3 0.2 -1" diffuse="0.9 0.85 0.75" ambient="0.3 0.3 0.3"/>
        <geom name="terrain" type="hfield" hfield="terrain" pos="0 0 {low}" rgba="{ground_color}"/>
        {''.join(bodies)}
      </worldbody><actuator>{''.join(actuators)}</actuator>
    </mujoco>'''
    model = mujoco.MjModel.from_xml_string(xml, assets=mesh_assets)
    model.hfield_data[:] = ((heights - low) / span).ravel()
    return model, xml


def simulate(request, render=True):
    scenario = request["input"]
    robots = robots_for(scenario)
    model, xml = build_world(scenario)
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    roots = [model.body(r["id"]).id for r in robots]
    # Map every child wheel geom to its robot for contact counts.
    geom_robot = {}
    for geom_id in range(model.ngeom):
        body = int(model.geom_bodyid[geom_id])
        while body > 0 and body not in roots:
            body = int(model.body_parentid[body])
        if body in roots:
            geom_robot[geom_id] = roots.index(body)
    frames, sensors = [], []
    renderer = mujoco.Renderer(model, height=HEIGHT, width=WIDTH) if render else None
    render_options = mujoco.MjvOption()
    render_options.geomgroup[4] = 0
    termination = "duration_reached"
    steps = round(scenario["durationS"] / DT)
    try:
        for step in range(steps + 1):
            # Recompute derived transforms after the last integration step before recording.
            mujoco.mj_forward(model, data)
            action_offset = 0
            for index, robot in enumerate(robots):
                bid = roots[index]
                pos = data.xpos[bid]
                rotation = data.xmat[bid].reshape(3, 3)
                yaw = math.atan2(rotation[1, 0], rotation[0, 0])
                lane = (-1 if index == 0 else 1) * 1.8
                target_yaw = math.atan2((lane - pos[1]) * .6, 1)
                heading_error = math.atan2(math.sin(target_yaw-yaw), math.cos(target_yaw-yaw))
                speed = scenario["speedMps"] if data.time >= 1 and pos[0] < 4 else 0
                turn = max(-0.5, min(0.5, heading_error * 1.5)) if speed else 0
                for wheel in range(robot["wheels"]):
                    side = -1 if wheel < robot["wheels"] // 2 else 1
                    data.ctrl[action_offset + wheel] = (speed - side * turn * robot["widthM"] / 2) / robot["wheelRadiusM"]
                action_offset += robot["wheels"]
                if abs(pos[0]) > 6.8 or abs(pos[1]) > 6.8:
                    termination = "terrain_boundary"
                if rotation[2, 2] < 0.25:
                    termination = "rollover"
            if not np.isfinite(data.qpos).all() or not np.isfinite(data.qvel).all():
                raise RuntimeError("Non-finite simulation state")
            if step % 20 == 0 or termination != "duration_reached":
                contacts = [0, 0]
                for contact in data.contact:
                    for geom_id in (int(contact.geom1), int(contact.geom2)):
                        if geom_id in geom_robot:
                            contacts[geom_robot[geom_id]] += 1
                states = []
                for index, robot in enumerate(robots):
                    rid = robot["id"]
                    joints = [model.joint(f'{rid}_wheel_{i}') for i in range(robot["wheels"])]
                    states.append(dict(
                        id=rid, position=data.xpos[roots[index]].tolist(), orientationWxyz=data.xquat[roots[index]].tolist(),
                        velocity=data.qvel[model.joint(f'{rid}_root').dofadr[0]:model.joint(f'{rid}_root').dofadr[0]+6].tolist(),
                        jointPosition=[float(data.qpos[j.qposadr[0]]) for j in joints],
                        jointVelocity=[float(data.qvel[j.dofadr[0]]) for j in joints],
                        action=[float(data.ctrl[model.actuator(f'{rid}_wheel_{i}').id]) for i in range(robot["wheels"])],
                        contacts=contacts[index],
                    ))
                frames.append(dict(elapsedS=round(float(data.time), 9), robots=states))
            if renderer is not None and step % 100 == 0:
                for robot in robots:
                    name = f'{robot["id"]}_camera'
                    renderer.update_scene(data, camera=name, scene_option=render_options)
                    rgb = renderer.render().copy()
                    output = io.BytesIO()
                    Image.fromarray(rgb).save(output, format="PNG")
                    renderer.enable_depth_rendering()
                    depth = renderer.render().astype("<f4", copy=True)
                    renderer.disable_depth_rendering()
                    if not np.isfinite(depth).all() or (depth <= 0).any():
                        raise RuntimeError("Invalid depth sample")
                    cid = model.camera(name).id
                    sensors.append(dict(
                        elapsedS=round(float(data.time), 9), robotId=robot["id"],
                        rgbPngBase64=base64.b64encode(output.getvalue()).decode("ascii"),
                        depthF32LEBase64=base64.b64encode(depth.tobytes()).decode("ascii"),
                        position=data.cam_xpos[cid].tolist(), rotation=data.cam_xmat[cid].tolist(),
                    ))
            if step == steps or termination != "duration_reached":
                break
            mujoco.mj_step(model, data)
    finally:
        if renderer is not None:
            renderer.close()
    focal = HEIGHT / (2 * math.tan(math.radians(60) / 2))
    return dict(
        id=request["id"], startedAt=request["startedAt"], input=scenario, terrainSha256=request["terrainSha256"],
        terrainCanonicalJson=request.get("terrainCanonicalJson", ""),
        controller=dict(name="bounded-lane-velocity", version="1.1.0", sourceSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                        modelAdapterSha256=hashlib.sha256(Path(__file__).with_name('real_robots.py').read_bytes()).hexdigest(), updateRateHz=200),
        modelSha256=hashlib.sha256(xml.encode()).hexdigest(), modelXml=xml,
        engine=dict(name="mujoco", version=mujoco.__version__, timestepS=DT, platform=platform.platform(), gravityMps2=float(-model.opt.gravity[2]),
                    environmentProfile=f"rigid-surface-{scenario['terrain'].get('source', {}).get('body', 'mars')}-v1"),
        camera=dict(width=WIDTH, height=HEIGHT, rateHz=2, fovYDegrees=60, fx=focal, fy=focal, cx=(WIDTH-1)/2, cy=(HEIGHT-1)/2,
                    depthUnits="m", depthConvention="optical-axis", poseConvention="Camera-to-world row-major rotation; OpenGL camera +X right, +Y up, -Z forward. Images top-left origin."),
        frames=frames, sensors=sensors, durationS=round(float(data.time), 9), termination=termination, robotModels=robots,
        limitations=[
            "Source robot geometry and inertias where selected; control, friction and virtual cameras are experimental, without hardware calibration or sim-to-real validation.",
            "Terrain resampled from the recorded measured source at 0.25 m; sampling does not establish source accuracy or wheel-scale detail.",
            "Body-specific constant gravity only; atmosphere, soil, thermal effects and planetary hardware suitability are not validated.",
            "Uniform assumed friction; rigid wheels, no suspension or deformable regolith.",
            "RGB uses simple materials without source imagery; clean synthetic depth, no sensor noise or latency.",
            "Positions and linear velocities are world-frame; angular free-joint velocities are body-frame. Actions are wheel velocity targets in rad/s.",
            "Seed perturbs initial yaw only. Reproducibility is limited to the recorded engine and platform.",
            "Source-model MJCF references local mesh assets. Their pinned source revisions, asset URLs and SHA-256 hashes are recorded; mesh bytes are distributed with the app, not embedded in MCAP.",
        ],
    )


if __name__ == "__main__":
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    result = simulate(request)
    Path(sys.argv[2]).write_text(json.dumps(result, allow_nan=False, separators=(",", ":")), encoding="utf-8")
