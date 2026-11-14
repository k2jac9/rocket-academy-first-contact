import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  PHYSICS_ROBOTS,
  type EpisodeMetadata,
  type EpisodeRequest,
  type PhysicsFrame,
  type TerrainPatch,
} from '../simulation/episode';
import { isRobotAsset, ROBOT_CATALOG } from '../robots/catalog';
import { disposeRobot, loadRobot } from '../robots/loadRobot';

export function PhysicsScene({
  terrain,
  episode,
  frame,
  models,
}: {
  terrain: TerrainPatch;
  episode: EpisodeMetadata | null;
  frame: PhysicsFrame | null;
  models: EpisodeRequest['robotModels'];
}) {
  const [assetError, setAssetError] = useState('');
  const focus = useRef<(target: 'fleet' | 'terrain' | 'rover-1' | 'rover-2') => void>(() => {});
  const host = useRef<HTMLDivElement>(null),
    current = useRef(frame);
  useEffect(() => {
    current.current = frame;
  }, [frame]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    setAssetError('');
    const scene = new Scene();
    scene.background = new Color('#f7f8f5');
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true });
    } catch {
      element.textContent = 'WebGL is unavailable. Episode downloads remain available.';
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.domElement.setAttribute(
      'aria-label',
      `Frozen ${terrain.source.label} terrain with two physics robots`,
    );
    renderer.domElement.setAttribute('role', 'img');
    element.append(renderer.domElement);
    const camera = new PerspectiveCamera(48, 1, 0.03, 200);
    camera.up.set(0, 0, 1);
    const average = terrain.heights.reduce((a, b) => a + b, 0) / terrain.heights.length;
    camera.position.set(1, -5, average + 3.5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(-4, 0, average + 0.15);
    controls.enableDamping = true;
    controls.zoomToCursor = true;
    controls.minDistance = 2;
    controls.maxDistance = 65;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();
    scene.add(new AmbientLight('#c6d7e2', 1.5));
    const sun = new DirectionalLight('#fff1d6', 3);
    sun.position.set(-5, -8, average + 18);
    sun.target.position.set(-1, 0, average);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -12;
    sun.shadow.camera.right = sun.shadow.camera.top = 12;
    sun.shadow.camera.far = 60;
    sun.shadow.normalBias = 0.008;
    scene.add(sun, sun.target);
    const positions: number[] = [],
      indices: number[] = [],
      colors: number[] = [];
    const low = Math.min(...terrain.heights),
      high = Math.max(...terrain.heights),
      color = new Color();
    for (let row = 0; row < terrain.rows; row++)
      for (let col = 0; col < terrain.cols; col++) {
        const height = terrain.heights[row * terrain.cols + col];
        positions.push(
          (col - (terrain.cols - 1) / 2) * terrain.resolutionM,
          (row - (terrain.rows - 1) / 2) * terrain.resolutionM,
          height,
        );
        color.setHSL(
          0.075,
          terrain.source.body === 'moon' ? 0 : terrain.source.body === 'earth' ? 0.12 : 0.25,
          0.23 + ((height - low) / Math.max(0.01, high - low)) * 0.19,
        );
        colors.push(color.r, color.g, color.b);
        if (row < terrain.rows - 1 && col < terrain.cols - 1) {
          const a = row * terrain.cols + col,
            b = a + 1,
            c = a + terrain.cols,
            d = c + 1;
          indices.push(a, b, d, a, d, c);
        }
      }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const surface = new Mesh(
      geometry,
      new MeshStandardMaterial({ vertexColors: true, roughness: 1, side: DoubleSide }),
    );
    surface.receiveShadow = true;
    scene.add(surface);
    const robots = new Map<string, { body: Group; setWheelAngles: (angles: number[]) => void }>();
    const selectedModels =
      episode?.robotModels ??
      models.map((id, i) => ({
        ...PHYSICS_ROBOTS.find((r) => r.id === id)!,
        id: `rover-${i + 1}`,
        modelId: id,
      }));
    for (const [index, model] of selectedModels.entries()) {
      if (isRobotAsset(model.modelId)) {
        void loadRobot(model.modelId)
          .then((asset) => {
            if (disposed) {
              disposeRobot(asset.root);
              return;
            }
            const row = Math.round(((index === 0 ? -1.8 : 1.8) + 8) / terrain.resolutionM);
            const col = Math.round(4 / terrain.resolutionM);
            const ground = terrain.heights[row * terrain.cols + col];
            asset.root.position.set(
              -4,
              index === 0 ? -1.8 : 1.8,
              ground + (ROBOT_CATALOG.find((r) => r.id === model.modelId)?.rootToGroundM ?? 0),
            );
            scene.add(asset.root);
            robots.set(model.id, { body: asset.root, setWheelAngles: asset.setWheelAngles });
          })
          .catch(() => {
            if (!disposed)
              setAssetError(
                'A robot model could not load. Reload to retry; recorded states remain available.',
              );
          });
        continue;
      }
      const body = new Group(),
        wheels: Mesh[] = [];
      const shell = new MeshStandardMaterial({ color: index === 0 ? '#67d9c6' : '#f3b67c', roughness: 0.6 });
      body.add(new Mesh(new BoxGeometry(model.lengthM, model.widthM * 0.76, 0.24), shell));
      const mast = new Mesh(
        new CylinderGeometry(0.025, 0.025, 0.36, 8),
        new MeshStandardMaterial({ color: '#b5cccd' }),
      );
      mast.rotation.x = Math.PI / 2;
      mast.position.set(0.25, 0, 0.28);
      body.add(mast);
      const head = new Mesh(new BoxGeometry(0.14, 0.2, 0.1), new MeshStandardMaterial({ color: '#354e5c' }));
      head.position.set(0.25, 0, 0.48);
      body.add(head);
      const xs = [-model.lengthM * 0.36, model.lengthM * 0.36];
      if (model.wheels === 6) xs.splice(1, 0, 0);
      for (const side of [-1, 1])
        for (const x of xs) {
          const wheel = new Mesh(
            new CylinderGeometry(model.wheelRadiusM, model.wheelRadiusM, 0.13, 20),
            new MeshStandardMaterial({ color: '#18252a', roughness: 0.9 }),
          );
          wheel.position.set(x, (side * model.widthM) / 2, -0.12);
          body.add(wheel);
          wheels.push(wheel);
          const hub = new Mesh(new BoxGeometry(0.025, 0.14, model.wheelRadiusM * 1.4), shell);
          wheel.add(hub);
        }
      scene.add(body);
      robots.set(model.id, {
        body,
        setWheelAngles: (angles) =>
          wheels.forEach((wheel, i) => {
            wheel.rotation.y = angles[i] ?? 0;
          }),
      });
    }
    let flight: { start: number; from: Vector3; targetFrom: Vector3; to: Vector3; targetTo: Vector3 } | null =
      null;
    focus.current = (target) => {
      const center =
        target === 'terrain'
          ? new Vector3(0, 0, average)
          : target === 'fleet'
            ? new Vector3()
                .addVectors(
                  robots.get('rover-1')?.body.position ?? new Vector3(-4, -1.8, average),
                  robots.get('rover-2')?.body.position ?? new Vector3(-4, 1.8, average),
                )
                .multiplyScalar(0.5)
            : (robots.get(target)?.body.position.clone() ?? new Vector3(-4, 0, average));
      const offset =
        target === 'terrain'
          ? new Vector3(8, -10, 10)
          : target === 'fleet'
            ? new Vector3(5, -5, 3.5)
            : new Vector3(2, -2, 1.5);
      const to = center.clone().add(offset);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        camera.position.copy(to);
        controls.target.copy(center);
        controls.update();
      } else
        flight = {
          start: performance.now(),
          from: camera.position.clone(),
          targetFrom: controls.target.clone(),
          to,
          targetTo: center,
        };
    };
    const cancelFlight = () => {
      flight = null;
    };
    controls.addEventListener('start', cancelFlight);
    const resize = () => {
      const rect = element.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let raf = 0;
    const animate = () => {
      if (document.hidden || element.clientHeight === 0) {
        raf = requestAnimationFrame(animate);
        return;
      }
      for (const state of current.current?.robots ?? []) {
        const robot = robots.get(state.id);
        if (!robot) continue;
        robot.body.position.fromArray(state.position);
        const [w, x, y, z] = state.orientationWxyz;
        robot.body.quaternion.set(x, y, z, w);
        robot.setWheelAngles(state.jointPosition);
      }
      if (flight) {
        const t = Math.min(1, (performance.now() - flight.start) / 320),
          smooth = t * t * (3 - 2 * t);
        camera.position.lerpVectors(flight.from, flight.to, smooth);
        controls.target.lerpVectors(flight.targetFrom, flight.targetTo, smooth);
        if (t === 1) flight = null;
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      focus.current = () => {};
      const materials = new Set<MeshStandardMaterial>();
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material) ? object.material : [object.material])
            materials.add(material as MeshStandardMaterial);
        }
      });
      materials.forEach((m) => m.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [terrain, episode, models]);
  return (
    <>
      <div className="physics-view-controls">
        <span>{episode ? 'RECORDED REPLAY' : 'PLACEMENT PREVIEW'}</span>
        {(['fleet', 'rover-1', 'rover-2', 'terrain'] as const).map((target) => (
          <button key={target} onClick={() => focus.current(target)}>
            {target === 'rover-1'
              ? 'Robot 1'
              : target === 'rover-2'
                ? 'Robot 2'
                : target === 'fleet'
                  ? 'Fleet'
                  : 'Terrain'}
          </button>
        ))}
      </div>
      <div ref={host} className="physics-scene" />
      {assetError && <p role="alert">{assetError}</p>}
    </>
  );
}
