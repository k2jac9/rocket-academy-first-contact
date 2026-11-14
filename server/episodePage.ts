import type { Collection, Document } from 'mongodb';
import type { EpisodePage, EpisodeSummary } from '../src/simulation/episodeQuery.ts';
import { EPISODE_SITES } from '../src/simulation/episodeQuery.ts';
import { EPISODE_BODIES, EPISODE_END_REASONS } from '../src/simulation/episodeStats.ts';
import { episodeFilter, episodeRobotIds, encodeEpisodeCursor, knownOrUnknown } from './episodeQuery.ts';
import type { EpisodeQuery } from './episodeQuery.ts';

export function episodePagePipeline(query: EpisodeQuery): Document[] {
  return [
    { $match: episodeFilter(query.filters) },
    {
      $project: {
        _id: 1,
        startedAt: {
          $cond: [{ $eq: [{ $type: '$episode.startedAt' }, 'string'] }, '$episode.startedAt', ''],
        },
        durationS: { $cond: [{ $isNumber: '$episode.durationS' }, '$episode.durationS', null] },
        termination: knownOrUnknown('$episode.termination', EPISODE_END_REASONS),
        body: knownOrUnknown('$episode.input.terrain.source.body', EPISODE_BODIES),
        siteId: knownOrUnknown('$episode.input.terrain.source.id', EPISODE_SITES),
        robots: episodeRobotIds,
      },
    },
    ...(query.cursor
      ? [
          {
            $match: {
              $or: [
                { startedAt: { $lt: query.cursor.time } },
                { startedAt: query.cursor.time, _id: { $lt: query.cursor.id } },
              ],
            },
          },
        ]
      : []),
    { $sort: { startedAt: -1, _id: -1 } },
    { $limit: query.limit + 1 },
  ];
}
const siteLabels: Record<string, string> = {
  'dingo-gap': 'Dingo Gap',
  'apollo-17': 'Apollo 17',
  'amboy-crater': 'Amboy Crater',
  unknown: 'Unknown / legacy site',
};
type Row = Document &
  Omit<EpisodeSummary, 'id' | 'site' | 'downloadUrl'> & { _id: string; startedAt: string };
export async function readEpisodePage(
  collection: Collection,
  query: EpisodeQuery,
  requestSignal?: AbortSignal,
): Promise<EpisodePage> {
  const signal = AbortSignal.any([AbortSignal.timeout(8000), ...(requestSignal ? [requestSignal] : [])]);
  signal.throwIfAborted();
  const docs = await collection
    .aggregate<Row>(episodePagePipeline(query), { maxTimeMS: 5000, allowDiskUse: false, signal })
    .toArray();
  const visible = docs.slice(0, query.limit);
  const last = visible.at(-1);
  return {
    episodes: visible.map((d) => ({
      id: d._id,
      startedAt: d.startedAt || null,
      durationS:
        typeof d.durationS === 'number' && Number.isFinite(d.durationS) && d.durationS >= 0
          ? d.durationS
          : null,
      termination: d.termination,
      siteId: d.siteId,
      site: siteLabels[d.siteId] ?? siteLabels.unknown,
      body: d.body,
      robots: d.robots,
      downloadUrl: `/api/episodes/${d._id}/mcap`,
    })),
    nextCursor:
      docs.length > query.limit && last ? encodeEpisodeCursor(last.startedAt, last._id, query.filters) : null,
  };
}
