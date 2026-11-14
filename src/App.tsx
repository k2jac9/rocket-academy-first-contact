import { useCallback, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronRight, CircleHelp, Compass, Crosshair, Database, ExternalLink, Flag, Globe2, Layers3, LockKeyhole, Maximize, MousePointer2, Orbit, Radio, RotateCcw, Settings2, ShieldCheck, Sparkles, TriangleAlert, X } from 'lucide-react';
import TerrainScene from './terrain/TerrainScene';
import type { TerrainStatus } from './terrain/types';
import { SOURCES, createMissionManifest, distanceMeters, getSource } from './domain/mission';
import type { MarkerKind, SceneMode, TerrainPoint } from './domain/mission';
import { Dialog } from './components/Dialog';

const INITIAL_STATUS: TerrainStatus = { state: 'loading', message: 'Connecting to NASA terrain…', loadedTiles: 0 };

function formatDistance(distance: number) {
  return distance >= 1000 ? `${(distance / 1000).toFixed(2)} km` : `${distance.toFixed(1)} m`;
}

function Coordinate({ point }: { point: TerrainPoint | null }) {
  return point ? <span className="coordinates">{point.x.toFixed(1)} / {point.y.toFixed(1)} / {point.z.toFixed(1)} <span>m</span></span> : <span className="unset">Choose a point on the terrain</span>;
}

export default function App() {
  const [mode, setMode] = useState<SceneMode>('dingo-gap');
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
  const source = getSource(mode);
  const ready = status.state === 'ready';
  const distance = useMemo(() => rover && goal ? distanceMeters(rover, goal) : null, [rover, goal]);
  const onStatus = useCallback((next: TerrainStatus) => setStatus(next), []);
  const onPlace = useCallback((kind: MarkerKind, point: TerrainPoint) => {
    if (kind === 'rover') setRover(point); else setGoal(point);
    setPlacementMode(null);
    setNotice(`${kind === 'rover' ? 'Rover start' : 'Science goal'} placed on the terrain.`);
  }, []);

  function changeMode(next: SceneMode) {
    if (mode === next) return;
    setMode(next);
    setRover(null); setGoal(null); setPlacementMode(null); setNotice('');
    setStatus(INITIAL_STATUS);
  }

  function selectPlacement(kind: MarkerKind) {
    setPlacementMode(current => current === kind ? null : kind);
    setNotice(`Select ${kind === 'rover' ? 'a rover starting point' : 'a science goal'} on the terrain, or focus the view and press Enter.`);
  }

  function exportMission() {
    if (!rover || !goal) { setNotice('Place a rover start and a science goal before exporting.'); return; }
    try {
      const manifest = createMissionManifest({ mode, rover, goal, missionName });
      const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `first-contact-${mode}-mission.json`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Mission manifest exported with source, coordinates, and planning status.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The mission could not be exported.');
    }
  }

  function openConnection() { setTokenDraft(ionToken); setDialog('connection'); }

  function retryTerrain() {
    setStatus(INITIAL_STATUS);
    setRetry(value => value + 1);
  }

  return <div className="app-shell">
    <a className="skip-link" href="#mission-controls">Skip to mission controls</a>
    <header className="topbar">
      <a className="brand" href="#" aria-label="Rocket Academy First Contact home" onClick={(event) => { event.preventDefault(); changeMode('dingo-gap'); }}>
        <span className="brand-symbol"><Orbit size={32} strokeWidth={1.35} /></span>
        <span><strong>ROCKET ACADEMY</strong><span className="brand-subtitle">FIRST CONTACT</span></span>
      </a>
      <nav className="topnav" aria-label="Application"><span className="nav-active"><Compass size={15} /> Mission planner</span><button onClick={() => setDialog('sources')}><Database size={15} /> Data sources</button></nav>
      <div className="header-meta"><span className="edition">NASA SPACE APPS <span>2026</span></span><button className="icon-button" onClick={() => setDialog('help')} aria-label="Open help"><CircleHelp size={19} /></button><button className="icon-button" onClick={openConnection} aria-label="Connection settings"><Settings2 size={18} /></button></div>
    </header>

    <div className="workspace-heading">
      <div><div className="eyebrow"><span className="tiny-cross">+</span> EXPEDITION WORKSPACE / 001</div><h1>A new world.<br className="mobile-break" /> Your first move.</h1><p>Explore real terrain. Design the mission. Make every coordinate count.</p></div>
      <div className="build-badge"><span className="status-dot" /><span>MISSION PLANNING<span className="badge-sub">First Contact · v0.1</span></span></div>
    </div>

    <main className="workspace">
      <aside className="destination-panel" aria-label="Destinations">
        <div className="section-heading"><span>01 / DESTINATION</span><Globe2 size={16} /></div>
        <h2>Choose your frontier</h2><p className="muted">One mission starts with a place.</p>
        <div className="destination-list">
          {SOURCES.map(item => <button className={`destination-card ${mode === item.id ? 'selected' : ''}`} key={item.id} aria-pressed={mode === item.id} onClick={() => changeMode(item.id)}>
            <span className={`planet-disc ${item.id}`} aria-hidden="true"><span /></span>
            <span className="destination-text"><span className="destination-kicker">{item.id === 'dingo-gap' ? 'MARS / SURFACE SITE' : 'GLOBAL EXPLORER'}</span><strong>{item.label}</strong><span>{item.id === 'dingo-gap' ? 'Curiosity’s Dingo Gap' : item.id === 'moon' ? 'Our next giant leap' : 'The red planet, in context'}</span></span>
            {mode === item.id ? <span className="selection-check"><Check size={13} /></span> : <ChevronRight className="destination-chevron" size={16} />}
            <span className={`card-tag ${item.requiresToken ? '' : 'open'}`}>{item.requiresToken ? <><LockKeyhole size={10} /> ION ACCESS</> : <><Radio size={10} /> PUBLIC NASA DATA</>}</span>
          </button>)}
        </div>
        <div className="site-facts"><div className="section-heading"><span>SITE INTELLIGENCE</span><span className="tiny-cross">+</span></div><dl><div><dt>Body</dt><dd>{source.body === 'mars' ? 'Mars' : 'Moon'}</dd></div><div><dt>Coverage</dt><dd>{mode === 'dingo-gap' ? 'Local reconstruction' : 'Planetary globe'}</dd></div><div><dt>Terrain detail</dt><dd>{source.resolutionLabel}</dd></div><div><dt>State</dt><dd><span className="plan-pill">PLANNING</span></dd></div></dl></div>
        <div className="source-note"><ShieldCheck size={20} /><div><strong>Grounded in real observations</strong><p>Every mission keeps its terrain source and coordinate reference.</p><button className="text-button" onClick={() => setDialog('sources')}>Inspect the evidence <ArrowRight size={13} /></button></div></div>
      </aside>

      <section className="viewport-column" aria-label="Terrain workspace">
        <div className="viewport-header"><div><span className="live-square" />{mode === 'dingo-gap' ? 'DINGO GAP' : mode === 'moon' ? 'LUNAR ORBIT' : 'MARS ORBIT'}<span className="viewport-divider">/</span><span className="viewport-header-muted">{mode === 'dingo-gap' ? 'GALE CRATER' : 'GLOBAL TERRAIN'}</span></div><button className="text-button" onClick={() => setDialog('sources')}><Layers3 size={13} /> Source layers</button></div>
        <div className={`terrain-viewport ${placementMode ? 'placing' : ''}`}>
          <TerrainScene key={`${mode}-${retry}`} mode={mode} ionToken={ionToken} placementMode={placementMode} rover={rover} goal={goal} onPlace={onPlace} onStatus={onStatus} resetViewSignal={resetViewSignal} />
          <div className="viewport-topline"><span className="terrain-tag"><span className={`status-dot ${ready ? '' : 'pending'}`} />{ready ? 'TERRAIN CONNECTED' : status.state === 'token-required' ? 'CONNECTION REQUIRED' : status.state === 'error' ? 'CONNECTION INTERRUPTED' : 'ACQUIRING TERRAIN'}</span><span className="scale-label">TRUE-SCALE VIEW</span></div>
          <div className="compass" aria-hidden="true"><span>VIEW</span><Compass size={27} strokeWidth={1} /></div>
          {status.state === 'loading' && <div className="scene-message"><span className="loading-orbit"><Orbit size={35} strokeWidth={1} /></span><h3>Approaching {mode === 'dingo-gap' ? 'Dingo Gap' : source.label}.</h3><p>{status.message}</p><span className="message-caption">Streaming the original terrain tiles</span></div>}
          {status.state === 'token-required' && <div className="scene-message"><span className="message-symbol"><Globe2 size={31} strokeWidth={1.2} /></span><h3>{source.label} awaits.</h3><p>Connect a Cesium ion read-only token to explore the full planetary surface.</p><button className="primary-button compact" onClick={openConnection}>Connect terrain <ArrowRight size={15} /></button><button className="text-button" onClick={() => changeMode('dingo-gap')}>Explore public NASA terrain instead</button></div>}
          {status.state === 'error' && <div className="scene-message error-message"><TriangleAlert size={30} strokeWidth={1.3} /><h3>Terrain connection interrupted.</h3><p>{status.message}</p><button className="primary-button compact" onClick={retryTerrain}>Retry connection <RotateCcw size={15} /></button>{source.requiresToken && <button className="text-button" onClick={openConnection}>Check ion connection</button>}</div>}
          {ready && placementMode && <div className="placement-instruction"><Crosshair size={15} /> Click the terrain to place your {placementMode === 'rover' ? 'rover' : 'science goal'}<button aria-label="Cancel marker placement" onClick={() => setPlacementMode(null)}><X size={14} /></button></div>}
          {ready && !status.message.startsWith('Live terrain ready') && <div className="terrain-warning" role="status"><span>{status.message}</span>{status.message.includes('Retry terrain') && <button className="text-button" onClick={retryTerrain}>Retry terrain <RotateCcw size={13} /></button>}</div>}
          <div className="viewport-bottomline"><span>{source.credit}</span><button aria-label="Reset terrain camera" className="viewport-reset" onClick={() => setResetViewSignal(x => x + 1)}><Maximize size={16} /></button></div>
        </div>
        <div className="terrain-toolbar"><div className="placement-tools"><button className={placementMode === 'rover' ? 'tool-active' : ''} disabled={!ready} aria-pressed={placementMode === 'rover'} onClick={() => selectPlacement('rover')}><Crosshair size={16} /><span>Place rover</span><kbd>01</kbd></button><span className="tool-separator" /><button className={placementMode === 'goal' ? 'tool-active' : ''} disabled={!ready} aria-pressed={placementMode === 'goal'} onClick={() => selectPlacement('goal')}><Flag size={15} /><span>Set goal</span><kbd>02</kbd></button></div><button className="orbit-help" onClick={() => setDialog('help')}><MousePointer2 size={14} /><span>Drag to orbit · Scroll to zoom</span></button></div>
        <div className="mission-context"><div className="context-number">FC<span>/001</span></div><div><span className="eyebrow">YOUR FIELD OF POSSIBILITY</span><h3>{mode === 'dingo-gap' ? 'Where Curiosity found a way through.' : mode === 'moon' ? 'A familiar world. Unexplored possibilities.' : 'A planet of possibilities.'}</h3><p>{mode === 'dingo-gap' ? 'A real reconstruction from Curiosity and Mars Reconnaissance Orbiter imagery. Choose a start and a science goal to define your first traverse.' : 'Explore planetary terrain, choose a region, and preserve the coordinates for your next mission.'}</p></div><Sparkles size={23} className="context-star" strokeWidth={1.2} /></div>
      </section>

      <aside className="mission-panel" id="mission-controls" aria-label="Mission controls">
        <div className="section-heading"><span>02 / MISSION BRIEF</span><span className="draft-tag">DRAFT</span></div>
        <label className="mission-name-label" htmlFor="mission-name">Mission name</label><input className="mission-name" id="mission-name" value={missionName} maxLength={80} onChange={event => setMissionName(event.target.value)} />
        <p className="muted mission-description">Set the coordinates for your next discovery.</p>
        <div className="mission-steps">
          <div className={`mission-step ${rover ? 'complete' : ''}`}><div className="step-line"><span className="step-node">{rover ? <Check size={12} /> : '1'}</span><h3>Rover start</h3>{rover && <button className="text-button small" disabled={!ready} onClick={() => selectPlacement('rover')}>Edit</button>}</div><div className="step-content"><Coordinate point={rover} />{!rover && <button className="secondary-button" disabled={!ready} onClick={() => selectPlacement('rover')}><Crosshair size={14} /> Place starting point</button>}</div></div>
          <div className={`mission-step goal-step ${goal ? 'complete' : ''}`}><div className="step-line"><span className="step-node">{goal ? <Check size={12} /> : '2'}</span><h3>Science goal</h3>{goal && <button className="text-button small" disabled={!ready} onClick={() => selectPlacement('goal')}>Edit</button>}</div><div className="step-content"><Coordinate point={goal} />{!goal && <button className="secondary-button" disabled={!ready} onClick={() => selectPlacement('goal')}><Flag size={14} /> Choose destination</button>}</div></div>
          <div className="mission-step"><div className="step-line"><span className={`step-node ${rover && goal ? 'export-ready' : ''}`}>3</span><h3>Capture the plan</h3></div><div className="step-content"><p>Export a mission manifest with the source, reference frame, and selected coordinates.</p></div></div>
        </div>
        <div className="distance-card"><div><span className="eyebrow">START → GOAL</span><strong>{distance === null ? <span className="distance-placeholder">— <small>m</small></span> : formatDistance(distance)}</strong></div><span className="distance-caption">Straight-line distance<br />Terrain route not evaluated</span></div>
        <div className="mission-actions"><button className="primary-button" disabled={!rover || !goal || !missionName.trim()} onClick={exportMission}><ArrowDownToLine size={17} /> Export mission <ArrowRight size={16} /></button><button className="text-button reset-mission" disabled={!rover && !goal} onClick={() => { setRover(null); setGoal(null); setPlacementMode(null); setNotice('Mission markers cleared.'); }}><RotateCcw size={12} /> Clear markers</button></div>
        <div className="planning-note"><span className="note-heading"><Radio size={14} /> PLAN FIRST. EXPLORE NEXT.</span><p>This workspace defines a mission. Physics simulation, terrain safety evaluation, and robot training are the next stage.</p></div>
      </aside>
    </main>

    <footer className="footer"><span><span className="status-dot" />{ready ? `${status.loadedTiles} terrain tiles loaded` : status.state === 'error' ? 'Terrain unavailable' : status.state === 'token-required' ? 'Awaiting terrain access' : 'Connecting to terrain'}</span><span className="footer-center">REAL DATA. NEW FRONTIERS.</span><a href="https://github.com/k2jac9/rocket-academy-first-contact" target="_blank" rel="noreferrer">Built with curiosity <ExternalLink size={12} /></a></footer>
    <div className="sr-only" role="status" aria-live="polite">{notice}</div>
    <div className="sr-only" role="status" aria-live="polite">{status.state === 'ready' ? `${source.label} terrain ready for mission planning.` : status.state === 'error' ? 'Terrain unavailable. Retry connection is available.' : status.state === 'token-required' ? `${source.label} requires a terrain connection.` : `Loading ${source.label} terrain.`}</div>
    {notice && <div className="notice-toast"><Check size={14} /><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={13} /></button></div>}

    {dialog === 'sources' && <Dialog title="Scientific sources" onClose={() => setDialog(null)}><p className="dialog-intro">Inspect the observations behind the view. Exported missions preserve the source identity and coordinate reference.</p><div className="source-details"><span className="eyebrow">ACTIVE DATASET</span><h3>{source.label}</h3><p>{source.summary}</p><dl><div><dt>Source</dt><dd>{source.credit}</dd></div><div><dt>Location</dt><dd>{source.locationLabel}</dd></div><div><dt>Terrain detail</dt><dd>{source.resolutionLabel}</dd></div><div><dt>Coordinate frame</dt><dd>{source.frame}</dd></div><div><dt>Units</dt><dd>Metres</dd></div><div><dt>Source ID</dt><dd>{source.sourceId}</dd></div></dl><a className="secondary-button" href={source.sourceUrl} target="_blank" rel="noreferrer">View original source <ExternalLink size={14} /></a></div><div className="dialog-callout"><ShieldCheck size={20} /><p>The displayed tiles are a visualization asset. A future simulation uses a fixed terrain mesh prepared from the original scientific elevation data.</p></div></Dialog>}
    {dialog === 'connection' && <Dialog title="Planetary terrain connection" onClose={() => setDialog(null)}><p className="dialog-intro">Dingo Gap uses public NASA data. The Moon and Mars globes stream prepared terrain from Cesium ion.</p><form onSubmit={event => { event.preventDefault(); setIonToken(tokenDraft.trim()); setDialog(null); setNotice(tokenDraft.trim() ? 'Terrain access updated for this session.' : 'Ion token removed from this session.'); }}><label className="field-label" htmlFor="ion-token">Cesium ion read-only token</label><input id="ion-token" className="token-input" type="password" autoComplete="off" spellCheck={false} value={tokenDraft} onChange={event => setTokenDraft(event.target.value)} placeholder="Paste a restricted public token" /><p className="field-hint">Used in this browser session and sent to Cesium to load the selected terrain. Never included in a mission export. Browser tokens are public credentials: restrict their assets and permitted URLs in ion.</p><a className="text-button" href="https://ion.cesium.com/tokens" target="_blank" rel="noreferrer">Manage Cesium ion tokens <ExternalLink size={13} /></a><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => { setIonToken(''); setTokenDraft(''); setDialog(null); }}>Disconnect</button><button className="primary-button compact" type="submit">Save connection <ArrowRight size={15} /></button></div></form></Dialog>}
    {dialog === 'help' && <Dialog title="Your first mission" onClose={() => setDialog(null)}><p className="dialog-intro">Find a place worth exploring, then give the mission a beginning and a destination.</p><ol className="help-steps"><li><strong>Explore the terrain.</strong><p>Drag to orbit and scroll to zoom. Reset the camera with the square icon in the view.</p></li><li><strong>Place your rover.</strong><p>Choose “Place rover”, then select a visible point on the terrain.</p></li><li><strong>Set a science goal.</strong><p>Choose “Set goal” and select a second point. The connecting line shows straight-line separation, not a safe route.</p></li><li><strong>Export the mission.</strong><p>Download the plan with its coordinates, dataset identity, and scientific limitations.</p></li></ol><div className="dialog-callout"><MousePointer2 size={20} /><p><strong>Keyboard controls:</strong> Focus the terrain view. Arrow keys orbit; Shift + arrows pan the local site; + and − zoom; Home resets. With placement active, Enter or Space selects the point under the center reticle.</p></div></Dialog>}
  </div>;
}
