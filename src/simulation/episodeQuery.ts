import type { EpisodeStats } from './episodeStats';

export const EPISODE_SITES = ['dingo-gap', 'apollo-17', 'amboy-crater'] as const;
export interface EpisodeFilters {
  body?: EpisodeStats['byBody'][number]['key'];
  site?: (typeof EPISODE_SITES)[number] | 'unknown';
  robot?: EpisodeStats['byRobot'][number]['key'];
  termination?: EpisodeStats['byTermination'][number]['key'];
  from?: string;
  to?: string;
}
export interface EpisodeSummary {
  id: string;
  startedAt: string | null;
  durationS: number | null;
  termination: string;
  site: string;
  siteId: string;
  body: string;
  robots: string[];
  downloadUrl: string;
}
export interface EpisodePage {
  episodes: EpisodeSummary[];
  nextCursor: string | null;
}
export function episodeFilterParams(filters: EpisodeFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ['body', 'site', 'robot', 'termination', 'from', 'to'] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  return params;
}
