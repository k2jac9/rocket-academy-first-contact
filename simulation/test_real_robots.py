import json
import unittest
from pathlib import Path

import mujoco
import numpy as np
import trimesh

from worker import build_world, simulate
from test_worker import request

ASSETS = Path(__file__).resolve().parents[1] / 'public' / 'robots'


class SourceRobotTests(unittest.TestCase):
    def test_source_inertias_survive_conversion_and_world_assembly(self):
        model, xml = build_world(request(models=['husky', 'jackal'])['input'])
        self.assertAlmostEqual(float(model.body_mass.sum()), 56.582 + 18.432, places=5)
        self.assertNotIn('C:/', xml)
        self.assertNotIn('C:\\', xml)
        for rid in ['rover-1', 'rover-2']:
            for i in range(4):
                np.testing.assert_allclose(model.joint(f'{rid}_wheel_{i}').axis, [0,1,0])
        # Duplicate selections must have independently named bodies, assets and actuators.
        duplicate, _ = build_world(request(models=['jackal', 'jackal'])['input'])
        self.assertEqual(duplicate.nu, 8)
        self.assertAlmostEqual(float(duplicate.body_mass.sum()), 2*18.432, places=5)

    def test_real_wheels_contact_ground_and_drive_repeatably(self):
        scenario = request(3, models=['husky', 'jackal'])
        first = simulate(scenario, render=False)
        second = simulate(scenario, render=False)
        self.assertEqual(first['frames'], second['frames'])
        self.assertEqual(first['termination'], 'duration_reached')
        for state, expected_z in zip(first['frames'][-1]['robots'], [.13228, .0635]):
            self.assertAlmostEqual(state['position'][2], expected_z, delta=.01)
            self.assertGreater(state['contacts'], 0)
            self.assertGreater(state['position'][0], -3.6)
            self.assertTrue(all(angle > 0 for angle in state['jointPosition']))

    def test_browser_wheel_links_match_native_physics_frames(self):
        for name in ['husky', 'jackal']:
            manifest = json.loads((ASSETS/name/'manifest.json').read_text())
            scene = trimesh.load(ASSETS/name/'robot.glb', force='scene')
            model = mujoco.MjModel.from_xml_path(str(ASSETS/name/'model.xml'))
            data = mujoco.MjData(model)
            mujoco.mj_forward(model, data)
            y_to_z = trimesh.transformations.rotation_matrix(np.pi/2, [1,0,0])
            for index, joint_name in enumerate(manifest['wheelJointNames']):
                native = y_to_z @ scene.graph[f'wheel_{index}'][0]
                expected = data.xpos[model.body(joint_name+'_link').id]
                np.testing.assert_allclose(native[:3,3], expected, atol=1e-6)
            # Converted model is metre-scale and retains its wheels below base_link.
            native_scene = scene.copy()
            native_scene.apply_transform(y_to_z)
            # Source tread meshes extend beyond the source's nominal cylinder (Husky: 12.7 mm).
            self.assertAlmostEqual(native_scene.bounds[0,2], -manifest['rootToGroundM'], delta=.015)


if __name__ == '__main__': unittest.main()
