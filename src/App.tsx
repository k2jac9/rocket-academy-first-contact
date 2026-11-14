import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Compass,
  Crosshair,
  Database,
  ExternalLink,
  Flag,
  Globe2,
  Layers3,
  Library,
  LockKeyhole,
  Maximize,
  MousePointer2,
  Orbit,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import TerrainScene from './terrain/TerrainScene';
import type { TerrainStatus } from './terrain/types';
import { SOURCES, createMissionManifest, distanceMeters, getSource } from './domain/mission';
import { isSurfaceSite, SITE_FOR_BODY, SITE_LOCATIONS } from './domain/surfaceSites';
import type { MarkerKind, SceneMode, TerrainLayer, TerrainPoint } from './domain/mission';
import { Dialog } from './components/Dialog';
import { RunPanel } from './components/RunPanel';
import { RoverPreview } from './components/RoverPreview';
import { EpisodeLab } from './components/EpisodeLab';
import type { TerrainPatch } from './simulation/episode';
import { createExamplePoints } from './domain/exampleMission';
import type { MissionRun } from './simulation/missionRun';
import type { FleetRobotId } from './robots/catalog';
import type { ScenarioRecord } from './scenarios/contracts';
const CatalogPage = lazy(() => import('./components/CatalogPage'));
const ScenarioStudio = lazy(() => import('./components/ScenarioStudio'));
const workspaceFromHash = () =>
  location.hash.startsWith('#/catalog')
    ? 'catalog'
    : location.hash === '#/lab'
      ? 'lab'
      : location.hash === '#/studio'
        ? 'studio'
        : 'map';

const INITIAL_STATUS: TerrainStatus = {
  state: 'loading',
  message: 'Connecting to NASA terrain…',
  loadedTiles: 0,
};

function formatDistance(distance: number) {
  return distance >= 1000 ? `${(distance / 1000).toFixed(2)} km` : `${distance.toFixed(1)} m`;
}

function Coordinate({ point }: { point: TerrainPoint | null }) {
  return point ? (
    <span className="coordinates">
      {point.x.toFixed(1)} / {point.y.toFixed(1)} / {point.z.toFixed(1)} <span>m</span>
    </span>
  ) : (
    <span className="unset">Choose a point on the terrain</span>
  );
}

export default function App() {
  const [mode, setMode] = useState<SceneMode>('dingo-gap');
  const [layer, setLayer] = useState<TerrainLayer>('terrain');
  const [workspaceView, setWorkspaceView] = useState<'map' | 'lab' | 'catalog' | 'studio'>(workspaceFromHash);
  const [studioActivated, setStudioActivated] = useState(() => workspaceFromHash() === 'studio');
  const [studioScenario, setStudioScenario] = useState<ScenarioRecord>();
  const [mapActivated, setMapActivated] = useState(() => workspaceFromHash() === 'map');
  const [labActivated, setLabActivated] = useState(() => workspaceFromHash() === 'lab');
  useEffect(() => {
    if (workspaceView === 'map') setMapActivated(true);
    if (workspaceView === 'lab') setLabActivated(true);
    if (workspaceView === 'studio') setStudioActivated(true);
  }, [workspaceView]);
  const [catalogFleet, setCatalogFleet] = useState<{ modelId: FleetRobotId; sequence: number }>();
  useEffect(() => {
    const changed = () => setWorkspaceView(workspaceFromHash());
    addEventListener('hashchange', changed);
    return () => removeEventListener('hashchange', changed);
  }, []);
  const navigateWorkspace = (view: 'map' | 'lab' | 'catalog' | 'studio') => {
    setWorkspaceView(view);
    location.hash = `#/${view}`;
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const [showMission, setShowMission] = useState(false);
  const [navigationMode, setNavigationMode] = useState<'map' | 'orbit'>('map');
  const [cameraAction, setCameraAction] = useState<{
    sequence: number;
    kind: 'in' | 'out' | 'north' | 'top';
  }>();
  const [rover, setRover] = useState<TerrainPoint | null>(null);
  const [goal, setGoal] = useState<TerrainPoint | null>(null);
  const [placementMode, setPlacementMode] = useState<MarkerKind | null>(null);
  const [status, setStatus] = useState<TerrainStatus>(INITIAL_STATUS);
  const [resetViewSignal, setResetViewSignal] = useState(0);
  const [retry, setRetry] = useState(0);
  const [missionName, setMissionName] = useState('First traverse');
  const [ionToken, setIonToken] = useState<string>((import.meta.env.VITE_CESIUM_ION_TOKEN ?? '').trim());
  const [tokenDraft, setTokenDraft] = useState('');
  const [dialog, setDialog] = useState<'sources' | 'connection' | 'help' | null>(null);
  const [notice, setNotice] = useState('');
  const [run, setRun] = useState<MissionRun | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(4);
  const [focusMissionSignal, setFocusMissionSignal] = useState(0);
  const [patch, setPatch] = useState<TerrainPatch | null>(null);
  const [patchError, setPatchError] = useState('');
  const [capturingPatch, setCapturingPatch] = useState(false);
  const [capturePatchSignal, setCapturePatchSignal] = useState(0);
  const source = getSource(mode, layer);
  const isReference = source.geometryKind === 'reference-sphere';
  const isLocal = isSurfaceSite(mode);
  const bodyLabel = source.body === 'earth' ? 'Earth' : source.body === 'moon' ? 'Moon' : 'Mars';
  const ready = status.state === 'ready';
  const distance = useMemo(() => (rover && goal ? distanceMeters(rover, goal) : null), [rover, goal]);
  const missionDraft = useMemo(() => {
    if (!rover || !goal || !missionName.trim()) return { manifest: null, error: '' };
    try {
      return { manifest: createMissionManifest({ mode, layer, rover, goal, missionName }), error: '' };
    } catch (error) {
      return {
        manifest: null,
        error: error instanceof Error ? error.message : 'Mission coordinates are invalid.',
      };
    }
  }, [mode, layer, rover, goal, missionName]);
  const onRun = useCallback((next: MissionRun | null) => {
    setRun(next);
    setFrameIndex(0);
    setPlaying(Boolean(next) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (next) setFocusMissionSignal((value) => value + 1);
  }, []);
  const currentFrame = run?.frames[frameIndex] ?? null;
  const trajectory = useMemo(
    () => run?.frames.slice(0, frameIndex + 1).map((frame) => frame.position) ?? [],
    [run, frameIndex],
  );

  useEffect(() => {
    if (!playing || !run) return;
    let animationFrame = 0;
    const start = performance.now();
    const initialTime = run.frames[frameIndex]?.elapsedS ?? 0;
    const animate = (now: number) => {
      const time = initialTime + ((now - start) / 1000) * playbackSpeed;
      let low = 0,
        high = run.frames.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (run.frames[middle]!.elapsedS <= time) low = middle;
        else high = middle - 1;
      }
      setFrameIndex(low);
      if (time >= run.durationS) setPlaying(false);
      else animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
    // The replay clock captures the frame at play/resume, and advances independently.
  }, [playing, run, playbackSpeed]);
  const onStatus = useCallback((next: TerrainStatus) => setStatus(next), []);
  const onPlace = useCallback((kind: MarkerKind, point: TerrainPoint) => {
    if (kind === 'rover') {
      setRover(point);
      setFocusMissionSignal((value) => value + 1);
    } else setGoal(point);
    setRun(null);
    setPlaying(false);
    setPlacementMode(null);
    setNotice(`${kind === 'rover' ? 'Rover start' : 'Science goal'} placed on the terrain.`);
  }, []);

  function changeMode(next: SceneMode) {
    if (mode === next) return;
    setMode(next);
    setLayer(isSurfaceSite(next) ? 'terrain' : 'imagery');
    setPatch(null);
    setPatchError('');
    setRover(null);
    setGoal(null);
    setPlacementMode(null);
    setNotice('');
    setRun(null);
    setPlaying(false);
    setStatus(INITIAL_STATUS);
  }

  function changeLayer(next: TerrainLayer) {
    if (next === layer) return;
    setLayer(next);
    setRover(null);
    setGoal(null);
    setPlacementMode(null);
    setRun(null);
    setPlaying(false);
    setStatus(INITIAL_STATUS);
    setNotice('');
  }

  function loadExample() {
    const points = createExamplePoints(mode);
    setRover(points.rover);
    setGoal(points.goal);
    setPlacementMode(null);
    setRun(null);
    setPlaying(false);
    setFocusMissionSignal((value) => value + 1);
    setNotice(
      'Loaded a 20 m traverse on the reference sphere. Its positions are modeled, not terrain measurements.',
    );
  }

  function selectPlacement(kind: MarkerKind) {
    setPlacementMode((current) => (current === kind ? null : kind));
    setNotice(
      `Select ${kind === 'rover' ? 'a rover starting point' : 'a science goal'} on the terrain, or focus the view and press Enter.`,
    );
  }

  function exportMission() {
    if (!rover || !goal) {
      setNotice('Place a rover start and a science goal before exporting.');
      return;
    }
    try {
      const manifest = createMissionManifest({ mode, layer, rover, goal, missionName });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `first-contact-${mode}-mission.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Mission manifest exported with source, coordinates, and planning status.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The mission could not be exported.');
    }
  }

  function openConnection() {
    setTokenDraft(ionToken);
    setDialog('connection');
  }

  function retryTerrain() {
    setStatus(INITIAL_STATUS);
    setRetry((value) => value + 1);
  }

  return (
    <div className={`app-shell map-first view-${workspaceView} ${showMission ? 'mission-open' : ''}`}>
      <a
        className="skip-link"
        href={
          workspaceView === 'studio'
            ? '#scenario-studio'
            : workspaceView === 'catalog'
              ? '#robot-catalog'
              : workspaceView === 'lab'
                ? '#episode-lab'
                : '#explore-worlds'
        }
        onClick={(event) => {
          event.preventDefault();
          document
            .getElementById(
              workspaceView === 'studio'
                ? 'scenario-studio'
                : workspaceView === 'catalog'
                  ? 'robot-catalog'
                  : workspaceView === 'lab'
                    ? 'episode-lab'
                    : 'explore-worlds',
            )
            ?.focus();
        }}
      >
        {workspaceView === 'studio'
          ? 'Skip to scenario studio'
          : workspaceView === 'catalog'
            ? 'Skip to robot catalog'
            : workspaceView === 'lab'
              ? 'Skip to robot lab'
              : 'Skip to world explorer'}
      </a>
      <header className="topbar">
        <a
          className="brand"
          href="#"
          aria-label="Rocket Academy First Contact home"
          onClick={(event) => {
            event.preventDefault();
            navigateWorkspace('map');
            changeMode('mars');
          }}
        >
          <span className="brand-symbol">
            <Orbit size={32} strokeWidth={1.35} />
          </span>
          <span>
            <strong>ROCKET ACADEMY</strong>
            <span className="brand-subtitle">FIRST CONTACT</span>
          </span>
        </a>
        <nav className="topnav" aria-label="Application">
          <button
            aria-label="Explore worlds"
            className={workspaceView === 'map' ? 'nav-active' : ''}
            aria-pressed={workspaceView === 'map'}
            onClick={() => navigateWorkspace('map')}
          >
            <Compass size={15} /> <span className="nav-label-full">Explore worlds</span>
            <span className="nav-label-short">Worlds</span>
          </button>
          <button
            aria-label="Robot catalog"
            className={workspaceView === 'catalog' ? 'nav-active' : ''}
            aria-pressed={workspaceView === 'catalog'}
            onClick={() => navigateWorkspace('catalog')}
          >
            <Library size={15} /> <span className="nav-label-full">Robot catalog</span>
            <span className="nav-label-short">Catalog</span>
          </button>
          <button
            aria-label="Scenario studio"
            className={workspaceView === 'studio' ? 'nav-active' : ''}
            aria-pressed={workspaceView === 'studio'}
            onClick={() => navigateWorkspace('studio')}
          >
            <Sparkles size={15} /> <span className="nav-label-full">Scenario studio</span>
            <span className="nav-label-short">Studio</span>
          </button>
          <button
            aria-label="Robot lab"
            className={workspaceView === 'lab' ? 'nav-active' : ''}
            aria-pressed={workspaceView === 'lab'}
            onClick={() => navigateWorkspace('lab')}
          >
            <Layers3 size={15} /> <span>Robot lab</span>
          </button>
        </nav>
        <div className="header-meta">
          <button
            className="icon-button"
            onClick={() => setDialog('sources')}
            aria-label="Data sources"
            title="Data sources"
          >
            <Database size={18} />
          </button>
          <span className="edition">
            NASA SPACE APPS <span>2026</span>
          </span>
          <button className="icon-button" onClick={() => setDialog('help')} aria-label="Open help">
            <CircleHelp size={19} />
          </button>
          <button className="icon-button" onClick={openConnection} aria-label="Connection settings">
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      {workspaceView === 'catalog' && (
        <Suspense
          fallback={
            <p className="catalog-loading" role="status">
              Opening robot catalog…
            </p>
          }
        >
          <CatalogPage
            onOpenLab={(modelId) => {
              if (modelId)
                setCatalogFleet((previous) => ({ modelId, sequence: (previous?.sequence ?? 0) + 1 }));
              navigateWorkspace('lab');
            }}
          />
        </Suspense>
      )}

      <div className="workspace-heading">
        <div>
          <div className="eyebrow">
            <span className="tiny-cross">+</span> EXPLORE WORLDS / NASA TERRAIN
          </div>
          <h1>
            A world to explore.
            <br />A fleet to build.
          </h1>
          <p>Real planetary terrain. Shared robot simulations. Reproducible episodes.</p>
        </div>
        <div className="build-badge">
          <span className="status-dot" />
          <span>
            ROBOT EPISODES<span className="badge-sub">First Contact · v0.2</span>
          </span>
        </div>
      </div>

      {mapActivated && (
        <main className="workspace" id="explore-worlds" tabIndex={-1}>
          <aside className="destination-panel" aria-label="Destinations">
            <div className="section-heading">
              <span>01 / DESTINATION</span>
              <Globe2 size={16} />
            </div>
            <h2>Choose your frontier</h2>
            <p className="muted">One mission starts with a place.</p>
            <div className="destination-list">
              {SOURCES.map((item) => (
                <button
                  className={`destination-card ${mode === item.id ? 'selected' : ''}`}
                  key={item.id}
                  aria-pressed={mode === item.id}
                  onClick={() => changeMode(item.id)}
                >
                  <img
                    className={`planet-disc ${item.id} ${item.geometryKind === 'heightfield' ? 'surface-thumb' : ''}`}
                    src={
                      item.geometryKind === 'heightfield'
                        ? item.imageryUrl!
                        : item.id === 'moon'
                          ? '/textures/moon-lroc-color-2k.jpg'
                          : item.id === 'earth'
                            ? '/textures/earth-blue-marble-july2004.jpg'
                            : '/textures/mars-nasa-viking.jpg'
                    }
                    alt=""
                  />
                  <span className="destination-text">
                    <span className="destination-kicker">
                      {isSurfaceSite(item.id)
                        ? `${item.body.toUpperCase()} / SURFACE SITE`
                        : 'GLOBAL EXPLORER'}
                    </span>
                    <strong>{item.label}</strong>
                    <span>
                      {isSurfaceSite(item.id)
                        ? SITE_LOCATIONS[item.id].region
                        : item.id === 'moon'
                          ? 'Our next giant leap'
                          : item.id === 'earth'
                            ? 'Earth analog missions'
                            : 'The red planet, in context'}
                    </span>
                  </span>
                  {mode === item.id ? (
                    <span className="selection-check">
                      <Check size={13} />
                    </span>
                  ) : (
                    <ChevronRight className="destination-chevron" size={16} />
                  )}
                  <span className={`card-tag ${item.requiresToken ? '' : 'open'}`}>
                    {item.requiresToken ? (
                      <>
                        <LockKeyhole size={10} /> ION ACCESS
                      </>
                    ) : (
                      <>
                        <Radio size={10} />{' '}
                        {item.body === 'earth' && isSurfaceSite(item.id)
                          ? 'PUBLIC USGS DATA'
                          : 'PUBLIC NASA DATA'}
                      </>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <div className="site-facts">
              <div className="section-heading">
                <span>SITE INTELLIGENCE</span>
                <span className="tiny-cross">+</span>
              </div>
              <dl>
                <div>
                  <dt>Body</dt>
                  <dd>{bodyLabel}</dd>
                </div>
                <div>
                  <dt>Coverage</dt>
                  <dd>
                    {isLocal
                      ? source.geometryKind === 'heightfield'
                        ? '512 × 512 m site'
                        : 'Local reconstruction'
                      : 'Planetary globe'}
                  </dd>
                </div>
                <div>
                  <dt>Terrain detail</dt>
                  <dd>{source.resolutionLabel}</dd>
                </div>
                <div>
                  <dt>State</dt>
                  <dd>
                    <span className="plan-pill">PLANNING</span>
                  </dd>
                </div>
              </dl>
            </div>
            <div className="source-note">
              <ShieldCheck size={20} />
              <div>
                <strong>Grounded in real observations</strong>
                <p>Every mission keeps its terrain source and coordinate reference.</p>
                <button className="text-button" onClick={() => setDialog('sources')}>
                  Inspect the evidence <ArrowRight size={13} />
                </button>
              </div>
            </div>
          </aside>

          <section className="viewport-column" aria-label="Terrain workspace">
            <div className="viewport-header">
              <div>
                <span className="live-square" />
                {isLocal ? source.label.toUpperCase() : `${bodyLabel.toUpperCase()} ORBIT`}
                <span className="viewport-divider">/</span>
                <span className="viewport-header-muted">
                  {isSurfaceSite(mode)
                    ? SITE_LOCATIONS[mode].region.toUpperCase()
                    : isReference
                      ? 'NASA IMAGERY'
                      : 'GLOBAL TERRAIN'}
                </span>
              </div>
              <button className="text-button" onClick={() => setDialog('sources')}>
                <Layers3 size={13} /> Source layers
              </button>
            </div>
            {!isLocal && (
              <div className="surface-controls" aria-label="Surface layer">
                <div>
                  <button aria-pressed={layer === 'imagery'} onClick={() => changeLayer('imagery')}>
                    <Globe2 size={13} /> NASA globe
                  </button>
                  {(mode === 'moon' || mode === 'mars') && (
                    <button aria-pressed={layer === 'terrain'} onClick={() => changeLayer('terrain')}>
                      <Layers3 size={13} /> Measured terrain <LockKeyhole size={10} />
                    </button>
                  )}
                </div>
                <span>
                  {isReference
                    ? 'Reference sphere · no measured elevation'
                    : 'Cesium ion · measured terrain tiles'}
                </span>
              </div>
            )}
            <div className="surface-site-strip">
              <div>
                <strong>{isLocal ? source.label : SITE_LOCATIONS[SITE_FOR_BODY[source.body]].label}</strong>
                <span
                  title={SITE_LOCATIONS[isSurfaceSite(mode) ? mode : SITE_FOR_BODY[source.body]].evidence}
                >
                  {SITE_LOCATIONS[isSurfaceSite(mode) ? mode : SITE_FOR_BODY[source.body]].coordinates} ·
                  context
                </span>
              </div>
              <button
                className="text-button"
                onClick={() => changeMode(isLocal ? source.body : SITE_FOR_BODY[source.body])}
              >
                {isLocal ? `${bodyLabel} globe` : 'Explore surface site'} <ArrowRight size={13} />
              </button>
            </div>
            <div className={`terrain-viewport ${placementMode ? 'placing' : ''}`}>
              <TerrainScene
                onOpenSite={changeMode}
                onSiteReady={(points) => {
                  setRover((previous) => previous ?? points.rover);
                  setGoal((previous) => previous ?? points.goal);
                }}
                key={`${mode}-${layer}-${retry}`}
                mode={mode}
                layer={layer}
                ionToken={ionToken}
                placementMode={placementMode}
                rover={rover}
                goal={goal}
                onPlace={onPlace}
                onStatus={onStatus}
                resetViewSignal={resetViewSignal}
                robotPosition={currentFrame?.position ?? null}
                trajectory={trajectory}
                focusMissionSignal={focusMissionSignal}
                capturePatchSignal={capturePatchSignal}
                onPatch={(next, error) => {
                  setPatch(next);
                  setPatchError(error ?? '');
                  setCapturingPatch(false);
                  navigateWorkspace('lab');
                }}
                navigationMode={navigationMode}
                cameraAction={cameraAction}
              />
              <div className="map-navigation" aria-label="Map navigation">
                <button
                  aria-label="Zoom in"
                  onClick={() =>
                    setCameraAction((previous) => ({ sequence: (previous?.sequence ?? 0) + 1, kind: 'in' }))
                  }
                >
                  +
                </button>
                <button
                  aria-label="Zoom out"
                  onClick={() =>
                    setCameraAction((previous) => ({ sequence: (previous?.sequence ?? 0) + 1, kind: 'out' }))
                  }
                >
                  −
                </button>
                <span />
                <button
                  aria-label={isLocal ? 'Reset map bearing' : 'Reset globe view'}
                  title="Reset bearing"
                  onClick={() =>
                    setCameraAction((previous) => ({
                      sequence: (previous?.sequence ?? 0) + 1,
                      kind: 'north',
                    }))
                  }
                >
                  <Compass size={20} />
                </button>
                {isLocal && (
                  <>
                    <button
                      aria-label="Top down map view"
                      title="Top down"
                      onClick={() =>
                        setCameraAction((previous) => ({
                          sequence: (previous?.sequence ?? 0) + 1,
                          kind: 'top',
                        }))
                      }
                    >
                      <Layers3 size={19} />
                    </button>
                    <button
                      aria-label="Toggle orbit navigation"
                      aria-pressed={navigationMode === 'orbit'}
                      title={navigationMode === 'map' ? 'Switch to orbit' : 'Switch to map pan'}
                      onClick={() => setNavigationMode((current) => (current === 'map' ? 'orbit' : 'map'))}
                    >
                      <Orbit size={20} />
                    </button>
                  </>
                )}
              </div>
              {rover && ready && (
                <button
                  className="rover-location"
                  title="Kinematic map preview. The robot marker enlarges at distance for visibility."
                  onClick={() => setFocusMissionSignal((value) => value + 1)}
                >
                  <Crosshair size={15} />
                  <span>
                    <strong>Husky · Rover-1</strong>
                    <small>
                      {playing
                        ? 'Replaying episode'
                        : run
                          ? 'Episode ready to replay'
                          : 'Placed · ready to plan'}
                    </small>
                  </span>
                  <span>Find rover</span>
                </button>
              )}
              <div className="viewport-topline">
                <span className="terrain-tag">
                  <span className={`status-dot ${ready ? '' : 'pending'}`} />
                  {ready
                    ? isReference
                      ? 'GLOBE READY'
                      : 'TERRAIN CONNECTED'
                    : status.state === 'token-required'
                      ? 'CONNECTION REQUIRED'
                      : status.state === 'error'
                        ? 'CONNECTION INTERRUPTED'
                        : 'ACQUIRING TERRAIN'}
                </span>
                <span className="scale-label">{isReference ? 'REFERENCE SPHERE' : 'SOURCE TERRAIN'}</span>
              </div>
              <div className="compass" aria-hidden="true">
                <span>VIEW</span>
                <Compass size={27} strokeWidth={1} />
              </div>
              {status.state === 'loading' && (
                <div className="scene-message">
                  <span className="loading-orbit">
                    <Orbit size={35} strokeWidth={1} />
                  </span>
                  <h3>Approaching {mode === 'dingo-gap' ? 'Dingo Gap' : source.label}.</h3>
                  <p>{status.message}</p>
                  <span className="message-caption">
                    {isReference ? 'Loading public NASA imagery' : 'Streaming the original terrain tiles'}
                  </span>
                </div>
              )}
              {status.state === 'token-required' && (
                <div className="scene-message">
                  <span className="message-symbol">
                    <Globe2 size={31} strokeWidth={1.2} />
                  </span>
                  <h3>{source.label} awaits.</h3>
                  <p>Connect a Cesium ion read-only token to stream the measured terrain layer.</p>
                  <button className="primary-button compact" onClick={openConnection}>
                    Connect terrain <ArrowRight size={15} />
                  </button>
                  <button className="text-button" onClick={() => changeLayer('imagery')}>
                    Return to the public globe
                  </button>
                </div>
              )}
              {status.state === 'error' && (
                <div className="scene-message error-message">
                  <TriangleAlert size={30} strokeWidth={1.3} />
                  <h3>Terrain connection interrupted.</h3>
                  <p>{status.message}</p>
                  <button className="primary-button compact" onClick={retryTerrain}>
                    Retry connection <RotateCcw size={15} />
                  </button>
                  {source.requiresToken && (
                    <button className="text-button" onClick={openConnection}>
                      Check ion connection
                    </button>
                  )}
                </div>
              )}
              {ready && placementMode && (
                <div className="placement-instruction">
                  <Crosshair size={15} /> Click the terrain to place your{' '}
                  {placementMode === 'rover' ? 'rover' : 'science goal'}
                  <button aria-label="Cancel marker placement" onClick={() => setPlacementMode(null)}>
                    <X size={14} />
                  </button>
                </div>
              )}
              {ready &&
                !status.message.startsWith('Live terrain ready') &&
                !status.message.startsWith('Global NASA imagery ready') && (
                  <div className="terrain-warning" role="status">
                    <span>{status.message}</span>
                    {status.message.includes('Retry terrain') && (
                      <button className="text-button" onClick={retryTerrain}>
                        Retry terrain <RotateCcw size={13} />
                      </button>
                    )}
                  </div>
                )}
              <div className="viewport-bottomline">
                <span>{source.credit}</span>
                <button
                  aria-label="Reset terrain camera"
                  className="viewport-reset"
                  onClick={() => setResetViewSignal((x) => x + 1)}
                >
                  <Maximize size={16} />
                </button>
              </div>
            </div>
            <div className="terrain-toolbar">
              <div className="placement-tools">
                <button
                  className={placementMode === 'rover' ? 'tool-active' : ''}
                  disabled={!ready}
                  aria-pressed={placementMode === 'rover'}
                  onClick={() => selectPlacement('rover')}
                >
                  <Crosshair size={16} />
                  <span>Place rover</span>
                  <kbd>01</kbd>
                </button>
                <span className="tool-separator" />
                <button
                  className={placementMode === 'goal' ? 'tool-active' : ''}
                  disabled={!ready}
                  aria-pressed={placementMode === 'goal'}
                  onClick={() => selectPlacement('goal')}
                >
                  <Flag size={15} />
                  <span>Set goal</span>
                  <kbd>02</kbd>
                </button>
              </div>
              <button
                className="map-lab-action"
                disabled={!isLocal || !ready || !rover || capturingPatch}
                onClick={() => {
                  setCapturingPatch(true);
                  setPatchError('');
                  setCapturePatchSignal((v) => v + 1);
                }}
              >
                <Layers3 size={14} />
                {capturingPatch ? 'Freezing…' : 'Use patch in robot lab'}
              </button>
              <button
                className="map-mission-toggle"
                aria-pressed={showMission}
                onClick={() => setShowMission((v) => !v)}
              >
                Mission tools
              </button>
              <button className="orbit-help" onClick={() => setDialog('help')}>
                <MousePointer2 size={14} />
                <span>{navigationMode === 'map' ? 'Drag to pan' : 'Drag to orbit'} · Scroll to zoom</span>
              </button>
            </div>
            {run && currentFrame && (
              <div className="replay-panel" aria-label="Episode replay">
                <div className="replay-heading">
                  <span>
                    <span className="status-dot" /> EPISODE REPLAY
                  </span>
                  <span>
                    {currentFrame.elapsedS.toFixed(1)} / {run.durationS.toFixed(1)} s
                  </span>
                </div>
                <div className="replay-controls">
                  <button
                    className="icon-button"
                    aria-label={playing ? 'Pause replay' : 'Play replay'}
                    onClick={() => {
                      if (!playing && frameIndex === run.frames.length - 1) setFrameIndex(0);
                      setPlaying((value) => !value);
                    }}
                  >
                    {playing ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <input
                    aria-label="Replay position"
                    type="range"
                    min={0}
                    max={run.frames.length - 1}
                    value={frameIndex}
                    onChange={(event) => {
                      setPlaying(false);
                      setFrameIndex(Number(event.target.value));
                    }}
                  />
                  <select
                    aria-label="Replay speed"
                    value={playbackSpeed}
                    onChange={(event) => setPlaybackSpeed(Number(event.target.value))}
                  >
                    {[1, 4, 10].map((speed) => (
                      <option key={speed} value={speed}>
                        {speed}×
                      </option>
                    ))}
                  </select>
                </div>
                <div className="replay-metrics">
                  <span>{currentFrame.mode}</span>
                  <span>{currentFrame.speedMps.toFixed(2)} m/s</span>
                  <span>{currentFrame.distanceToGoalM.toFixed(2)} m to goal</span>
                  <button className="text-button" onClick={() => setFocusMissionSignal((value) => value + 1)}>
                    Focus mission <Crosshair size={12} />
                  </button>
                </div>
                <p>Playback of recorded kinematic states. Speed controls change viewing time only.</p>
              </div>
            )}
            <div className="mission-context">
              <div className="context-number">
                FC<span>/001</span>
              </div>
              <div>
                <span className="eyebrow">YOUR FIELD OF POSSIBILITY</span>
                <h3>
                  {isLocal
                    ? mode === 'dingo-gap'
                      ? 'Where Curiosity found a way through.'
                      : mode === 'apollo-17'
                        ? 'Return to Taurus–Littrow.'
                        : 'A volcanic world, here on Earth.'
                    : mode === 'moon'
                      ? 'A familiar world. Unexplored possibilities.'
                      : 'A planet of possibilities.'}
                </h3>
                <p>
                  {isLocal
                    ? source.summary
                    : isReference
                      ? 'Start with a whole-world view, load a short example traverse, then plan and record a robot episode. This imagery layer supplies context without measured elevation.'
                      : 'Explore measured planetary terrain and choose mission points. The prototype rover follows a kinematic path without evaluating terrain contact.'}
                </p>
              </div>
              <Sparkles size={23} className="context-star" strokeWidth={1.2} />
            </div>
          </section>

          <aside className="mission-panel" id="mission-controls" aria-label="Mission controls">
            <section className="robot-card" aria-label="Your robot">
              <div className="robot-card-heading">
                <span>YOUR ROBOT</span>
                <span>{rover ? 'DEPLOYED' : 'READY TO PLACE'}</span>
              </div>
              <RoverPreview />
              <div className="robot-card-name">
                <strong>Clearpath Husky</strong>
                <span>Rover-1 · four wheels</span>
              </div>
              <p>Source robot geometry · Kinematic map preview. Open Robot lab for contact physics.</p>
              <button
                className="example-button"
                disabled={!isReference && !ready}
                onClick={() => {
                  if (rover) setFocusMissionSignal((value) => value + 1);
                  else if (isReference) loadExample();
                  else selectPlacement('rover');
                }}
              >
                <Crosshair size={14} />{' '}
                {rover
                  ? 'Show rover on terrain'
                  : isReference
                    ? 'Deploy rover · 20 m example'
                    : 'Place rover on terrain'}{' '}
                <ArrowRight size={13} />
              </button>
            </section>
            <div className="section-heading">
              <span>02 / MISSION BRIEF</span>
              <span className="draft-tag">{run ? 'RECORDED' : 'DRAFT'}</span>
            </div>
            <label className="mission-name-label" htmlFor="mission-name">
              Mission name
            </label>
            <input
              className="mission-name"
              id="mission-name"
              value={missionName}
              maxLength={80}
              onChange={(event) => {
                setMissionName(event.target.value);
                setRun(null);
                setPlaying(false);
              }}
            />
            <p className="muted mission-description">Define a short traverse for your exploration robot.</p>
            {isReference && (
              <button className="example-button" onClick={loadExample}>
                <Sparkles size={14} /> Load 20 m example <ArrowRight size={13} />
              </button>
            )}
            {rover && goal && (
              <button
                className="text-button focus-mission"
                disabled={!ready}
                onClick={() => setFocusMissionSignal((value) => value + 1)}
              >
                Focus mission <Crosshair size={12} />
              </button>
            )}
            <div className="mission-steps">
              <div className={`mission-step ${rover ? 'complete' : ''}`}>
                <div className="step-line">
                  <span className="step-node">{rover ? <Check size={12} /> : '1'}</span>
                  <h3>Rover start</h3>
                  {rover && (
                    <button
                      className="text-button small"
                      disabled={!ready}
                      onClick={() => selectPlacement('rover')}
                    >
                      Edit
                    </button>
                  )}
                </div>
                <div className="step-content">
                  <Coordinate point={rover} />
                  {!rover && (
                    <button
                      className="secondary-button"
                      disabled={!ready}
                      onClick={() => selectPlacement('rover')}
                    >
                      <Crosshair size={14} /> Place starting point
                    </button>
                  )}
                </div>
              </div>
              <div className={`mission-step goal-step ${goal ? 'complete' : ''}`}>
                <div className="step-line">
                  <span className="step-node">{goal ? <Check size={12} /> : '2'}</span>
                  <h3>Science goal</h3>
                  {goal && (
                    <button
                      className="text-button small"
                      disabled={!ready}
                      onClick={() => selectPlacement('goal')}
                    >
                      Edit
                    </button>
                  )}
                </div>
                <div className="step-content">
                  <Coordinate point={goal} />
                  {!goal && (
                    <button
                      className="secondary-button"
                      disabled={!ready}
                      onClick={() => selectPlacement('goal')}
                    >
                      <Flag size={14} /> Choose destination
                    </button>
                  )}
                </div>
              </div>
              <div className="mission-step">
                <div className="step-line">
                  <span className={`step-node ${rover && goal ? 'export-ready' : ''}`}>3</span>
                  <h3>Plan the robot episode</h3>
                </div>
                <div className="step-content">
                  <p>Use a baseline or Gemini plan, run the rover, and export its recording.</p>
                </div>
              </div>
            </div>
            <div className="distance-card">
              <div>
                <span className="eyebrow">START → GOAL</span>
                <strong>
                  {distance === null ? (
                    <span className="distance-placeholder">
                      — <small>m</small>
                    </span>
                  ) : (
                    formatDistance(distance)
                  )}
                </strong>
              </div>
              <span className="distance-caption">
                Straight-line distance
                <br />
                Terrain route not evaluated
              </span>
            </div>
            <div className="mission-actions">
              <button
                className="primary-button"
                disabled={!rover || !goal || !missionName.trim()}
                onClick={exportMission}
              >
                <ArrowDownToLine size={17} /> Export plan JSON <ArrowRight size={16} />
              </button>
              <button
                className="text-button reset-mission"
                disabled={!rover && !goal}
                onClick={() => {
                  setRover(null);
                  setGoal(null);
                  setPlacementMode(null);
                  setRun(null);
                  setPlaying(false);
                  setNotice('Mission markers cleared.');
                }}
              >
                <RotateCcw size={12} /> Clear markers
              </button>
            </div>
            {missionDraft.error && (
              <p className="operation-error" role="alert">
                {missionDraft.error}
              </p>
            )}
            <RunPanel
              mission={missionDraft.manifest}
              body={source.body}
              run={run}
              onRun={onRun}
              onNotice={setNotice}
              onConnection={openConnection}
            />
          </aside>
        </main>
      )}

      {labActivated && (
        <EpisodeLab
          active={workspaceView === 'lab'}
          selectedSite={isSurfaceSite(mode) ? mode : SITE_FOR_BODY[source.body]}
          scenarioVersion={studioScenario}
          catalogFleet={catalogFleet}
          patch={patch}
          error={patchError}
          capturing={capturingPatch}
          canCapture={isLocal && ready && Boolean(rover)}
          onCapture={() => {
            setCapturingPatch(true);
            setPatchError('');
            setCapturePatchSignal((value) => value + 1);
          }}
          onOpenTerrain={(site) => {
            navigateWorkspace('map');
            changeMode(site);
            if (site === 'dingo-gap') setPlacementMode('rover');
          }}
        />
      )}

      {studioActivated && (
        <Suspense fallback={<p role="status">Opening scenario studio…</p>}>
          <ScenarioStudio
            onOpenLab={(scenario) => {
              setStudioScenario({ ...scenario });
              changeMode(scenario.execution.terrain);
              navigateWorkspace('lab');
            }}
          />
        </Suspense>
      )}

      <footer className="footer">
        <span>
          <span className="status-dot" />
          {ready
            ? isReference
              ? 'Reference globe ready'
              : `${status.loadedTiles} terrain tiles loaded`
            : status.state === 'error'
              ? 'Terrain unavailable'
              : status.state === 'token-required'
                ? 'Awaiting terrain access'
                : 'Connecting to terrain'}
        </span>
        <span className="footer-center">REAL DATA. NEW FRONTIERS.</span>
        <a href="https://github.com/k2jac9/rocket-academy-first-contact" target="_blank" rel="noreferrer">
          Built with curiosity <ExternalLink size={12} />
        </a>
      </footer>
      <div className="sr-only" role="status" aria-live="polite">
        {notice}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {status.state === 'ready'
          ? `${source.label} terrain ready for mission planning.`
          : status.state === 'error'
            ? 'Terrain unavailable. Retry connection is available.'
            : status.state === 'token-required'
              ? `${source.label} requires a terrain connection.`
              : `Loading ${source.label} terrain.`}
      </div>
      {notice && (
        <div className="notice-toast">
          <Check size={14} />
          <span>{notice}</span>
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <X size={13} />
          </button>
        </div>
      )}

      {dialog === 'sources' && (
        <Dialog title="Scientific sources" onClose={() => setDialog(null)}>
          <p className="dialog-intro">
            Inspect the observations behind the view. Exported missions preserve the source identity and
            coordinate reference.
          </p>
          <div className="source-details">
            <span className="eyebrow">ACTIVE DATASET</span>
            <h3>{source.label}</h3>
            <p>{source.summary}</p>
            <dl>
              <div>
                <dt>Source</dt>
                <dd>{source.credit}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{source.locationLabel}</dd>
              </div>
              <div>
                <dt>Terrain detail</dt>
                <dd>{source.resolutionLabel}</dd>
              </div>
              <div>
                <dt>Coordinate frame</dt>
                <dd>{source.frame}</dd>
              </div>
              <div>
                <dt>Units</dt>
                <dd>Metres</dd>
              </div>
              <div>
                <dt>Source ID</dt>
                <dd>{source.sourceId}</dd>
              </div>
            </dl>
            <a className="secondary-button" href={source.sourceUrl} target="_blank" rel="noreferrer">
              View original source <ExternalLink size={14} />
            </a>
            {source.geometryKind === 'heightfield' && (
              <a
                className="secondary-button"
                href={`/terrain/${source.id}/provenance.json`}
                target="_blank"
                rel="noreferrer"
              >
                Terrain package provenance <ExternalLink size={14} />
              </a>
            )}
          </div>
          <div className="dialog-callout">
            <ShieldCheck size={20} />
            <p>
              Map views are for exploration. Robot lab uses frozen Dingo Gap, Apollo 17 or Amboy Crater
              elevation patches for experimental contact simulation, with the terrain source preserved in each
              episode.
            </p>
          </div>
        </Dialog>
      )}
      {dialog === 'connection' && (
        <Dialog title="Planetary terrain connection" onClose={() => setDialog(null)}>
          <p className="dialog-intro">
            Mars, Moon, and Earth open with public NASA imagery. Cesium ion is optional for the measured
            Moon/Mars terrain layers.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setIonToken(tokenDraft.trim());
              setDialog(null);
              setNotice(
                tokenDraft.trim()
                  ? 'Terrain access updated for this session.'
                  : 'Ion token removed from this session.',
              );
            }}
          >
            <h3 className="connection-section-title">Optional measured terrain</h3>
            <label className="field-label" htmlFor="ion-token">
              Cesium ion read-only token
            </label>
            <input
              id="ion-token"
              className="token-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
              placeholder="Paste a restricted public token"
            />
            <p className="field-hint">
              Used in this browser session and sent to Cesium to load the selected terrain. Never included in
              a mission export. Browser tokens are public credentials: restrict their assets and permitted
              URLs in ion.
            </p>
            <a className="text-button" href="https://ion.cesium.com/tokens" target="_blank" rel="noreferrer">
              Manage Cesium ion tokens <ExternalLink size={13} />
            </a>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setIonToken('');
                  setTokenDraft('');
                  setDialog(null);
                }}
              >
                Disconnect
              </button>
              <button className="primary-button compact" type="submit">
                Save connection <ArrowRight size={15} />
              </button>
            </div>
          </form>
          <div className="server-setup">
            <h3>Atlas, Gemini and ElevenLabs</h3>
            <p>
              Set the server connections in <code>.env.local</code>, then restart <code>npm run dev</code>.
              Keep these values server-side.
            </p>
            <pre>
              {
                'MONGODB_URI=your_atlas_connection_string\nMONGODB_DB=first_contact\nGEMINI_API_KEY=your_gemini_api_key\nELEVENLABS_API_KEY=your_elevenlabs_api_key'
              }
            </pre>
            <p>
              The local service saves missions and runs to Atlas, stores MCAP files in GridFS, and requests
              Gemini plans. ElevenLabs adds optional mission narration in Robot lab. Connection status is
              shown in the corresponding tools.
            </p>
          </div>
        </Dialog>
      )}
      {dialog === 'help' && (
        <Dialog title="Your first mission" onClose={() => setDialog(null)}>
          <p className="dialog-intro">
            Find a place worth exploring, then give the mission a beginning and a destination.
          </p>
          <ol className="help-steps">
            <li>
              <strong>Explore a world.</strong>
              <p>
                Start with a full Mars, Moon, or Earth globe. Public imagery uses a reference sphere; choose
                Measured terrain for the optional ion layer. Drag to orbit and scroll to zoom. Reset the
                camera with the square icon in the view.
              </p>
            </li>
            <li>
              <strong>Place your rover.</strong>
              <p>
                Load a 20 m example on a reference globe, or choose “Place rover” and select a visible point.
              </p>
            </li>
            <li>
              <strong>Set a science goal.</strong>
              <p>
                Choose “Set goal” and select a second point. The connecting line shows straight-line
                separation, not a safe route.
              </p>
            </li>
            <li>
              <strong>Plan, run, and record.</strong>
              <p>
                Create a baseline or Gemini plan, run the kinematic episode, replay its states, and export an
                MCAP file. Run & save to Atlas stores a new server-generated episode and recording.
              </p>
            </li>
          </ol>
          <div className="dialog-callout">
            <MousePointer2 size={20} />
            <p>
              <strong>Map controls:</strong> Drag to pan; right-drag to orbit. Scroll zooms toward the cursor;
              double-click recentres and zooms the local map. Arrow keys pan in map mode or orbit in orbit
              mode; + and − zoom; Home resets. With placement active, Enter or Space selects the point under
              the center reticle.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
