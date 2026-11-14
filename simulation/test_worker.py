import base64
import unittest
import numpy as np
import mujoco
from worker import build_world, simulate


def request(duration=3, speed=.35, models=None):
    return dict(id="test", startedAt="2026-11-14T00:00:00Z", terrainSha256="0"*64,
                input=dict(terrain=dict(rows=65, cols=65, resolutionM=.25, heights=[0.0]*4225),
                           durationS=duration, speedMps=speed, seed=1, robotModels=models or ["scout", "surveyor"]))


class ContactTests(unittest.TestCase):
    def test_body_gravity_and_contact_are_recorded_without_changing_robot_mass(self):
        for body, gravity in [('earth',9.80665),('moon',1.62),('mars',3.711)]:
            with self.subTest(body=body):
                scenario=request(3, models=['husky','jackal'])
                scenario['input']['terrain']['source']={'body':body}
                model,_=build_world(scenario['input'])
                self.assertAlmostEqual(model.opt.gravity[2],-gravity)
                self.assertAlmostEqual(float(model.body_mass.sum()),56.582+18.432,places=5)
                result=simulate(scenario,render=False)
                self.assertEqual(result['engine']['gravityMps2'],gravity)
                for robot in result['frames'][-1]['robots']:
                    self.assertGreater(robot['contacts'],0)
                    self.assertGreater(robot['position'][0],-3.6)

    def test_rovers_settle_on_flat_ground_without_teleporting(self):
        result = simulate(request(.9), render=False)
        for state, radius in zip(result["frames"][-1]["robots"], [.18, .23]):
            self.assertAlmostEqual(state["position"][2], radius+.12, delta=.025)
            self.assertLess(abs(state["position"][0]+4), .02)
            self.assertGreater(state["contacts"], 0)

    def test_commands_drive_both_robots_forward_and_are_repeatable(self):
        first, second = simulate(request(), render=False), simulate(request(), render=False)
        self.assertEqual(first["frames"], second["frames"])
        for robot in first["frames"][-1]["robots"]:
            self.assertGreater(robot["position"][0], -3.6)
            self.assertLess(abs(robot["position"][1]), 2.1)
        self.assertEqual(first["termination"], "duration_reached")

    def test_common_models_can_be_selected_independently(self):
        result = simulate(request(.1, models=["surveyor", "scout"]), render=False)
        self.assertEqual([len(r["jointPosition"]) for r in result["frames"][0]["robots"]], [6, 4])
        self.assertEqual([r["id"] for r in result["robotModels"]], ["rover-1", "rover-2"])

    def test_heightfield_rows_and_vertical_scale_match_input(self):
        scenario = request()["input"]
        scenario["terrain"]["heights"] = [row*.01 + col*.005 for row in range(65) for col in range(65)]
        model, _ = build_world(scenario)
        data = mujoco.MjData(model)
        mujoco.mj_forward(model, data)
        for row, col in [(10, 12), (30, 40), (55, 52)]:
            pos = np.array([(col-32)*.25, (row-32)*.25, 20.])
            geom = np.array([-1], dtype=np.int32)
            distance = mujoco.mj_ray(model, data, pos, np.array([0., 0., -1.]), None, 1, -1, geom)
            self.assertAlmostEqual(20-distance, row*.01+col*.005, places=5)

    def test_both_robots_can_contact_in_the_same_world(self):
        model, _ = build_world(request()["input"])
        data = mujoco.MjData(model)
        p1, p2 = model.joint("rover-1_root").qposadr[0], model.joint("rover-2_root").qposadr[0]
        data.qpos[p2:p2+3] = data.qpos[p1:p1+3] + np.array([.5,0,0])
        mujoco.mj_forward(model, data)
        root_ids = [model.body("rover-1").id, model.body("rover-2").id]
        def root(geom):
            body = int(model.geom_bodyid[geom])
            while body > 0 and body not in root_ids: body = int(model.body_parentid[body])
            return body
        self.assertTrue(any({root(c.geom1),root(c.geom2)} == set(root_ids) for c in data.contact))

    def test_rgb_depth_shape_and_metric_ground_depth(self):
        result = simulate(request(.1))
        self.assertEqual(len(result["sensors"]), 2)
        for sample in result["sensors"]:
            png = base64.b64decode(sample["rgbPngBase64"])
            self.assertTrue(png.startswith(b'\x89PNG\r\n\x1a\n'))
            depth = np.frombuffer(base64.b64decode(sample["depthF32LEBase64"]), dtype="<f4").reshape(96,128)
            self.assertTrue(np.isfinite(depth).all())
            # A pixel near the bottom sees the known horizontal z=0 ground.
            x, y = 64, 80
            calibration = result["camera"]
            ray = np.array([(x-calibration["cx"])/calibration["fx"], -(y-calibration["cy"])/calibration["fy"], -1.])
            world_ray = np.array(sample["rotation"]).reshape(3,3) @ ray
            expected = -sample["position"][2] / world_ray[2]
            self.assertAlmostEqual(float(depth[y,x]), expected, delta=.03)


if __name__ == "__main__": unittest.main()
