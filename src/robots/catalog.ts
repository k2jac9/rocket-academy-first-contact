export const ROBOT_CATALOG = [
  {
    id: 'husky',
    name: 'Husky',
    manufacturer: 'Clearpath Robotics',
    category: 'Wheeled',
    tagline: 'The outdoor research workhorse.',
    description:
      'A rugged four-wheel platform with detailed tires, protective rails, and the original chassis geometry.',
    detail: '4 driven wheels',
    dimensions: '56.6 kg model mass',
    color: '#f5ecc7',
    rootToGroundM: 0.13228,
    simulation: true,
    source: 'https://github.com/husky/husky/tree/41e15d283a8d955938204e79554a875264417bb9',
  },
  {
    id: 'jackal',
    name: 'Jackal',
    manufacturer: 'Clearpath Robotics',
    category: 'Wheeled',
    tagline: 'Small footprint. Ready to explore.',
    description:
      'A compact research rover with its original shell, wheel layout, and sensor mounting structure.',
    detail: '4 driven wheels',
    dimensions: '18.4 kg model mass',
    color: '#dceee5',
    rootToGroundM: 0.0635,
    simulation: true,
    source: 'https://github.com/jackal/jackal/tree/4ddf9b578bb7abce1115c8dc59d8b7f86aa9268c',
  },
  {
    id: 'unitree-go2',
    name: 'Go2',
    manufacturer: 'Unitree Robotics',
    category: 'Quadruped',
    tagline: 'A different way to move.',
    description:
      'Inspect the articulated quadruped in its standing pose. A legged controller is required before it can generate episodes.',
    detail: '12 actuated joints',
    dimensions: '15.2 kg model mass',
    color: '#e8e1f3',
    rootToGroundM: 0,
    simulation: false,
    source:
      'https://github.com/google-deepmind/mujoco_menagerie/tree/370c43965323c0944b433b202aac5058b5f907a9/unitree_go2',
  },
] as const;
export type RobotAssetId = (typeof ROBOT_CATALOG)[number]['id'];
export type FleetRobotId = 'husky' | 'jackal';
export const isRobotAsset = (id: string): id is RobotAssetId => ROBOT_CATALOG.some((r) => r.id === id);
