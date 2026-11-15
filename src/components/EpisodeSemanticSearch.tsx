import { useEffect, useId, useRef, useState } from 'react';
import { Search, Download } from 'lucide-react';
import type { EpisodeSearchResult, EpisodeSearchStatus } from '../simulation/episodeSearch';

export function EpisodeSemanticSearch({
  active,
  filterQuery,
  revision,
  replayDisabled,
  onLoad,
}: {
  active: boolean;
  filterQuery: string;
  revision: number;
  replayDisabled: boolean;
  onLoad: (id: string) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [status, setStatus] = useState<EpisodeSearchStatus | null>(null);
  const [result, setResult] = useState<EpisodeSearchResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    request.current?.abort();
    setBusy(false);
    setResult(null);
    setError('');
    setStatus(null);
    if (!active) return;
    const controller = new AbortController();
    void fetch('/api/episodes/search/status', {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? 'Search status is unavailable.');
        return body;
      })
      .then((body) => {
        if (!controller.signal.aborted) setStatus(body);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Semantic search status is unavailable. You can still browse episodes below.');
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [active, filterQuery, revision]);
  async function search() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setSearchedQuery(query.trim());
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/episodes/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          filters: Object.fromEntries(new URLSearchParams(filterQuery)),
          limit: 10,
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Semantic search is unavailable.');
      if (!controller.signal.aborted) setResult(body);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Search failed. Try again.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="episode-semantic-search" aria-busy={busy}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label htmlFor={`${id}-query`}>
          Search by meaning <span className="muted">Preview</span>
        </label>
        <div className="episode-semantic-input">
          <input
            id={`${id}-query`}
            type="search"
            maxLength={500}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try “rovers that tipped over”"
            aria-describedby={`${id}-help`}
          />
          <button
            className="primary-button"
            disabled={!active || busy || !query.trim() || status?.status !== 'ready'}
          >
            <Search size={16} /> {busy ? 'Searching…' : 'Search episodes'}
          </button>
        </div>
        <p id={`${id}-help`} className="muted">
          Searches recorded episode summaries using your applied filters. New recordings may take a moment to
          appear.
        </p>
      </form>
      {status && status.status !== 'ready' && (
        <p role="status" className="muted">
          {status.status === 'not_configured'
            ? 'Semantic search is not activated yet. Browse with exact filters below.'
            : 'The semantic index is not ready. Refresh the library to check again.'}
        </p>
      )}
      {error && (
        <p role="alert" className="operation-error">
          {error}
        </p>
      )}
      {result && (
        <div className="episode-search-results">
          <p role="status">
            {result.episodes.length
              ? `${result.episodes.length} closest matches for “${searchedQuery}”`
              : 'No current episodes matched this search and its filters.'}
          </p>
          {(result.projectionUpdates > 0 || result.omittedStale > 0) && (
            <p className="muted">
              The library has changed. Outdated matches are omitted; retry shortly as indexing catches up.
            </p>
          )}
          {result.episodes.map((episode) => (
            <article key={episode.id}>
              <div>
                <strong>{episode.site}</strong>
                <p className="muted">
                  {episode.startedAt ? new Date(episode.startedAt).toLocaleString() : 'Date not recorded'}
                </p>
                <p>{episode.summary}</p>
              </div>
              <div className="episode-filter-actions">
                <button
                  className="secondary-button compact"
                  disabled={replayDisabled}
                  onClick={() => onLoad(episode.id)}
                >
                  Replay episode
                </button>
                <a
                  className="text-button"
                  href={episode.downloadUrl}
                  download
                  aria-label={`Download matching ${episode.site} episode ${episode.id}`}
                >
                  <Download size={14} /> MCAP
                </a>
              </div>
            </article>
          ))}
          <p className="muted">
            Ranked by similarity · Atlas / {result.model}. Similarity does not establish training eligibility.
          </p>
        </div>
      )}
    </div>
  );
}
