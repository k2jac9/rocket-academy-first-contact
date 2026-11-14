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
  LineBasicMaterial,
  LineDashedMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MOUSE,
  TOUCH,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Spherical,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Ellipsoid, GlobeControls, TilesRenderer } from '3d-tiles-renderer';
import { getSource } from '../domain/mission';
import { isSurfaceSite, globeSite, SITE_LOCATIONS } from '../domain/surfaceSites';
import {
  createSurfaceGeometry,
  validateHeightfield,
  surfaceHeight,
  captureHeightfieldPatch,
  type SurfaceHeightfield,
} from './surfaceHeightfield';
import { resolveIonAsset } from './ion';
import { panLocalCamera } from './navigation';
import { createStartupDeadline } from './startupDeadline';
import { roverDisplayScale } from './roverModel';
import { disposeRobot, loadRobot } from '../robots/loadRobot';
import type { TerrainPatch } from '../simulation/episode';
import {
  createReferencePatchGeometry,
  createReferenceSphereGeometry,
  fetchReferenceTexture,
  GLOBE_DISPLAY_ROTATION,
  pickReferenceSphere,
  referenceGlobeViewDistance,
} from './referenceGlobe';
import type { TerrainPoint, TerrainSceneProps, TerrainStatus } from './types';

export type {
  MarkerKind,
  SceneMode,
  TerrainLayer,
  TerrainPoint,
  TerrainSceneProps,
  TerrainStatus,
} from './types';

type SceneHandle = {
  resetView: () => void;
  focusMission: () => void;
  updateMission: () => void;
  capturePatch: () => TerrainPatch;
  updateNavigation: () => void;
  navigate: (kind: 'in' | 'out' | 'north' | 'top') => void;
};

const UP = new Vector3(0, 1, 0);
const LOCAL_TARGET = new Vector3(0, -1.6, 0);

function createMarker(color: string) {
  const group = new Group();
  const solid = new MeshBasicMaterial({ color });
  const halo = new MeshBasicMaterial({ color, transparent: true, opacity: 0.38, side: DoubleSide });
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

function disposeGeometryAndMaterials(group: Group) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
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

function disposeImageTexture(texture: Texture | null) {
  if (!texture) return;
  const bitmap = texture.image as ImageBitmap | undefined;
  if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  texture.dispose();
}

/** Public imagery is a reference sphere; streamed terrain remains a separate layer. */
export default function TerrainScene(props: TerrainSceneProps) {
  const {
    mode,
    layer,
    ionToken,
    rover,
    goal,
    robotPosition,
    trajectory,
    resetViewSignal,
    focusMissionSignal,
  } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const sitePinRef = useRef<HTMLButtonElement>(null);
  const latestProps = useRef(props);
  const handleRef = useRef<SceneHandle | null>(null);
  const previousCaptureSignal = useRef(props.capturePatchSignal);
  const [credits, setCredits] = useState<string[]>([]);

  useEffect(() => {
    latestProps.current = props;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const source = getSource(mode, layer);
    const isLocal = isSurfaceSite(mode);
    const isRaster = source.geometryKind === 'heightfield';
    const siteId = globeSite(mode);
    const location = siteId ? SITE_LOCATIONS[siteId] : null;
    const isReference = source.geometryKind === 'reference-sphere';
    const radius = source.radiusM;
    let disposed = false;
    let halted = false;
    let animationFrame = 0;
    let startupDeadline: ReturnType<typeof createStartupDeadline> | null = null;
    let lastStatus = '';
    let hasVisibleSurface = false;
    let imageryLoaded = false;
    let imageryUnavailable = false;
    let imageryRendered = false;
    let failedTiles = 0;
    let tiles: TilesRenderer | null = null;
    let surfaceGroup: Group | null = null;
    let surfaceData: SurfaceHeightfield | null = null;
    let referenceGroup: Group | null = null;
    let referenceMesh: Mesh<BufferGeometry, MeshPhongMaterial> | null = null;
    let referencePatch: Mesh<BufferGeometry, MeshPhongMaterial> | null = null;
    let referenceTexture: Texture | null = null;
    let patchHalfSpan = 0;
    const patchCenter = new Vector3();
    let controls: OrbitControls | GlobeControls | null = null;
    let flight: { start: number; from: Vector3; targetFrom: Vector3; to: Vector3; targetTo: Vector3 } | null =
      null;
    const lifecycle = new AbortController();
    const loadedModels = new Set<Object3D>();
    setCredits([]);

    function publish(state: TerrainStatus['state'], message: string) {
      if (disposed || (halted && state !== 'error') || startupDeadline?.allows(state) === false) return;
      const status = { state, message, loadedTiles: isReference ? 0 : loadedModels.size };
      const identity = JSON.stringify(status);
      if (identity !== lastStatus) {
        lastStatus = identity;
        latestProps.current.onStatus(status);
      }
    }

    if (!isLocal && !isReference && !ionToken.trim()) {
      publish(
        'token-required',
        `Add a Cesium ion browser token to open ${source.label} elevation terrain, or use the public imagery globe.`,
      );
      return () => {
        disposed = true;
        lifecycle.abort();
      };
    }
    publish(
      'loading',
      isReference
        ? 'Loading NASA global imagery…'
        : isLocal
          ? `Loading ${source.label} measured terrain…`
          : 'Connecting to planetary terrain…',
    );

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      publish(
        'error',
        'WebGL could not start. Enable hardware acceleration or open this mission in a WebGL-capable browser, then retry.',
      );
      return () => {
        disposed = true;
        lifecycle.abort();
      };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    const canvas = renderer.domElement;
    canvas.className = 'terrain-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute(
      'aria-label',
      `${source.label} ${isReference ? 'imagery globe on a reference sphere without measured elevation' : 'terrain'}. Drag to navigate, scroll to zoom. Arrow keys navigate, plus and minus zoom. Enter or Space places the selected marker at the center reticle. Home resets the full view.`,
    );
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
    host.appendChild(canvas);

    const scene = new Scene();
    scene.background = new Color(isLocal ? '#f7f8f5' : '#080e16');
    const camera = new PerspectiveCamera(52, 1, isLocal ? 0.1 : 1, isLocal ? 2000 : 160_000_000);
    const ambient = new AmbientLight(0xffffff, isReference || isRaster ? 0.8 : 1.2);
    const sunlight = new DirectionalLight(0xfff5e8, isReference || isRaster ? 0.9 : 2.3);
    sunlight.position.set(60, 100, 45);
    scene.add(ambient, sunlight);

    const overlayGroup = new Group();
    const roverMarker = createMarker('#72e0d5');
    const goalMarker = createMarker('#ffba77');
    const robot = new Group();
    robot.visible = false;
    void loadRobot('husky')
      .then(({ root }) => {
        if (disposed) {
          disposeRobot(root);
          return;
        }
        // Native X-forward/Z-up to map Z-forward/Y-up; lift base_link to its wheel contact plane.
        root.quaternion.setFromRotationMatrix(
          new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)),
        );
        root.position.y = 0.13228;
        robot.add(root);
        updateMission();
      })
      .catch(() => {
        /* The placement marker remains available if the visual model cannot load. */
      });
    const connectionMaterial = new LineDashedMaterial({
      color: '#f0d9a9',
      transparent: true,
      opacity: 0.68,
      dashSize: 0.8,
      gapSize: 0.5,
      depthTest: false,
    });
    const connection = new Line(new BufferGeometry(), connectionMaterial);
    connection.visible = false;
    connection.renderOrder = 2;
    connection.frustumCulled = false;
    const trace = new Line(
      new BufferGeometry(),
      new LineBasicMaterial({ color: '#6ff3ce', transparent: true, opacity: 0.95, depthTest: false }),
    );
    trace.visible = false;
    trace.renderOrder = 3;
    trace.frustumCulled = false;
    overlayGroup.add(roverMarker, goalMarker, robot, connection, trace);
    scene.add(overlayGroup);

    if (isLocal) {
      const orbit = new OrbitControls(camera, canvas);
      orbit.enableDamping = true;
      orbit.dampingFactor = 0.085;
      orbit.minDistance = 1.5;
      orbit.maxDistance = isRaster ? 1600 : 650;
      orbit.maxPolarAngle = Math.PI * 0.485;
      orbit.zoomToCursor = true;
      orbit.screenSpacePanning = false;
      orbit.target.copy(LOCAL_TARGET);
      controls = orbit;
    } else {
      const globe = new GlobeControls(scene, camera, canvas);
      globe.enableDamping = true;
      globe.minDistance = 5;
      controls = globe;
      globe.enableDoubleTapZoom = true;
    }

    const sourceFrame = () => surfaceGroup ?? referenceGroup ?? tiles?.group ?? null;
    const controlsAreReady = () =>
      controls instanceof OrbitControls || referenceGroup !== null || Boolean(tiles?.rootTileset);
    const toWorld = (point: TerrainPoint) => {
      const vector = new Vector3(point.x, point.y, point.z);
      sourceFrame()?.localToWorld(vector);
      return vector;
    };

    function resetView() {
      if (disposed) return;
      flight = null;
      camera.up.copy(UP);
      if (controls instanceof OrbitControls) {
        controls.target.copy(isRaster ? new Vector3() : LOCAL_TARGET);
        camera.position.copy(isRaster ? new Vector3(310, 240, 360) : new Vector3(27, 18, 32));
        camera.lookAt(controls.target);
      } else {
        controls?.resetState();
        const lat = ((location?.latitude ?? 15) * Math.PI) / 180;
        const lon = ((location?.longitude ?? -70) * Math.PI) / 180;
        camera.position
          .set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
          .normalize()
          .multiplyScalar(referenceGlobeViewDistance(radius, camera.fov, camera.aspect));
        camera.lookAt(0, 0, 0);
      }
      camera.updateMatrixWorld();
      if (controlsAreReady()) controls?.update();
    }

    function focusMission() {
      if (disposed || !sourceFrame()) return;
      flight = null;
      const current = latestProps.current;
      const points = [
        current.rover,
        current.goal,
        current.robotPosition,
        ...(current.trajectory ?? []),
      ].filter((point): point is TerrainPoint => Boolean(point));
      if (points.length === 0) return;
      const center = new Vector3();
      points.forEach((point) => center.add(toWorld(point)));
      center.multiplyScalar(1 / points.length);
      let spread = 0;
      points.forEach((point) => {
        spread = Math.max(spread, center.distanceTo(toWorld(point)));
      });

      if (controls instanceof OrbitControls) {
        controls.target.copy(center);
        camera.up.copy(UP);
        camera.position
          .copy(center)
          .add(new Vector3(1, 0.8, 1.2).normalize().multiplyScalar(Math.max(12, spread * 3.5)));
        camera.lookAt(center);
      } else {
        controls?.resetState();
        const normal = center.lengthSq() > 1 ? center.clone().normalize() : toWorld(points[0]).normalize();
        if (spread > radius * 0.3) {
          camera.position.copy(normal).multiplyScalar(radius * 3.3);
          camera.up.copy(UP);
          camera.lookAt(0, 0, 0);
        } else {
          center.copy(normal).multiplyScalar(isReference ? radius : toWorld(points[0]).length());
          const east = new Vector3(0, 1, 0).cross(normal);
          if (east.lengthSq() < 1e-12) east.set(1, 0, 0);
          east.normalize();
          const north = normal.clone().cross(east).normalize();
          const distance = Math.max(35, spread * 3.5);
          camera.position
            .copy(center)
            .addScaledVector(normal, distance * 0.6)
            .addScaledVector(east, distance * 0.9)
            .addScaledVector(north, distance * 0.6);
          camera.up.copy(normal);
          camera.lookAt(center);
        }
      }
      camera.updateMatrixWorld();
      if (controlsAreReady()) controls?.update();
    }

    function updateMission() {
      const frame = sourceFrame();
      if (!frame || disposed) return;
      frame.updateWorldMatrix(true, false);
      const current = latestProps.current;
      const placeSymbol = (symbol: Group, point: TerrainPoint | null | undefined) => {
        symbol.visible = Boolean(point);
        if (!point) return;
        symbol.position.copy(toWorld(point));
        symbol.quaternion.setFromUnitVectors(UP, isLocal ? UP : symbol.position.clone().normalize());
      };
      placeSymbol(roverMarker, current.rover);
      placeSymbol(goalMarker, current.goal);
      placeSymbol(robot, current.robotPosition ?? current.rover);
      robot.visible = robot.visible && robot.children.length > 0;
      // Avoid hiding the parked rover under its start marker.
      if (robot.visible && roverMarker.position.distanceToSquared(robot.position) < 0.01)
        roverMarker.visible = false;
      connection.visible = Boolean(current.rover && current.goal);
      if (connection.visible) {
        // Relative vertices preserve precision for small missions on a large body.
        connection.position.copy(roverMarker.position);
        connection.geometry.dispose();
        connection.geometry = new BufferGeometry().setFromPoints([
          new Vector3(),
          goalMarker.position.clone().sub(roverMarker.position),
        ]);
        const distance = roverMarker.position.distanceTo(goalMarker.position);
        connectionMaterial.dashSize = Math.max(distance / 30, 0.3);
        connectionMaterial.gapSize = connectionMaterial.dashSize * 0.6;
        connection.computeLineDistances();
      }
      const history = current.trajectory ?? [];
      trace.visible = history.length >= 2;
      if (trace.visible) {
        const origin = toWorld(history[0]);
        trace.position.copy(origin);
        trace.geometry.dispose();
        trace.geometry = new BufferGeometry().setFromPoints(
          history.map((point) => toWorld(point).sub(origin)),
        );
      }
      if (robot.visible) {
        const forward = new Vector3();
        for (let index = history.length - 2; index >= 0 && forward.lengthSq() < 1e-12; index -= 1)
          forward.copy(robot.position).sub(toWorld(history[index]));
        if (forward.lengthSq() < 1e-12 && current.goal)
          forward.copy(toWorld(current.goal)).sub(robot.position);
        const normal = isLocal ? UP : robot.position.clone().normalize();
        forward.addScaledVector(normal, -forward.dot(normal));
        if (forward.lengthSq() > 1e-12) {
          forward.normalize();
          const right = normal.clone().cross(forward).normalize();
          robot.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(right, normal, forward));
        }
      }
    }

    function capturePatch(): TerrainPatch {
      const origin = latestProps.current.rover;
      if (surfaceData && hasVisibleSurface && origin)
        return captureHeightfieldPatch(surfaceData, source, origin);
      if (!isLocal || !tiles || !hasVisibleSurface || !origin)
        throw new Error('Choose a surface site and place a rover at the centre of a visible terrain patch.');
      tiles.group.updateWorldMatrix(true, true);
      const meshes: Object3D[] = [];
      tiles.group.traverseVisible((object) => {
        if (object instanceof Mesh) meshes.push(object);
      });
      const center = toWorld(origin),
        sampler = new Raycaster();
      sampler.far = 100;
      const heights: number[] = [];
      for (let row = 0; row < 65; row++)
        for (let col = 0; col < 65; col++) {
          sampler.set(
            new Vector3(center.x + (col - 32) * 0.25, center.y + 50, center.z - (row - 32) * 0.25),
            new Vector3(0, -1, 0),
          );
          const hit = sampler.intersectObjects(meshes, false)[0];
          if (!hit)
            throw new Error(
              'This 16 m patch contains missing terrain. Place the rover farther inside the reconstructed site and capture again.',
            );
          heights.push(hit.point.y - center.y);
        }
      return {
        version: '1.0.0',
        source,
        capturedAt: new Date().toISOString(),
        sampling: 'loaded-mesh-raycast',
        resolutionM: 0.25,
        rows: 65,
        cols: 65,
        heights,
        originInSource: { ...origin },
        basisInSource: { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: -1, z: 0 }, z: { x: 0, y: 0, z: -1 } },
        loadedTiles: loadedModels.size,
      };
    }
    function updateNavigation() {
      if (!(controls instanceof OrbitControls)) return;
      const map = latestProps.current.navigationMode !== 'orbit';
      controls.mouseButtons.LEFT = map ? MOUSE.PAN : MOUSE.ROTATE;
      controls.mouseButtons.RIGHT = map ? MOUSE.ROTATE : MOUSE.PAN;
      controls.touches.ONE = map ? TOUCH.PAN : TOUCH.ROTATE;
      controls.touches.TWO = map ? TOUCH.DOLLY_ROTATE : TOUCH.DOLLY_PAN;
    }
    function flyToLocal(position: Vector3, target: Vector3) {
      if (!(controls instanceof OrbitControls)) return;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        camera.position.copy(position);
        controls.target.copy(target);
        controls.update();
        return;
      }
      flight = {
        start: performance.now(),
        from: camera.position.clone(),
        targetFrom: controls.target.clone(),
        to: position.clone(),
        targetTo: target.clone(),
      };
    }
    function navigate(kind: 'in' | 'out' | 'north' | 'top') {
      if (controls instanceof OrbitControls) {
        const offset = camera.position.clone().sub(controls.target),
          distance = offset.length();
        const next = camera.position.clone();
        if (kind === 'in' || kind === 'out')
          next
            .copy(controls.target)
            .add(
              offset.setLength(
                Math.max(1.5, Math.min(controls.maxDistance, distance * (kind === 'in' ? 0.78 : 1.28))),
              ),
            );
        else if (kind === 'top') next.copy(controls.target).add(new Vector3(0, distance, 0.001));
        else next.copy(controls.target).add(new Vector3(0, 0.7, 1).normalize().multiplyScalar(distance));
        flyToLocal(next, controls.target);
      } else if (kind === 'in' || kind === 'out') {
        const pivot = new Vector3();
        controls?.getPivotPoint(pivot);
        const next = camera.position
          .clone()
          .sub(pivot)
          .multiplyScalar(kind === 'in' ? 0.78 : 1.28)
          .add(pivot);
        if (next.length() >= radius + 5 && next.length() <= radius * 20) camera.position.copy(next);
        camera.updateMatrixWorld();
        if (controlsAreReady()) controls?.update();
      } else resetView();
    }
    handleRef.current = { resetView, focusMission, updateMission, capturePatch, updateNavigation, navigate };
    updateNavigation();
    resetView();

    function readyMessage() {
      if (isRaster)
        return `Live terrain ready. ${source.label} · ${source.resolutionLabel}. Drag to pan, scroll to zoom.`;
      if (isReference)
        return imageryUnavailable
          ? 'Imagery unavailable. Reference sphere only. Retry terrain to reload NASA imagery.'
          : 'Global NASA imagery ready. Reference sphere; measured elevation is not loaded.';
      return failedTiles > 0
        ? `Terrain is visible; ${failedTiles} detail request${failedTiles === 1 ? '' : 's'} failed. Retry terrain to reload missing detail.`
        : 'Live terrain ready. Select a marker, then choose a point on the surface.';
    }

    async function loadSurface() {
      try {
        if (isRaster) {
          const response = await fetch(source.heightfieldUrl!, { signal: lifecycle.signal });
          if (!response.ok) throw new Error('Measured terrain unavailable');
          const bytes = await response.arrayBuffer();
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
            b.toString(16).padStart(2, '0'),
          ).join('');
          if (`sha256:${digest}` !== source.sourceRevision) throw new Error('Terrain checksum mismatch');
          surfaceData = validateHeightfield(JSON.parse(new TextDecoder().decode(bytes)), source);
          referenceTexture = await fetchReferenceTexture(
            source.imageryUrl!,
            lifecycle.signal,
            renderer.capabilities.maxTextureSize,
          );
          if (disposed) {
            disposeImageTexture(referenceTexture);
            referenceTexture = null;
            return;
          }
          referenceTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          surfaceGroup = new Group();
          surfaceGroup.rotation.x = Math.PI / 2;
          const mesh = new Mesh(
            createSurfaceGeometry(surfaceData),
            new MeshPhongMaterial({ map: referenceTexture, shininess: 0 }),
          );
          surfaceGroup.add(mesh);
          surfaceGroup.updateMatrixWorld(true);
          loadedModels.add(mesh);
          scene.add(surfaceGroup);
          // Measured Amboy crater floor: the geometric crop centre is too steep
          // for the reference starter. Users can still choose any loaded point.
          const start = mode === 'amboy-crater' ? { x: 60, y: 40 } : { x: 0, y: 0 };
          latestProps.current.onSiteReady?.({
            rover: { ...start, z: -surfaceHeight(surfaceData, start.x, start.y) },
            goal: { x: start.x + 8, y: start.y, z: -surfaceHeight(surfaceData, start.x + 8, start.y) },
          });
          updateMission();
          return;
        }
        if (isReference) {
          if (!source.imageryUrl) throw new Error('Missing global imagery source');
          referenceGroup = new Group();
          referenceGroup.rotation.x = GLOBE_DISPLAY_ROTATION;
          referenceMesh = new Mesh(
            createReferenceSphereGeometry(radius),
            new MeshPhongMaterial({ color: '#637581', shininess: 0 }),
          );
          // A neutral reference sphere remains usable if imagery fails; that
          // distinct state is always reported and never called NASA terrain.
          referenceGroup.add(referenceMesh);
          referenceGroup.updateMatrixWorld(true);
          scene.add(referenceGroup);
          if (controls instanceof GlobeControls) {
            controls.setEllipsoid(new Ellipsoid(radius, radius, radius), referenceGroup);
            controls.setScene(referenceGroup);
          }
          resetView();
          updateMission();
          referenceTexture = await fetchReferenceTexture(
            mode === 'mars'
              ? '/textures/mars-nasa-viking.jpg'
              : mode === 'earth'
                ? '/textures/earth-blue-marble-july2004.jpg'
                : source.imageryUrl,
            lifecycle.signal,
            renderer.capabilities.maxTextureSize,
          );
          if (disposed) {
            disposeImageTexture(referenceTexture);
            referenceTexture = null;
            return;
          }
          referenceTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          referenceMesh.material.color.set('#ffffff');
          referenceMesh.material.map = referenceTexture;
          referenceMesh.material.needsUpdate = true;
          if (referencePatch) {
            referencePatch.material.color.set('#ffffff');
            referencePatch.material.map = referenceTexture;
            referencePatch.material.needsUpdate = true;
          }
          imageryLoaded = true;
          imageryUnavailable = false;
          if (latestProps.current.focusMissionSignal) focusMission();
          return;
        }

        let terrain: TilesRenderer;
        if (isLocal) {
          if (!source.tilesetUrl) throw new Error('Missing public terrain source');
          terrain = new TilesRenderer(source.tilesetUrl);
          // NASA mars.js: display=(source.x, -source.z, source.y).
          terrain.group.rotation.x = Math.PI / 2;
        } else {
          if (!source.ionAssetId) throw new Error('Missing planetary terrain asset');
          const asset = await resolveIonAsset(source.ionAssetId, ionToken.trim(), lifecycle.signal);
          if (disposed) return;
          terrain = new TilesRenderer(asset.url);
          terrain.registerPlugin(asset.fetchPlugin);
          terrain.group.rotation.x = GLOBE_DISPLAY_ROTATION;
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
        if (controls instanceof GlobeControls) {
          controls.setEllipsoid(terrain.ellipsoid, terrain.group);
          controls.setScene(terrain.group);
        }
        terrain.addEventListener('load-root-tileset', () => {
          if (!isLocal) resetView();
          publish('loading', 'Source connected. Streaming the first terrain tiles…');
        });
        terrain.addEventListener('load-model', ({ scene: model }) => {
          if (disposed) return;
          loadedModels.add(model);
          publish(
            hasVisibleSurface ? 'ready' : 'loading',
            hasVisibleSurface ? readyMessage() : 'Decoding terrain geometry and imagery…',
          );
        });
        terrain.addEventListener('dispose-model', ({ scene: model }) => {
          loadedModels.delete(model);
        });
        terrain.addEventListener('load-error', ({ tile }) => {
          if (disposed || lifecycle.signal.aborted) return;
          failedTiles += 1;
          if (hasVisibleSurface) publish('ready', readyMessage());
          else if (!tile || loadedModels.size === 0)
            publish(
              'error',
              isLocal
                ? 'NASA terrain could not be loaded. Check your connection and access to raw.githubusercontent.com, then retry.'
                : 'Planetary terrain could not be loaded. Check the ion token’s asset access and allowed domains, then retry or select public imagery.',
            );
        });
        updateMission();
      } catch {
        if (!disposed && !lifecycle.signal.aborted) {
          if (isReference && referenceMesh) {
            imageryUnavailable = true;
            if (hasVisibleSurface) publish('ready', readyMessage());
          } else {
            publish(
              'error',
              isLocal
                ? `${source.label} terrain could not be initialized. Check the source package and connection, then retry.`
                : 'Could not connect to Cesium ion. Check the read-only token’s asset and domain access, then retry or select public imagery.',
            );
          }
        }
      }
    }

    // A local precision patch follows close views, without adding any elevation.
    function updateReferencePatch() {
      if (!referenceGroup || !referenceMesh || (!imageryLoaded && !imageryUnavailable)) return;
      const localCamera = referenceGroup.worldToLocal(camera.position.clone());
      const altitude = Math.max(5, localCamera.length() - radius);
      if (altitude > radius * 0.025) {
        if (referencePatch) referencePatch.visible = false;
        return;
      }
      const nextCenter = localCamera.normalize().multiplyScalar(radius);
      const halfSpan = Math.max(150, Math.min(radius * 0.16, altitude * 8));
      if (
        !referencePatch ||
        nextCenter.distanceTo(patchCenter) > patchHalfSpan * 0.2 ||
        halfSpan > patchHalfSpan * 1.6 ||
        halfSpan < patchHalfSpan * 0.6
      ) {
        const geometry = createReferencePatchGeometry(nextCenter, radius, halfSpan);
        if (!referencePatch) {
          const material = referenceMesh.material.clone();
          material.polygonOffset = true;
          material.polygonOffsetFactor = -1;
          material.polygonOffsetUnits = -1;
          referencePatch = new Mesh(geometry, material);
          referenceGroup.add(referencePatch);
        } else {
          referencePatch.geometry.dispose();
          referencePatch.geometry = geometry;
        }
        referencePatch.position.copy(nextCenter);
        patchCenter.copy(nextCenter);
        patchHalfSpan = halfSpan;
      }
      referencePatch.visible = true;
    }

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    function placeAt(clientX: number, clientY: number) {
      const kind = latestProps.current.placementMode;
      const frame = sourceFrame();
      if (!kind || !frame || !hasVisibleSurface || disposed || halted) return;
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      camera.updateMatrixWorld();
      frame.updateWorldMatrix(true, true);
      raycaster.setFromCamera(pointer, camera);
      let point: Vector3 | null = null;
      if (isReference) point = pickReferenceSphere(raycaster.ray, radius, frame.matrixWorld);
      else {
        const hit = raycaster.intersectObject(frame, true)[0];
        if (hit) point = frame.worldToLocal(hit.point.clone());
      }
      if (!point) {
        publish(
          'ready',
          isReference
            ? 'The reticle is off the globe. Choose a point on the visible sphere.'
            : 'No loaded surface at that point. Choose visible terrain or zoom in, then try again.',
        );
        return;
      }
      if (![point.x, point.y, point.z].every(Number.isFinite)) return;
      latestProps.current.onPlace(kind, { x: point.x, y: point.y, z: point.z });
    }

    let pointerStart: { x: number; y: number; id: number } | null = null;
    const pointerDown = (event: PointerEvent) => {
      flight = null;
      if (event.button !== 0 || !event.isPrimary) return;
      pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
      canvas.focus({ preventScroll: true });
    };
    const pointerUp = (event: PointerEvent) => {
      const start = pointerStart;
      pointerStart = null;
      if (
        !start ||
        start.id !== event.pointerId ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
      )
        return;
      placeAt(event.clientX, event.clientY);
    };
    const pointerCancel = () => {
      pointerStart = null;
    };
    const keyDown = (event: KeyboardEvent) => {
      flight = null;
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
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(event.key))
        return;
      event.preventDefault();
      if (controls instanceof OrbitControls) {
        if (
          (event.shiftKey || latestProps.current.navigationMode !== 'orbit') &&
          event.key.startsWith('Arrow')
        ) {
          panLocalCamera(
            camera,
            controls.target,
            event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0,
            event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0,
          );
        } else {
          const spherical = new Spherical().setFromVector3(camera.position.clone().sub(controls.target));
          if (event.key === 'ArrowLeft') spherical.theta -= 0.065;
          if (event.key === 'ArrowRight') spherical.theta += 0.065;
          if (event.key === 'ArrowUp') spherical.phi -= 0.065;
          if (event.key === 'ArrowDown') spherical.phi += 0.065;
          if (event.key === '+' || event.key === '=') spherical.radius *= 0.85;
          if (event.key === '-' || event.key === '_') spherical.radius *= 1.18;
          spherical.phi = Math.max(0.05, Math.min(Math.PI * 0.485, spherical.phi));
          spherical.radius = Math.max(1.5, Math.min(650, spherical.radius));
          camera.position.setFromSpherical(spherical).add(controls.target);
          camera.lookAt(controls.target);
        }
      } else if (event.key.startsWith('Arrow')) {
        // Angular steps shrink close to the globe so keyboard navigation remains
        // useful for metre-scale missions instead of jumping hundreds of km.
        const altitude = Math.max(10, camera.position.length() - radius);
        const step = Math.max(1e-7, Math.min(0.065, (altitude / radius) * 0.12));
        const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
        const axis = horizontal ? UP : new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        const rotation = new Quaternion().setFromAxisAngle(axis, direction * step);
        camera.position.applyQuaternion(rotation);
        camera.quaternion.premultiply(rotation);
      } else {
        const pivot = new Vector3();
        controls?.getPivotPoint(pivot);
        const factor = event.key === '+' || event.key === '=' ? 0.85 : 1.18;
        const next = camera.position.clone().sub(pivot).multiplyScalar(factor).add(pivot);
        if (next.length() >= radius + 5 && next.length() <= radius * 20) camera.position.copy(next);
      }
      camera.updateMatrixWorld();
      if (controlsAreReady()) controls?.update();
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      halted = true;
      cancelAnimationFrame(animationFrame);
      startupDeadline?.cancel();
      publish('error', 'The graphics context was interrupted. Retry terrain to recreate the view.');
    };
    const doubleClick = (event: MouseEvent) => {
      const frame = sourceFrame();
      if (!(controls instanceof OrbitControls) || latestProps.current.placementMode || !frame) return;
      const bounds = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(frame, true)[0];
      if (!hit) return;
      const offset = camera.position.clone().sub(controls.target).multiplyScalar(0.65);
      flyToLocal(hit.point.clone().add(offset), hit.point);
    };
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerCancel);
    canvas.addEventListener('keydown', keyDown);
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('dblclick', doubleClick);
    const cancelFlight = () => {
      flight = null;
    };
    canvas.addEventListener('wheel', cancelFlight, { passive: true });

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
      if (!host || (hasVisibleSurface && (document.hidden || host.clientHeight === 0))) {
        animationFrame = requestAnimationFrame(animate);
        return;
      }
      try {
        if (flight && controls instanceof OrbitControls) {
          const t = Math.min(1, (performance.now() - flight.start) / 320),
            eased = 1 - (1 - t) ** 3;
          camera.position.lerpVectors(flight.from, flight.to, eased);
          controls.target.lerpVectors(flight.targetFrom, flight.targetTo, eased);
          if (t === 1) flight = null;
        }
        if (controlsAreReady()) controls?.update();
        camera.updateMatrixWorld();
        updateReferencePatch();
        tiles?.update();
        [roverMarker, goalMarker, robot].forEach((symbol) => {
          if (!symbol.visible) return;
          const unitsPerPixel =
            (camera.position.distanceTo(symbol.position) * 2 * Math.tan((camera.fov * Math.PI) / 360)) /
            Math.max(canvas.clientHeight, 1);
          symbol.scale.setScalar(
            symbol === robot
              ? Math.min(
                  isRaster ? 3 : Infinity,
                  roverDisplayScale(camera, symbol.position, canvas.clientHeight, 0.3963722),
                )
              : Math.max(0.3, unitsPerPixel * 22),
          );
        });
        renderer.render(scene, camera);
        if (sitePinRef.current && location && referenceGroup) {
          const lat = (location.latitude * Math.PI) / 180,
            lon = (location.longitude * Math.PI) / 180;
          const point = new Vector3(
            Math.cos(lat) * Math.cos(lon),
            Math.cos(lat) * Math.sin(lon),
            Math.sin(lat),
          ).multiplyScalar(radius);
          referenceGroup.localToWorld(point);
          const facing = point.dot(camera.position.clone().sub(point)) > 0;
          const projected = point.clone().project(camera);
          const visible =
            facing && Math.abs(projected.x) < 0.88 && Math.abs(projected.y) < 0.88 && projected.z < 1;
          sitePinRef.current.hidden = !visible;
          sitePinRef.current.style.left = `${(projected.x * 0.5 + 0.5) * 100}%`;
          sitePinRef.current.style.top = `${(-projected.y * 0.5 + 0.5) * 100}%`;
        }
        if (halted) return;
        const referenceVisible = (imageryLoaded || imageryUnavailable) && Boolean(referenceMesh?.visible);
        const terrainVisible = Boolean(
          surfaceGroup || (tiles && tiles.visibleTiles.size > 0 && loadedModels.size > 0),
        );
        if (referenceVisible && imageryLoaded && !imageryRendered) {
          imageryRendered = true;
          publish('ready', readyMessage());
        }
        if (!hasVisibleSurface && (referenceVisible || terrainVisible)) {
          hasVisibleSurface = true;
          publish('ready', readyMessage());
          if (latestProps.current.focusMissionSignal) focusMission();
        }
        animationFrame = requestAnimationFrame(animate);
      } catch {
        halted = true;
        startupDeadline?.cancel();
        publish('error', 'The terrain renderer was interrupted. Retry terrain to recreate the view.');
      }
    }
    startupDeadline = createStartupDeadline(() => {
      if (isReference && referenceMesh) imageryUnavailable = true;
      else
        publish(
          'error',
          'Terrain is taking longer than expected. Check the connection and source access, then retry.',
        );
    });
    queueMicrotask(() => {
      if (!disposed) void loadSurface();
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
      canvas.removeEventListener('dblclick', doubleClick);
      canvas.removeEventListener('wheel', cancelFlight);
      controls?.dispose();
      tiles?.dispose();
      if (referenceGroup) disposeGeometryAndMaterials(referenceGroup);
      if (surfaceGroup) disposeGeometryAndMaterials(surfaceGroup);
      disposeImageTexture(referenceTexture);
      referenceTexture = null;
      disposeGeometryAndMaterials(overlayGroup);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      handleRef.current = null;
    };
  }, [mode, layer, ionToken]);

  useEffect(() => {
    handleRef.current?.updateMission();
  }, [rover, goal, robotPosition, trajectory]);
  useEffect(() => {
    handleRef.current?.resetView();
  }, [resetViewSignal]);
  useEffect(() => {
    if (focusMissionSignal) handleRef.current?.focusMission();
  }, [focusMissionSignal]);
  useEffect(() => {
    if (!props.capturePatchSignal || previousCaptureSignal.current === props.capturePatchSignal) return;
    previousCaptureSignal.current = props.capturePatchSignal;
    try {
      if (!handleRef.current) throw new Error('Wait for terrain to load.');
      props.onPatch?.(handleRef.current.capturePatch());
    } catch (error) {
      props.onPatch?.(null, error instanceof Error ? error.message : 'Could not capture terrain.');
    }
  }, [props.capturePatchSignal]);
  useEffect(() => {
    handleRef.current?.updateNavigation();
  }, [props.navigationMode]);
  useEffect(() => {
    if (props.cameraAction) handleRef.current?.navigate(props.cameraAction.kind);
  }, [props.cameraAction]);
  useEffect(() => {
    const canvas = hostRef.current?.querySelector('canvas');
    if (canvas) canvas.style.cursor = props.placementMode ? 'crosshair' : 'grab';
  }, [props.placementMode, mode, layer, ionToken]);

  return (
    <div className="terrain-renderer" style={{ position: 'absolute', inset: 0 }}>
      <div ref={hostRef} className="terrain-canvas-host" style={{ width: '100%', height: '100%' }} />
      {globeSite(mode) &&
        layer === 'imagery' &&
        (() => {
          const site = globeSite(mode)!;
          return (
            <button
              ref={sitePinRef}
              className="globe-site-pin"
              hidden
              title={SITE_LOCATIONS[site].evidence}
              onClick={() => props.onOpenSite?.(site)}
              aria-label={`Explore ${SITE_LOCATIONS[site].label} surface site`}
            >
              <span className="globe-site-dot" aria-hidden="true" />
              <strong>{SITE_LOCATIONS[site].label}</strong>
              <span>{SITE_LOCATIONS[site].region} · Open site ↗</span>
            </button>
          );
        })()}
      {props.placementMode && (
        <div
          className="terrain-center-reticle"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 38,
            height: 38,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            color: props.placementMode === 'rover' ? '#72e0d5' : '#ffba77',
            filter: 'drop-shadow(0 1px 2px #000)',
          }}
        >
          <svg width="38" height="38" viewBox="0 0 38 38" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M19 1v10M19 27v10M1 19h10M27 19h10" />
            <circle cx="19" cy="19" r="4" />
            <circle cx="19" cy="19" r="1" fill="currentColor" stroke="none" />
          </svg>
        </div>
      )}
      {credits.length > 0 && (
        <div
          className="terrain-provider-credits"
          style={{
            position: 'absolute',
            right: 12,
            bottom: 8,
            maxWidth: '70%',
            fontSize: 10,
            lineHeight: 1.4,
            textAlign: 'right',
            color: '#c7d2d9',
            background: 'rgba(8,14,22,.72)',
            padding: '3px 6px',
            pointerEvents: 'none',
          }}
        >
          {credits.join(' · ')}
        </div>
      )}
    </div>
  );
}
