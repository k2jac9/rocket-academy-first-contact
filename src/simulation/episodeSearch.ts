import type { EpisodeSummary } from './episodeQuery';

export interface EpisodeSearchStatus {
  status: 'not_configured' | 'building' | 'ready' | 'failed';
  model: string;
  projectionVersion: string;
}
export interface EpisodeSearchResult {
  episodes: (EpisodeSummary & { summary: string; score: number })[];
  model: string;
  omittedStale: number;
  projectionUpdates: number;
}
