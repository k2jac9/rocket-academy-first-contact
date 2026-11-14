import type { Document } from 'mongodb';
import type { EpisodeFilters } from '../src/simulation/episodeQuery.ts';
import { EPISODE_SITES } from '../src/simulation/episodeQuery.ts';
import { EPISODE_BODIES, EPISODE_END_REASONS, EPISODE_MODEL_IDS } from '../src/simulation/episodeStats.ts';
import { ApiError, exactKeys } from './errors.ts';
import { jsonHash } from './hash.ts';

export interface EpisodeCursor {
  v: 1;
  time: string;
  id: string;
  filters: string;
}
export interface EpisodeQuery {
  filters: EpisodeFilters;
  limit: number;
  cursor?: EpisodeCursor;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function invalid(message: string): never {
  throw new ApiError(422, 'INVALID_QUERY', message);
}
function day(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
export function nextDay(value: string): string {
  const result = new Date(Date.parse(`${value}T00:00:00.000Z`) + 86_400_000).toISOString();
  if (result.length !== 24) invalid('The end date is outside the supported range.');
  return result;
}
export function parseEpisodeQuery(params: URLSearchParams, paging = true): EpisodeQuery {
  const allowed = [
    'body',
    'site',
    'robot',
    'termination',
    'from',
    'to',
    ...(paging ? ['limit', 'cursor'] : []),
  ];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1)
      invalid('Use each supported episode filter only once.');
  }
  const filters: EpisodeFilters = {};
  for (const [key, values] of [
    ['body', EPISODE_BODIES],
    ['site', EPISODE_SITES],
    ['robot', EPISODE_MODEL_IDS],
    ['termination', EPISODE_END_REASONS],
  ] as const) {
    const value = params.get(key);
    if (value !== null) {
      if (value !== 'unknown' && !(values as readonly string[]).includes(value))
        invalid(`Unsupported ${key} filter.`);
      Object.assign(filters, { [key]: value });
    }
  }
  for (const key of ['from', 'to'] as const) {
    const value = params.get(key);
    if (value !== null) {
      if (!day(value)) invalid('Dates must be valid calendar days in YYYY-MM-DD format (UTC).');
      filters[key] = value;
    }
  }
  if (filters.from && filters.to && filters.from > filters.to)
    invalid('The start date must not follow the end date.');
  if (filters.to) nextDay(filters.to);
  const size = params.get('limit') ?? '20';
  if (!/^[1-9]\d?$/.test(size) || Number(size) > 50) invalid('Page size must be between 1 and 50.');
  const query: EpisodeQuery = { filters, limit: Number(size) };
  const token = params.get('cursor');
  if (token !== null) {
    try {
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(token)) throw new Error();
      const bytes = Buffer.from(token, 'base64url');
      if (bytes.toString('base64url') !== token) throw new Error();
      const value: unknown = JSON.parse(bytes.toString('utf8'));
      exactKeys(value, ['v', 'time', 'id', 'filters']);
      if (
        value.v !== 1 ||
        typeof value.time !== 'string' ||
        value.time.length > 128 ||
        typeof value.id !== 'string' ||
        !UUID.test(value.id) ||
        value.filters !== jsonHash(filters)
      )
        throw new Error();
      query.cursor = value as unknown as EpisodeCursor;
    } catch {
      invalid('The page cursor is invalid or belongs to different filters. Start again from the first page.');
    }
  }
  return query;
}
export function encodeEpisodeCursor(time: string, id: string, filters: EpisodeFilters): string {
  return Buffer.from(JSON.stringify({ v: 1, time, id, filters: jsonHash(filters) })).toString('base64url');
}
export const knownOrUnknown = (value: unknown, allowed: readonly string[]) => ({
  $cond: [{ $in: [value, allowed] }, value, 'unknown'],
});
export const episodeRobotIds: Document = {
  $let: {
    vars: { models: { $cond: [{ $isArray: '$episode.robotModels' }, '$episode.robotModels', []] } },
    in: {
      $cond: [
        { $gt: [{ $size: '$$models' }, 0] },
        {
          $setUnion: [
            {
              $map: {
                input: '$$models',
                as: 'robot',
                in: knownOrUnknown('$$robot.modelId', EPISODE_MODEL_IDS),
              },
            },
            [],
          ],
        },
        ['unknown'],
      ],
    },
  },
};
/** Only allowlisted scalar values enter these fixed database expressions. */
export function episodeFilter(filters: EpisodeFilters = {}): Document {
  const result: Document = { state: 'complete' };
  const exact: Document[] = [];
  for (const [key, field, values] of [
    ['body', 'episode.input.terrain.source.body', EPISODE_BODIES],
    ['site', 'episode.input.terrain.source.id', EPISODE_SITES],
    ['termination', 'episode.termination', EPISODE_END_REASONS],
  ] as const) {
    const value = filters[key];
    if (value) {
      if (value !== 'unknown') result[field] = value;
      exact.push({ $eq: [knownOrUnknown(`$${field}`, values), value] });
    }
  }
  if (filters.robot) {
    if (filters.robot !== 'unknown') result['episode.robotModels.modelId'] = filters.robot;
    exact.push({ $in: [filters.robot, episodeRobotIds] });
  }
  if (filters.from || filters.to) {
    result['episode.startedAt'] = {
      ...(filters.from ? { $gte: `${filters.from}T00:00:00.000Z` } : {}),
      ...(filters.to ? { $lt: nextDay(filters.to) } : {}),
    };
    exact.push({ $eq: [{ $type: '$episode.startedAt' }, 'string'] });
  }
  if (exact.length) result.$expr = { $and: exact };
  return result;
}
