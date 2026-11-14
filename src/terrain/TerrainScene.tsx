import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Line,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Spherical,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GlobeControls, TilesRenderer } from '3d-tiles-renderer';
import { getSource } from '../domain/mission';
import { resolveIonAsset } from './ion';
import { panLocalCamera } from './navigation';
import { createStartupDeadline } from './startupDeadline';
import type { TerrainPoint, TerrainSceneProps, TerrainStatus } from './types';

export type { MarkerKind, SceneMode, TerrainPoint, TerrainSceneProps, TerrainStatus } from './types';

type SceneHandle = {
  resetView: () => void;
  setMarkers: (rover: TerrainPoint | null, goal: TerrainPoint | null) => void;
};

const UP = new Vector3(0, 1, 0);
const LOCAL_TARGET = new Vector3(0, -1.6, 0);

function createMarker(color: string) {
  const group = new Group();
  const solid = new MeshBasicMaterial({ color });
  const halo = new MeshBasicMaterial({ color, transparent: true, opacity: 0.32, side: DoubleSide });
  const ring = new Mesh(new RingGeometry(0.28, 0.42, 36), halo);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  const stem = new Mesh(new CylinderGeometry(0.025, 0.025, 0.75, 8), solid);
  stem.position.y = 0.4;
  const head = new Mesh(new SphereGeometry(0.13, 14, 10), solid);
  head.position.y = 0.85;
  group.add(ring, stem, head);
  group.visible = false;
  return group;
}

function disposeOverlays(group: Group) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<MeshBasicMaterial | LineDashedMaterial>();
  group.traverse((object) => {
    if (object instanceof Mesh || object instanceof Line) {
      geometries.add(object.geometry);
      const entries = Array.isArray(object.material) ? object.material : [object.material];
      entries.forEach((material) => materials.add(material));
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

/** NASA's streamed terrain is the only pickable surface in this scene. */
export default function TerrainScene(props: TerrainSceneProps) {
  const { mode, ionToken, rover, goal, resetViewSignal } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const latestProps = useRef(props);
  const handleRef = useRef<SceneHandle | null>(null);
  const [credits, setCredits] = useState<string[]>([]);

  useEffect(() => {
    latestProps.current = props;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let halted = false;
    let animationFrame = 0;
    let startupDeadline: ReturnType<typeof createStartupDeadline> | null = null;
    let lastStatus = '';
    let hasVisibleTerrain = false;
    let failedTiles = 0;
    let tiles: TilesRenderer | null = null;
    let controls: OrbitControls | GlobeControls | null = null;
    const source = getSource(mode);
    const isLocal = mode === 'dingo-gap';
    const lifecycle = new AbortController();
    const loadedModels = new Set<Object3D>();
    setCredits([]);

    function publish(state: TerrainStatus['state'], message: string) {
      if (disposed || (halted && state !== 'error') || startupDeadline?.allows(state) === false) return;
      const status = { state, message, loadedTiles: loadedModels.size };
      const identity = JSON.stringify(status);
      if (identity !== lastStatus) {
        lastStatus = identity;
        latestProps.current.onStatus(status);
      }
    }

    if (!isLocal && !ionToken.trim()) {
      publish('token-required', `Add a Cesium ion browser token to open ${mode === 'moon' ? 'the Moon' : 'Mars'} globe.`);
      return () => {
        disposed = true;
        lifecycle.abort();
      };
    }

    publish('loading', isLocal ? 'Connecting to NASA’s Dingo Gap terrain…' : 'Connecting to planetary terrain…');

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      publish('error', 'WebGL could not start. Enable hardware acceleration or open this mission in a WebGL-capable browser, then retry.');
      return () => {
        disposed = true;
        lifecycle.abort();
      };
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(isLocal ? '#141c21' : '#080e16');
    const canvas = renderer.domElement;
    canvas.className = 'terrain-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', `${isLocal ? 'NASA Dingo Gap' : mode === 'moon' ? 'Moon' : 'Mars'} terrain. Drag to orbit, scroll to zoom. Arrow keys orbit, ${isLocal ? 'Shift and arrow keys pan across the site, ' : ''}plus and minus zoom. Enter or Space places the selected marker at the center reticle. Home resets the view.`);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    host.appendChild(canvas);

    const scene = new Scene();
    scene.background = new Color(isLocal ? '#141c21' : '#080e16');
    const radius = mode === 'moon' ? 1_737_400 : 3_396_190;
    const camera = new PerspectiveCamera(52, 1, isLocal ? 0.1 : 1, isLocal ? 2000 : 160_000_000);
    const ambient = new AmbientLight(0xffffff, 1.2);
    const sunlight = new DirectionalLight(0xfff5e8, 2.3);
    sunlight.position.set(60, 100, 45);
    scene.add(ambient, sunlight);

    const overlayGroup = new Group();
    const roverMarker = createMarker('#72e0d5');
    const goalMarker = createMarker('#ffba77');
    const connectionMaterial = new LineDashedMaterial({
      color: '#f0d9a9',
      transparent: true,
      opacity: 0.75,
      dashSize: 0.8,
      gapSize: 0.5,
      // A screen overlay joins the selected endpoints; it is not a terrain path.
      depthTest: false,
    });
    const connection = new Line(new BufferGeometry(), connectionMaterial);
    connection.visible = false;
    connection.renderOrder = 2;
    connection.frustumCulled = false;
    overlayGroup.add(roverMarker, goalMarker, connection);
    scene.add(overlayGroup);

    if (isLocal) {
      const orbit = new OrbitControls(camera, canvas);
      orbit.enableDamping = true;
      orbit.dampingFactor = 0.085;
      orbit.minDistance = 1.5;
      orbit.maxDistance = 650;
      orbit.maxPolarAngle = Math.PI * 0.485;
      orbit.target.copy(LOCAL_TARGET);
      controls = orbit;
    } else {
      const globe = new GlobeControls(scene, camera, canvas);
      globe.enableDamping = true;
      controls = globe;
    }

    function resetView() {
      if (disposed) return;
      camera.up.copy(UP);
      if (controls instanceof OrbitControls) {
        controls.target.copy(LOCAL_TARGET);
        camera.position.set(27, 18, 32);
        camera.lookAt(LOCAL_TARGET);
      } else {
        controls?.resetState();
        camera.position.set(1.05, 0.32, 2.8).multiplyScalar(radius);
        camera.lookAt(0, 0, 0);
      }
      camera.updateMatrixWorld();
      if (controls instanceof OrbitControls || tiles?.rootTileset) controls?.update();
    }

    function setMarkers(roverPoint: TerrainPoint | null, goalPoint: TerrainPoint | null) {
      const terrain = tiles;
      if (!terrain || disposed) return;
      terrain.group.updateWorldMatrix(true, false);
      const positionMarker = (marker: Group, point: TerrainPoint | null) => {
        marker.visible = Boolean(point);
        if (!point) return;
        marker.position.set(point.x, point.y, point.z);
        terrain.group.localToWorld(marker.position);
        const normal = isLocal ? UP : marker.position.clone().normalize();
        marker.quaternion.setFromUnitVectors(UP, normal);
      };
      positionMarker(roverMarker, roverPoint);
      positionMarker(goalMarker, goalPoint);
      connection.visible = Boolean(roverPoint && goalPoint);
      if (connection.visible) {
        connection.geometry.dispose();
        connection.geometry = new BufferGeometry().setFromPoints([roverMarker.position, goalMarker.position]);
        const distance = roverMarker.position.distanceTo(goalMarker.position);
        connectionMaterial.dashSize = Math.max(distance / 30, isLocal ? 0.3 : 1);
        connectionMaterial.gapSize = connectionMaterial.dashSize * 0.6;
        connection.computeLineDistances();
      }
    }

    handleRef.current = { resetView, setMarkers };
    resetView();

    function readyMessage() {
      return failedTiles > 0
        ? `Terrain is visible; ${failedTiles} detail request${failedTiles === 1 ? '' : 's'} failed. Retry terrain to reload missing detail.`
        : 'Live terrain ready. Select a marker, then choose a point on the surface.';
    }

    async function loadTerrain() {
      try {
        let terrain: TilesRenderer;
        if (isLocal) {
          if (!source.tilesetUrl) throw new Error('Missing public terrain source');
          terrain = new TilesRenderer(source.tilesetUrl);
          // NASA mars.js applies Rx(+π/2). This is a display rotation only:
          // world = (source.x, -source.z, source.y). Picks invert it on export.
          terrain.group.rotation.x = Math.PI / 2;
        } else {
          if (!source.ionAssetId) throw new Error('Missing planetary terrain asset');
          const asset = await resolveIonAsset(source.ionAssetId, ionToken.trim(), lifecycle.signal);
          if (disposed) return;
          terrain = new TilesRenderer(asset.url);
          terrain.registerPlugin(asset.fetchPlugin);
          // NASA ionLunar.js applies this source-body-fixed → display rotation.
          terrain.group.rotation.x = -Math.PI / 2;
          setCredits(asset.credits);
        }

        if (disposed) {
          terrain.dispose();
          return;
        }
        tiles = terrain;
        terrain.fetchOptions = { ...terrain.fetchOptions, mode: 'cors', signal: lifecycle.signal };
        terrain.errorTarget = isLocal ? 8 : 12;
        terrain.lruCache.minSize = 160;
        terrain.lruCache.maxSize = 260;
        terrain.setCamera(camera);
        terrain.setResolutionFromRenderer(camera, renderer);
        terrain.group.updateMatrixWorld(true);
        scene.add(terrain.group);
        if (controls instanceof GlobeControls) controls.setEllipsoid(terrain.ellipsoid, terrain.group);

        terrain.addEventListener('load-root-tileset', () => {
          if (!isLocal) resetView();
          publish('loading', 'Source connected. Streaming the first terrain tiles…');
        });
        terrain.addEventListener('load-model', ({ scene: model }) => {
          if (disposed) return;
          loadedModels.add(model);
          publish(hasVisibleTerrain ? 'ready' : 'loading', hasVisibleTerrain ? readyMessage() : 'Decoding terrain geometry and imagery…');
        });
        terrain.addEventListener('dispose-model', ({ scene: model }) => {
          loadedModels.delete(model);
        });
        terrain.addEventListener('load-error', ({ tile }) => {
          if (disposed || lifecycle.signal.aborted) return;
          failedTiles += 1;
          if (hasVisibleTerrain) {
            publish('ready', readyMessage());
          } else if (!tile || loadedModels.size === 0) {
            publish('error', isLocal
              ? 'NASA terrain could not be loaded. Check your connection and access to raw.githubusercontent.com, then retry.'
              : 'Planetary terrain could not be loaded. Check the ion token’s asset access and allowed domains, then retry.');
          }
        });
        setMarkers(latestProps.current.rover, latestProps.current.goal);
      } catch {
        if (!disposed && !lifecycle.signal.aborted) {
          publish('error', isLocal
            ? 'NASA terrain could not be initialized. Check your connection, then retry.'
            : 'Could not connect to Cesium ion. Use a read-only browser token with access to this planetary asset and the current domain, then retry.');
        }
      }
    }

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    function placeAt(clientX: number, clientY: number) {
      const kind = latestProps.current.placementMode;
      if (!kind || !tiles || !hasVisibleTerrain || disposed || halted) return;
      const rect = canvas.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      camera.updateMatrixWorld();
      tiles.group.updateWorldMatrix(true, true);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(tiles.group, true)[0];
      if (!hit) {
        publish('ready', 'No loaded surface at that point. Choose visible terrain or zoom in, then try again.');
        return;
      }
      const point = tiles.group.worldToLocal(hit.point.clone());
      if (![point.x, point.y, point.z].every(Number.isFinite)) return;
      latestProps.current.onPlace(kind, { x: point.x, y: point.y, z: point.z });
    }

    let pointerStart: { x: number; y: number; id: number } | null = null;
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
      canvas.focus({ preventScroll: true });
    };
    const pointerUp = (event: PointerEvent) => {
      const start = pointerStart;
      pointerStart = null;
      if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      placeAt(event.clientX, event.clientY);
    };
    const pointerCancel = () => { pointerStart = null; };
    const keyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        placeAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        resetView();
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(event.key)) return;
      event.preventDefault();
      if (event.shiftKey && event.key.startsWith('Arrow') && controls instanceof OrbitControls) {
        const horizontal = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const vertical = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
        panLocalCamera(camera, controls.target, horizontal, vertical);
        controls.update();
        return;
      }
      const pivot = controls instanceof OrbitControls ? controls.target : new Vector3();
      const offset = camera.position.clone().sub(pivot);
      const spherical = new Spherical().setFromVector3(offset);
      const step = event.shiftKey ? 0.14 : 0.065;
      if (event.key === 'ArrowLeft') spherical.theta -= step;
      if (event.key === 'ArrowRight') spherical.theta += step;
      if (event.key === 'ArrowUp') spherical.phi -= step;
      if (event.key === 'ArrowDown') spherical.phi += step;
      if (event.key === '+' || event.key === '=') spherical.radius *= 0.85;
      if (event.key === '-' || event.key === '_') spherical.radius *= 1.18;
      spherical.phi = Math.max(0.05, Math.min(isLocal ? Math.PI * 0.485 : Math.PI - 0.05, spherical.phi));
      spherical.radius = Math.max(isLocal ? 1.5 : radius * 1.015, Math.min(isLocal ? 650 : radius * 20, spherical.radius));
      camera.position.setFromSpherical(spherical).add(pivot);
      camera.lookAt(pivot);
      if (controls instanceof OrbitControls || tiles?.rootTileset) controls?.update();
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      halted = true;
      cancelAnimationFrame(animationFrame);
      startupDeadline?.cancel();
      publish('error', 'The graphics context was interrupted. Retry terrain to recreate the view.');
    };
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerCancel);
    canvas.addEventListener('keydown', keyDown);
    canvas.addEventListener('webglcontextlost', contextLost);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      tiles?.setResolutionFromRenderer(camera, renderer);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    function animate() {
      if (disposed || halted) return;
      try {
        if (controls instanceof OrbitControls || tiles?.rootTileset) controls?.update();
        camera.updateMatrixWorld();
        tiles?.update();
        [roverMarker, goalMarker].forEach((marker) => {
          if (!marker.visible) return;
          const worldUnitsPerPixel = camera.position.distanceTo(marker.position) * 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(canvas.clientHeight, 1);
          marker.scale.setScalar(Math.max(isLocal ? 0.3 : 1, worldUnitsPerPixel * 22));
        });
        renderer.render(scene, camera);
        if (halted) return;
        // A parsed model alone is not readiness: wait until a real tile is visible
        // and has passed through an actual render call.
        if (!hasVisibleTerrain && tiles && tiles.visibleTiles.size > 0 && loadedModels.size > 0) {
          hasVisibleTerrain = true;
          publish('ready', readyMessage());
        }
        animationFrame = requestAnimationFrame(animate);
      } catch {
        halted = true;
        startupDeadline?.cancel();
        publish('error', 'The terrain renderer was interrupted. Retry terrain to recreate the view.');
      }
    }

    startupDeadline = createStartupDeadline(() => {
      publish('error', 'Terrain is taking longer than expected. Check the connection and source access, then retry.');
    });
    // Let React's development cleanup pass finish before starting network work.
    queueMicrotask(() => {
      if (!disposed) void loadTerrain();
    });
    animate();

    return () => {
      disposed = true;
      lifecycle.abort();
      cancelAnimationFrame(animationFrame);
      startupDeadline?.cancel();
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerCancel);
      canvas.removeEventListener('keydown', keyDown);
      canvas.removeEventListener('webglcontextlost', contextLost);
      controls?.dispose();
      tiles?.dispose();
      disposeOverlays(overlayGroup);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      handleRef.current = null;
    };
  }, [mode, ionToken]);

  useEffect(() => {
    handleRef.current?.setMarkers(rover, goal);
  }, [rover, goal]);

  useEffect(() => {
    handleRef.current?.resetView();
  }, [resetViewSignal]);

  useEffect(() => {
    const canvas = hostRef.current?.querySelector('canvas');
    if (canvas) canvas.style.cursor = props.placementMode ? 'crosshair' : 'grab';
  }, [props.placementMode, mode, ionToken]);

  return (
    <div className="terrain-renderer" style={{ position: 'absolute', inset: 0 }}>
      <div ref={hostRef} className="terrain-canvas-host" style={{ width: '100%', height: '100%' }} />
      {props.placementMode && (
        <div className="terrain-center-reticle" aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: 38, height: 38, transform: 'translate(-50%, -50%)', pointerEvents: 'none', color: props.placementMode === 'rover' ? '#72e0d5' : '#ffba77', filter: 'drop-shadow(0 1px 2px #000)' }}>
          <svg width="38" height="38" viewBox="0 0 38 38" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M19 1v10M19 27v10M1 19h10M27 19h10" />
            <circle cx="19" cy="19" r="4" />
            <circle cx="19" cy="19" r="1" fill="currentColor" stroke="none" />
          </svg>
        </div>
      )}
      {credits.length > 0 && (
        <div className="terrain-provider-credits" style={{ position: 'absolute', right: 12, bottom: 8, maxWidth: '70%', fontSize: 10, lineHeight: 1.4, textAlign: 'right', color: '#c7d2d9', background: 'rgba(8,14,22,.72)', padding: '3px 6px', pointerEvents: 'none' }}>
          {credits.join(' · ')}
        </div>
      )}
    </div>
  );
}
