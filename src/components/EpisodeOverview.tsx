import { useEffect, useId, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { EpisodeStats } from '../simulation/episodeStats';

const labels: Record<string, string> = {
  earth: 'Earth',
  moon: 'Moon',
  mars: 'Mars',
  duration_reached: 'Duration reached',
  rollover: 'Rollover',
  terrain_boundary: 'Terrain boundary',
  husky: 'Husky',
  jackal: 'Jackal',
  scout: 'Scout (legacy)',
  surveyor: 'Surveyor (legacy)',
  unknown: 'Unknown / other',
};
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function EpisodeOverview({
  active,
  revision,
  filterQuery = '',
}: {
  active: boolean;
  revision: string;
  filterQuery?: string;
}) {
  const id = useId();
  const [data, setData] = useState<EpisodeStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);

  async function refresh() {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/episodes/stats${filterQuery ? `?${filterQuery}` : ''}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      const result = await response.json().catch(() => null);
      if (!result) throw new Error('The local API is unavailable. Wait for it to restart, then try again.');
      if (!response.ok) throw new Error(result.error?.message ?? 'The Atlas overview is unavailable.');
      if (!controller.signal.aborted) setData(result);
    } catch (e) {
      if (!controller.signal.aborted) {
        setData(null);
        setError(e instanceof Error ? e.message : 'Could not load the Atlas overview.');
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    if (active) void refresh();
    else {
      operation.current?.abort();
      setBusy(false);
    }
    return () => operation.current?.abort();
  }, [active, revision, filterQuery]);

  const totals = data?.totals;
  const worlds = data?.byBody.filter((item) => item.key !== 'unknown' && item.count > 0).length ?? 0;
  return (
    <section className="episode-overview" aria-labelledby={`${id}-title`} aria-busy={busy}>
      <div className="episode-overview-heading">
        <div>
          <div className="eyebrow">ATLAS / RECORDED EXPERIENCE</div>
          <h3 id={`${id}-title`}>Your episode library</h3>
        </div>
        <button
          className="secondary-button compact"
          disabled={busy || !active}
          onClick={() => void refresh()}
          aria-label="Refresh Atlas episode overview"
        >
          <RefreshCw size={15} aria-hidden="true" /> Refresh
        </button>
      </div>
      <p className="muted">
        {filterQuery
          ? 'All physics episodes matching the applied filters, across every page.'
          : 'All saved physics episodes, across Earth, Moon and Mars.'}
      </p>
      {busy && <p role="status">Updating Atlas overview…</p>}
      {error && (
        <p className="operation-error" role="alert">
          {error} Use Refresh to try again.
        </p>
      )}
      {data && totals && (
        <>
          <dl className="episode-overview-totals">
            <div>
              <dt>Saved episodes</dt>
              <dd>{number.format(totals.episodes)}</dd>
            </div>
            <div>
              <dt>Recorded time</dt>
              <dd>
                {number.format(totals.durationS)} <small>s</small>
              </dd>
            </div>
            <div>
              <dt>RGB / depth pairs</dt>
              <dd>{number.format(totals.sensorSamples)}</dd>
            </div>
            <div>
              <dt>Worlds covered</dt>
              <dd>
                {worlds} <small>/ 3</small>
              </dd>
            </div>
          </dl>
          {totals.episodes === 0 ? (
            <p>No saved physics episodes yet. Generate an episode to begin your library.</p>
          ) : (
            <div className="episode-overview-breakdowns">
              {(
                [
                  ['Worlds', data.byBody],
                  ['Recorded end reasons', data.byTermination],
                  ['Robot models', data.byRobot],
                ] as const
              ).map(([title, rows]) => (
                <div key={title}>
                  <h4>{title}</h4>
                  <dl>
                    {rows.map((row) => (
                      <div key={row.key}>
                        <dt>{labels[row.key] ?? 'Unknown / other'}</dt>
                        <dd>{number.format(row.count)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
          {(totals.durationEpisodes < totals.episodes || totals.sensorEpisodes < totals.episodes) && (
            <p className="episode-overview-note">
              Some records lack valid metrics: duration is available for {totals.durationEpisodes} of{' '}
              {totals.episodes} episodes; camera-pair counts for {totals.sensorEpisodes} of {totals.episodes}.
              Totals include only available measurements.
            </p>
          )}
          <p className="episode-overview-note">
            Robot counts show episodes containing each model; one episode may contain several models. End
            reasons describe how recording stopped. They do not establish task success or training
            eligibility.
          </p>
          <p className="episode-overview-updated muted">
            Updated {new Date(data.updatedAt).toLocaleTimeString()}
          </p>
        </>
      )}
    </section>
  );
}
