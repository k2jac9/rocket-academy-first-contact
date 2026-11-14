import type { Collection, Document } from 'mongodb';
import { EPISODE_BODIES, EPISODE_END_REASONS } from '../src/simulation/episodeStats.ts';
import type { EpisodeStats } from '../src/simulation/episodeStats.ts';
import type { EpisodeFilters } from '../src/simulation/episodeQuery.ts';
import { episodeFilter, episodeRobotIds, knownOrUnknown } from './episodeQuery.ts';

const validNumber = (field: string, integer = false) => ({
  $cond: [
    { $isNumber: field },
    {
      $and: [
        { $gte: [field, 0] },
        { $lte: [field, Number.MAX_SAFE_INTEGER] },
        ...(integer ? [{ $eq: [field, { $trunc: field }] }] : []),
      ],
    },
    false,
  ],
});
const breakdown = (field: string): Document[] => [
  { $group: { _id: field, count: { $sum: 1 } } },
  { $sort: { _id: 1 } },
  { $project: { _id: 0, key: '$_id', count: 1 } },
];

/** Fixed, read-only pipeline. No request text becomes a database expression. */
export function episodeStatsPipeline(filters: EpisodeFilters = {}): Document[] {
  return [
    { $match: episodeFilter(filters) },
    {
      $project: {
        _id: 0,
        body: knownOrUnknown('$episode.input.terrain.source.body', EPISODE_BODIES),
        termination: knownOrUnknown('$episode.termination', EPISODE_END_REASONS),
        durationS: { $cond: [validNumber('$episode.durationS'), '$episode.durationS', null] },
        sensorSamples: {
          $cond: [validNumber('$episode.sensorSamples', true), '$episode.sensorSamples', null],
        },
        robots: episodeRobotIds,
      },
    },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              episodes: { $sum: 1 },
              durationS: { $sum: '$durationS' },
              durationEpisodes: { $sum: { $cond: [{ $ne: ['$durationS', null] }, 1, 0] } },
              sensorSamples: { $sum: '$sensorSamples' },
              sensorEpisodes: { $sum: { $cond: [{ $ne: ['$sensorSamples', null] }, 1, 0] } },
            },
          },
          { $project: { _id: 0 } },
        ],
        byBody: breakdown('$body'),
        byTermination: breakdown('$termination'),
        byRobot: [{ $unwind: '$robots' }, ...breakdown('$robots')],
      },
    },
  ];
}

type Facets = Document &
  Omit<EpisodeStats, 'schemaVersion' | 'scope' | 'updatedAt' | 'totals'> & {
    totals: EpisodeStats['totals'][];
  };

export async function readEpisodeStats(
  collection: Collection,
  requestSignal?: AbortSignal,
  filters: EpisodeFilters = {},
): Promise<EpisodeStats> {
  const signal = AbortSignal.any([AbortSignal.timeout(8_000), ...(requestSignal ? [requestSignal] : [])]);
  signal.throwIfAborted();
  const [result] = await collection
    .aggregate<Facets>(episodeStatsPipeline(filters), { maxTimeMS: 5_000, signal })
    .toArray();
  return {
    schemaVersion: '1.0.0',
    scope: 'complete_physics_episodes',
    updatedAt: new Date().toISOString(),
    totals: result?.totals[0] ?? {
      episodes: 0,
      durationS: 0,
      durationEpisodes: 0,
      sensorSamples: 0,
      sensorEpisodes: 0,
    },
    byBody: result?.byBody ?? [],
    byTermination: result?.byTermination ?? [],
    byRobot: result?.byRobot ?? [],
  };
}
