import { SOURCES, getSource } from '../src/domain/mission.ts';
import { ROBOT_PROFILE, RUN_LIMITS } from '../src/simulation/missionRun.ts';

export const SOURCE_CATALOG = [...SOURCES, getSource('moon', 'terrain'), getSource('mars', 'terrain')];
export const ROBOT_CATALOG = [
  {
    ...ROBOT_PROFILE,
    label: 'Survey rover',
    executionModel: 'kinematic-rehearsal',
    limits: RUN_LIMITS,
    physicsValidated: false,
    terrainContactValidated: false,
  },
] as const;
