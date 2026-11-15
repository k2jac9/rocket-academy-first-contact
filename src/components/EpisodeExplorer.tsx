import { useEffect, useId, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { EpisodeOverview } from './EpisodeOverview';
import { EpisodeSemanticSearch } from './EpisodeSemanticSearch';
import { episodeFilterParams } from '../simulation/episodeQuery';
import type { EpisodeFilters, EpisodePage } from '../simulation/episodeQuery';

const fields = {
  body: {
    label: 'World',
    options: [
      ['earth', 'Earth'],
      ['moon', 'Moon'],
      ['mars', 'Mars'],
      ['unknown', 'Unknown / other'],
    ],
  },
  site: {
    label: 'Terrain site',
    options: [
      ['dingo-gap', 'Dingo Gap'],
      ['apollo-17', 'Apollo 17'],
      ['amboy-crater', 'Amboy Crater'],
      ['unknown', 'Unknown / legacy site'],
    ],
  },
  robot: {
    label: 'Robot model',
    options: [
      ['husky', 'Husky'],
      ['jackal', 'Jackal'],
      ['scout', 'Scout (legacy)'],
      ['surveyor', 'Surveyor (legacy)'],
      ['unknown', 'Unknown / other'],
    ],
  },
  termination: {
    label: 'End reason',
    options: [
      ['duration_reached', 'Duration reached'],
      ['rollover', 'Rollover'],
      ['terrain_boundary', 'Terrain boundary'],
      ['unknown', 'Unknown / other'],
    ],
  },
} as const;
const label = (key: keyof typeof fields, value: string) =>
  fields[key].options.find(([id]) => id === value)?.[1] ?? 'Unknown / other';
type Draft = Record<keyof EpisodeFilters, string>;
const empty: Draft = { body: '', site: '', robot: '', termination: '', from: '', to: '' };

export function EpisodeExplorer({
  active,
  revision,
  replayDisabled,
  onLoad,
}: {
  active: boolean;
  revision: number;
  replayDisabled: boolean;
  onLoad: (id: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(empty);
  const [draftSize, setDraftSize] = useState(20);
  const [filterQuery, setFilterQuery] = useState('');
  const [size, setSize] = useState(20);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [data, setData] = useState<EpisodePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');
  const previousRevision = useRef(revision);
  const cursor = cursors.at(-1) ?? null;
  useEffect(() => {
    if (previousRevision.current !== revision) {
      previousRevision.current = revision;
      setCursors([null]);
    }
  }, [revision]);
  useEffect(() => {
    if (!active) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError('');
    const params = new URLSearchParams(filterQuery);
    params.set('limit', String(size));
    if (cursor) params.set('cursor', cursor);
    void (async () => {
      try {
        const response = await fetch(`/api/episodes?${params}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body)
          throw new Error(body?.error?.message ?? 'The episode library is unavailable.');
        if (!controller.signal.aborted) setData(body);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not load saved episodes.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [active, filterQuery, size, cursor, revision, refreshVersion]);
  function refresh() {
    setCursors([null]);
    setRefreshVersion((value) => value + 1);
  }
  function apply() {
    if (draft.from && draft.to && draft.from > draft.to) {
      setFilterError('Choose an end date on or after the start date.');
      return;
    }
    setFilterError('');
    setFilterQuery(episodeFilterParams(draft as EpisodeFilters).toString());
    setSize(draftSize);
    refresh();
  }
  function reset() {
    setDraft(empty);
    setDraftSize(20);
    setSize(20);
    setFilterQuery('');
    setFilterError('');
    refresh();
  }
  return (
    <section className="episode-explorer" id="episode-library" tabIndex={-1} aria-labelledby={`${id}-title`}>
      <div className="episode-overview-heading">
        <div>
          <div className="eyebrow">ATLAS / DISCOVER RECORDED EXPERIENCE</div>
          <h3 id={`${id}-title`}>Episode Explorer</h3>
        </div>
        <button className="secondary-button compact" disabled={loading || !active} onClick={refresh}>
          <RefreshCw size={15} /> Refresh library
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <div className="episode-filter-grid">
          {(Object.keys(fields) as (keyof typeof fields)[]).map((key) => (
            <div key={key}>
              <label htmlFor={`${id}-${key}`}>{fields[key].label}</label>
              <select
                id={`${id}-${key}`}
                value={draft[key]}
                onChange={(e) => setDraft((previous) => ({ ...previous, [key]: e.target.value }))}
              >
                <option value="">All</option>
                {fields[key].options.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div>
            <label htmlFor={`${id}-from`}>From (UTC)</label>
            <input
              id={`${id}-from`}
              type="date"
              value={draft.from}
              onChange={(e) => setDraft((previous) => ({ ...previous, from: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor={`${id}-to`}>Through (UTC)</label>
            <input
              id={`${id}-to`}
              type="date"
              value={draft.to}
              onChange={(e) => setDraft((previous) => ({ ...previous, to: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor={`${id}-size`}>Episodes per page</label>
            <select
              id={`${id}-size`}
              value={draftSize}
              onChange={(e) => setDraftSize(Number(e.target.value))}
            >
              {[5, 10, 20, 50].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="episode-filter-actions">
          <button className="primary-button" disabled={loading}>
            Apply filters
          </button>
          <button className="text-button" type="button" onClick={reset} disabled={loading}>
            Reset filters
          </button>
        </div>
        {filterError && (
          <p className="operation-error" role="alert">
            {filterError}
          </p>
        )}
      </form>
      <EpisodeSemanticSearch
        active={active}
        filterQuery={filterQuery}
        revision={revision + refreshVersion}
        replayDisabled={replayDisabled}
        onLoad={onLoad}
      />
      <EpisodeOverview
        key={filterQuery}
        active={active}
        revision={`${revision}:${refreshVersion}`}
        filterQuery={filterQuery}
      />
      <div className="episode-results" aria-busy={loading}>
        <h4>Saved physics episodes</h4>
        {loading && <p role="status">Loading matching episodes…</p>}
        {error && (
          <p className="operation-error" role="alert">
            {error} Use Refresh library to try again.
          </p>
        )}
        {data && (
          <>
            <p className="muted" role="status">
              Page {cursors.length} · {data.episodes.length} shown. Overview totals cover all matching
              episodes.
            </p>
            {!data.episodes.length && <p>No saved episodes match these filters.</p>}
            <div className="episode-result-list">
              {data.episodes.map((item) => (
                <article key={item.id}>
                  <button
                    className="episode-replay-button"
                    disabled={replayDisabled}
                    onClick={() => onLoad(item.id)}
                  >
                    <span>
                      <strong>{item.site}</strong>
                      <small>
                        {item.startedAt && Number.isFinite(Date.parse(item.startedAt))
                          ? new Date(item.startedAt).toLocaleString()
                          : 'Date not recorded'}
                      </small>
                      <small>{item.robots.map((robot) => label('robot', robot)).join(' · ')}</small>
                    </span>
                    <span>
                      {item.durationS === null ? 'Duration unknown' : `${item.durationS.toFixed(1)} s`} ·{' '}
                      {label('termination', item.termination)} · Replay
                    </span>
                  </button>
                  <a
                    className="secondary-button compact"
                    href={item.downloadUrl}
                    download
                    aria-label={`Download ${item.site} episode ${item.id} MCAP`}
                  >
                    <Download size={14} /> MCAP
                  </a>
                </article>
              ))}
            </div>
          </>
        )}
        <div className="episode-pagination">
          <button
            className="secondary-button compact"
            disabled={loading || cursors.length <= 1}
            onClick={() => setCursors((previous) => previous.slice(0, -1))}
          >
            Previous page
          </button>
          <button
            className="secondary-button compact"
            disabled={loading || !data?.nextCursor}
            onClick={() => {
              if (data?.nextCursor) setCursors((previous) => [...previous, data.nextCursor]);
            }}
          >
            Next page
          </button>
        </div>
      </div>
    </section>
  );
}
