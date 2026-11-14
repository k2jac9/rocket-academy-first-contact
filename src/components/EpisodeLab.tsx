import { useEffect, useRef, useState } from 'react';
import { PHYSICS_ROBOTS } from '../simulation/episode';
import type { EpisodeJob, EpisodeRecord, EpisodeRequest, TerrainPatch } from '../simulation/episode';
import { PhysicsScene } from './PhysicsScene';
import { RobotCatalog } from './RobotCatalog';
import type { FleetRobotId } from '../robots/catalog';
import type { ScenarioRecord } from '../scenarios/contracts';
import { SITE_LOCATIONS, type SurfaceSiteId } from '../domain/surfaceSites';
import { getSource } from '../domain/mission';
import { NarrationPanel } from './NarrationPanel';
import { EpisodeExplorer } from './EpisodeExplorer';
import { missionNarration, replayNarration } from '../simulation/narration';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init),
    body = await response.json().catch(() => null);
  if (!body)
    throw new Error('The episode service is unavailable. Wait for the local server, then try again.');
  if (!response.ok) throw new Error(body.error?.message ?? 'The episode request failed.');
  return body as T;
}
export function EpisodeLab({
  active,
  patch,
  error,
  capturing,
  canCapture,
  onCapture,
  onOpenTerrain,
  catalogFleet,
  scenarioVersion,
  selectedSite,
}: {
  active: boolean;
  patch: TerrainPatch | null;
  error: string;
  capturing: boolean;
  canCapture: boolean;
  onCapture: () => void;
  onOpenTerrain: (site: SurfaceSiteId) => void;
  selectedSite: SurfaceSiteId;
  catalogFleet?: { modelId: FleetRobotId; sequence: number };
  scenarioVersion?: ScenarioRecord;
}) {
  const [models, setModels] = useState<EpisodeRequest['robotModels']>(['husky', 'jackal']);
  const [duration, setDuration] = useState(12),
    [speed, setSpeed] = useState(0.35),
    [seed, setSeed] = useState(1);
  const [job, setJob] = useState<EpisodeJob | null>(null),
    [message, setMessage] = useState(''),
    [submitting, setSubmitting] = useState(false);
  const [record, setRecord] = useState<EpisodeRecord | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0),
    [playing, setPlaying] = useState(false);
  const generation = useRef(0);
  const episode = record?.episode ?? null,
    frame = episode?.frames[frameIndex] ?? null;
  const busy = submitting || job?.state === 'running';
  const [activeScenario, setActiveScenario] = useState<ScenarioRecord | null>(null);
  const previousPatch = useRef(patch);
  useEffect(() => {
    if (busy || previousPatch.current === patch) return;
    previousPatch.current = patch;
    setRecord(null);
    setJob(null);
    setPlaying(false);
    setFrameIndex(0);
  }, [patch, busy]);
  const terrainSite = activeScenario?.execution.terrain ?? selectedSite;
  const terrainSource = getSource(terrainSite);
  const patchMatchesScenario = !activeScenario || patch?.source.id === activeScenario.execution.terrain;
  const appliedScenario = useRef<ScenarioRecord | undefined>(undefined);
  useEffect(() => {
    if (!scenarioVersion || busy || appliedScenario.current === scenarioVersion) return;
    appliedScenario.current = scenarioVersion;
    setModels(scenarioVersion.input.robotModels);
    setDuration(scenarioVersion.input.durationS);
    setSpeed(scenarioVersion.input.speedMps);
    setSeed(scenarioVersion.input.seed);
    setActiveScenario(scenarioVersion);
  }, [scenarioVersion, busy]);
  const appliedCatalogFleet = useRef(0);
  useEffect(() => {
    if (catalogFleet && !busy && appliedCatalogFleet.current !== catalogFleet.sequence) {
      appliedCatalogFleet.current = catalogFleet.sequence;
      setActiveScenario(null);
      setModels((previous) => [catalogFleet.modelId, previous[1]]);
    }
  }, [catalogFleet, busy]);
  useEffect(() => {
    return () => {
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (job?.state !== 'running') return;
    let disposed = false;
    const timer = setInterval(() => {
      void api<EpisodeJob>(`/api/episodes/${job.id}`)
        .then((next) => {
          if (disposed) return;
          setJob(next);
          if (next.record) {
            setRecord(next.record);
            setFrameIndex(0);
            setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches);
            setHistoryRevision((value) => value + 1);
          }
        })
        .catch((e) => {
          if (!disposed) setMessage(e.message);
        });
    }, 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.state]);
  useEffect(() => {
    if (!playing || !episode) return;
    let raf = 0;
    const start = performance.now(),
      initial = episode.frames[frameIndex]?.elapsedS ?? 0;
    const animate = (now: number) => {
      const t = initial + (now - start) / 1000;
      let index = 0;
      while (index + 1 < episode.frames.length && episode.frames[index + 1].elapsedS <= t) index++;
      setFrameIndex(index);
      if (t >= episode.durationS) setPlaying(false);
      else raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [playing, episode]);
  async function run() {
    if (!patch || busy || !patchMatchesScenario) return;
    const token = ++generation.current;
    setSubmitting(true);
    setMessage('');
    setPlaying(false);
    try {
      const next = await api<EpisodeJob>('/api/episodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          terrain: patch,
          durationS: duration,
          speedMps: speed,
          seed,
          robotModels: models,
          ...(activeScenario ? { scenarioVersionId: activeScenario.id } : {}),
        }),
      });
      if (token !== generation.current) return;
      setJob(next);
      setRecord(next.record ?? null);
      if (next.record) setHistoryRevision((value) => value + 1);
      setFrameIndex(0);
    } catch (e) {
      if (token === generation.current) setMessage(e instanceof Error ? e.message : 'Episode failed.');
    } finally {
      if (token === generation.current) setSubmitting(false);
    }
  }
  async function load(id: string) {
    if (busy) return;
    setPlaying(false);
    setMessage('');
    try {
      const next = await api<EpisodeJob>(`/api/episodes/${id}`);
      setJob(next);
      setRecord(next.record ?? null);
      setFrameIndex(0);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not load episode.');
    }
  }
  const displayTerrain = episode?.input.terrain ?? patch;
  return (
    <section className="episode-lab" id="episode-lab" tabIndex={-1} aria-labelledby="episode-lab-title">
      <div className="episode-lab-heading">
        <div>
          <div className="eyebrow">SYNTHETIC DATA LAB / PHYSICS PILOT</div>
          <h2 id="episode-lab-title">
            Real robots.
            <br />
            New worlds.
          </h2>
          <p>Choose your fleet, explore Earth, Moon or Mars, and record a shared simulation.</p>
        </div>
        <div className="episode-heading-actions">
          <button
            className="secondary-button"
            onClick={() => {
              const panel = document.getElementById('episode-library');
              panel?.focus({ preventScroll: true });
              panel?.scrollIntoView({
                behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
                block: 'start',
              });
            }}
          >
            Episode Explorer
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              const panel = document.getElementById('mission-audio');
              panel?.focus({ preventScroll: true });
              panel?.scrollIntoView({
                behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
                block: 'center',
              });
            }}
          >
            Mission audio
          </button>
          <span className="episode-pill">Experimental · MuJoCo</span>
        </div>
      </div>
      <RobotCatalog
        disabled={busy || Boolean(activeScenario)}
        onSelect={(id, slot) =>
          setModels((previous) => {
            const next = [...previous] as EpisodeRequest['robotModels'];
            next[slot] = id;
            return next;
          })
        }
      />
      {activeScenario && (
        <section className="episode-scenario-banner">
          <div className="eyebrow">FROZEN SCENARIO / GENIE-INSPIRED</div>
          <h3>{activeScenario.input.title}</h3>
          <p>
            Reference traverse on {activeScenario.execution.body} · Settings pinned to scenario{' '}
            {activeScenario.id}. Inspired by a {activeScenario.inspiredBy.body} exploration; generated imagery
            does not define the physical terrain.
          </p>
          <button className="secondary-button" disabled={busy} onClick={() => setActiveScenario(null)}>
            Detach scenario to edit settings
          </button>
        </section>
      )}
      <div className="episode-builder-heading">
        <div className="eyebrow">BUILD AN EPISODE</div>
        <h3>Your fleet, on the surface.</h3>
      </div>
      <div className="episode-lab-grid">
        <div className="episode-setup">
          <h3>1 / Terrain</h3>
          <label className="episode-field">
            <span>Surface site</span>
            <select
              aria-label="Surface site"
              value={terrainSite}
              disabled={busy || Boolean(activeScenario)}
              onChange={(event) => onOpenTerrain(event.target.value as SurfaceSiteId)}
            >
              <option value="dingo-gap">Mars · Dingo Gap</option>
              <option value="apollo-17">Moon · Apollo 17</option>
              <option value="amboy-crater">Earth · Amboy Crater</option>
            </select>
          </label>
          <p>
            {terrainSource.label} · {terrainSource.provider}
            <br />
            16 × 16 m crop · 0.25 m sampling
          </p>
          <button className="secondary-button" onClick={() => onOpenTerrain(terrainSite)} disabled={busy}>
            Open {SITE_LOCATIONS[terrainSite].label} in the map
          </button>
          <button
            className="secondary-button"
            onClick={onCapture}
            disabled={!canCapture || capturing || busy}
          >
            {capturing ? 'Capturing terrain…' : 'Freeze terrain around rover'}
          </button>
          {patch && (
            <p className="episode-ready">
              {patch.source.label} · 4,225 elevations frozen · source revision recorded
            </p>
          )}
          {patch && !patchMatchesScenario && (
            <p role="alert" className="operation-error">
              This patch belongs to another site. Open {terrainSource.label} and freeze its terrain.
            </p>
          )}
          <p className="muted">
            {terrainSource.resolutionLabel}. The 0.25 m export grid interpolates the source; it adds no
            measured detail.
          </p>
          {!canCapture && !patch && (
            <p className="muted">Open a surface site, then place the rover within the measured terrain.</p>
          )}
          {error && (
            <p role="alert" className="operation-error">
              {error}
            </p>
          )}
          <h3>2 / Robots</h3>
          {models.map((selected, index) => (
            <label className="episode-field" key={index}>
              <span>
                <i style={{ background: index === 0 ? '#67d9c6' : '#f3b67c' }} />
                Robot {index + 1}
              </span>
              <select
                aria-label={`Robot ${index + 1} model`}
                disabled={busy || Boolean(activeScenario)}
                value={selected}
                onChange={(event) =>
                  setModels((previous) => {
                    const next = [...previous] as EpisodeRequest['robotModels'];
                    next[index] = event.target.value as EpisodeRequest['robotModels'][number];
                    return next;
                  })
                }
              >
                {PHYSICS_ROBOTS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              <small>
                {PHYSICS_ROBOTS.find((m) => m.id === selected)!.massKg.toFixed(1)} kg model mass · four driven
                wheels
              </small>
            </label>
          ))}
          <h3>3 / Episode</h3>
          <div className="episode-parameters">
            <label>
              Duration
              <select
                aria-label="Episode duration"
                disabled={busy || Boolean(activeScenario)}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                <option value={5}>5 s</option>
                <option value={12}>12 s</option>
                <option value={20}>20 s</option>
              </select>
            </label>
            <label>
              Speed
              <select
                aria-label="Robot speed"
                disabled={busy || Boolean(activeScenario)}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                <option value={0.2}>0.2 m/s</option>
                <option value={0.35}>0.35 m/s</option>
                <option value={0.5}>0.5 m/s</option>
              </select>
            </label>
            <label>
              Seed
              <input
                aria-label="Episode seed"
                type="number"
                min={0}
                max={4294967295}
                step={1}
                disabled={busy || Boolean(activeScenario)}
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
              />
            </label>
          </div>
          <button
            className="primary-button"
            disabled={
              !patch ||
              !patchMatchesScenario ||
              busy ||
              !Number.isSafeInteger(seed) ||
              seed < 0 ||
              seed > 4294967295
            }
            onClick={() => void run()}
          >
            {busy ? 'Generating episode…' : 'Generate & save episode'}
          </button>
          <p className="muted">
            Atlas stores the episode. MCAP includes terrain, robot configuration, state/action pairs,
            contacts, RGB and depth.
          </p>
          <p role="status">{message || job?.message}</p>
        </div>
        <div className="episode-review">
          {displayTerrain ? (
            <PhysicsScene terrain={displayTerrain} episode={episode} frame={frame} models={models} />
          ) : (
            <div className="episode-empty">
              <div className="episode-fleet-preview">
                {models.map((id, index) => (
                  <figure key={index}>
                    <img
                      src={`/robots/${id}/preview.webp`}
                      alt={PHYSICS_ROBOTS.find((r) => r.id === id)!.label}
                    />
                    <figcaption>
                      ROBOT {index + 1} / {PHYSICS_ROBOTS.find((r) => r.id === id)!.label}
                    </figcaption>
                  </figure>
                ))}
              </div>
              <strong>Your terrain becomes a shared robot world.</strong>
              <p>
                Freeze a patch to preview the collision surface. Choose two robot models, then generate their
                episode.
              </p>
            </div>
          )}
          {episode && (
            <>
              <p className="episode-model-caption">
                Recorded fleet: {episode.robotModels.map((robot) => robot.label).join(' + ')}
              </p>
              <div className="episode-playback">
                <button
                  className="secondary-button"
                  onClick={() => {
                    if (frameIndex === episode.frames.length - 1) setFrameIndex(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? 'Pause episode' : 'Play episode'}
                </button>
                <input
                  type="range"
                  aria-label="Physics episode timeline"
                  min={0}
                  max={episode.frames.length - 1}
                  value={frameIndex}
                  onChange={(e) => {
                    setPlaying(false);
                    setFrameIndex(Number(e.target.value));
                  }}
                />
                <span>
                  {frame?.elapsedS.toFixed(1)} / {episode.durationS.toFixed(1)} s
                </span>
              </div>
              <div className="episode-metrics">
                <span>
                  <strong>2</strong> shared-world robots
                </span>
                <span>
                  <strong>{episode.frames.length}</strong> state frames
                </span>
                <span>
                  <strong>{episode.sensorSamples}</strong> RGB + depth pairs
                </span>
                <a className="secondary-button" href={record!.downloadUrl} download>
                  Download MCAP
                </a>
              </div>
              {episode.lineage && (
                <p className="episode-outcome">
                  Physical simulation · Scenario {episode.lineage.scenarioVersionId} · Inspired by exploration{' '}
                  {episode.lineage.inspiredBy.explorationId}
                </p>
              )}
              <p className="episode-outcome">
                Outcome: {episode.termination.replaceAll('_', ' ')} · {episode.input.terrain.source.body}{' '}
                gravity {episode.engine.gravityMps2} m/s²
              </p>
            </>
          )}
          {episode?.cameraPreviews && (
            <div className="episode-camera-previews">
              {episode.cameraPreviews.map((sample) => (
                <figure key={sample.robotId}>
                  <img
                    src={`data:image/png;base64,${sample.rgbPngBase64}`}
                    alt={`${sample.robotId} synthetic front camera at ${sample.elapsedS.toFixed(1)} seconds`}
                  />
                  <figcaption>
                    {sample.robotId} · latest camera · {sample.elapsedS.toFixed(1)} s
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          <p className="episode-limits">
            Source robot geometry and inertias with experimental controls and assumed friction. The view uses
            elevation shading; RGB uses simple materials. Source accuracy, sensor realism and transfer to
            physical robots are not validated. Gravity follows the selected world; soil, atmosphere and
            thermal effects are not modeled.
          </p>
          <NarrationPanel
            active={active}
            title={episode ? 'Replay narration' : 'Mission briefing'}
            initialText={
              episode ? replayNarration(episode) : missionNarration(terrainSource, models, duration)
            }
            fileName={
              episode ? `first-contact-${episode.id}-narration` : `first-contact-${terrainSite}-briefing`
            }
          />
          <EpisodeExplorer
            active={active}
            revision={historyRevision}
            replayDisabled={busy}
            onLoad={(id) => void load(id)}
          />
        </div>
      </div>
    </section>
  );
}
