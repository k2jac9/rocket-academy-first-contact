export const EPISODE_BODIES = ['earth', 'moon', 'mars'] as const;
export const EPISODE_END_REASONS = ['duration_reached', 'rollover', 'terrain_boundary'] as const;
export const EPISODE_MODEL_IDS = ['husky', 'jackal', 'scout', 'surveyor'] as const;

export interface EpisodeStats {
  schemaVersion: '1.0.0';
  scope: 'complete_physics_episodes';
  updatedAt: string;
  totals: {
    episodes: number;
    durationS: number;
    durationEpisodes: number;
    sensorSamples: number;
    sensorEpisodes: number;
  };
  byBody: { key: (typeof EPISODE_BODIES)[number] | 'unknown'; count: number }[];
  byTermination: { key: (typeof EPISODE_END_REASONS)[number] | 'unknown'; count: number }[];
  byRobot: { key: (typeof EPISODE_MODEL_IDS)[number] | 'unknown'; count: number }[];
}
