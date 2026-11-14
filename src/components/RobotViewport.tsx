import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  CircleGeometry,
  DirectionalLight,
  Mesh,
  ShadowMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ROBOT_CATALOG, type RobotAssetId } from '../robots/catalog';
import { disposeRobot, loadRobot } from '../robots/loadRobot';

export function RobotViewport({ id, interactive = true }: { id: RobotAssetId; interactive?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const robot = ROBOT_CATALOG.find((r) => r.id === id)!;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setStatus('loading');
    let disposed = false,
      raf = 0,
      dirty = true;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus('error');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.domElement.setAttribute(
      'aria-label',
      `${robot.manufacturer} ${robot.name} 3D model. ${interactive ? 'Drag to orbit and scroll to zoom. Arrow keys rotate; plus and minus zoom.' : ''}`,
    );
    renderer.domElement.setAttribute('role', 'img');
    if (interactive) renderer.domElement.tabIndex = 0;
    element.appendChild(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(35, 1, 0.01, 100);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = interactive;
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.addEventListener('change', () => {
      dirty = true;
    });
    scene.add(new AmbientLight('#eaf1ff', 0.9));
    const key = new DirectionalLight('#fff6df', 3);
    key.position.set(-2, -4, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -2;
    key.shadow.camera.right = key.shadow.camera.top = 2;
    key.shadow.normalBias = 0.015;
    const fill = new DirectionalLight('#ffffff', 1.4);
    fill.position.set(3, 2, 2);
    scene.add(key, fill);
    let home = new Vector3();
    const fit = () => {
      camera.position.copy(home);
      controls.update();
      dirty = true;
    };
    const keyDown = (event: KeyboardEvent) => {
      const direction = camera.position.clone().sub(controls.target);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
        direction.applyAxisAngle(new Vector3(0, 0, 1), event.key === 'ArrowLeft' ? 0.16 : -0.16);
      else if (event.key === '+' || event.key === '=') direction.multiplyScalar(0.85);
      else if (event.key === '-') direction.multiplyScalar(1.15);
      else if (event.key === 'Home') {
        event.preventDefault();
        fit();
        return;
      } else return;
      event.preventDefault();
      camera.position
        .copy(controls.target)
        .add(direction.clampLength(controls.minDistance, controls.maxDistance));
      controls.update();
      dirty = true;
    };
    renderer.domElement.addEventListener('keydown', keyDown);
    element.addEventListener('robot-reset', fit);
    void loadRobot(id)
      .then(({ root }) => {
        if (disposed) {
          disposeRobot(root);
          return;
        }
        scene.add(root);
        const bounds = new Box3().setFromObject(root),
          center = bounds.getCenter(new Vector3()),
          size = bounds.getSize(new Vector3());
        const radius = Math.max(size.x, size.y, size.z);
        controls.target.copy(center);
        controls.minDistance = radius * 0.8;
        controls.maxDistance = radius * 5;
        home = center.clone().add(new Vector3(1.7, -2.3, 1.35).multiplyScalar(radius * 0.68));
        const ground = new Mesh(new CircleGeometry(radius * 1.3, 64), new ShadowMaterial({ opacity: 0.17 }));
        ground.position.set(center.x, center.y, bounds.min.z - 0.003);
        ground.receiveShadow = true;
        scene.add(ground);
        fit();
        setStatus('ready');
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      renderer.setSize(element.clientWidth, element.clientHeight, false);
      camera.aspect = element.clientWidth / element.clientHeight;
      camera.updateProjectionMatrix();
      dirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const animate = () => {
      if (!document.hidden && element.clientHeight > 0) {
        controls.update();
        if (dirty) {
          renderer.render(scene, camera);
          dirty = false;
        }
      }
      raf = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      element.removeEventListener('robot-reset', fit);
      renderer.domElement.removeEventListener('keydown', keyDown);
      disposeRobot(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [id, interactive, robot]);
  return (
    <div
      className={`robot-viewport ${interactive ? '' : 'robot-viewport-small'}`}
      style={{ backgroundColor: robot.color }}
    >
      <div className="robot-viewport-canvas" ref={host} />
      {status !== 'ready' && (
        <div className="robot-viewport-fallback">
          <img src={`/robots/${id}/preview.webp`} alt={`${robot.manufacturer} ${robot.name}`} />
          <span role="status">
            {status === 'loading' ? 'Loading 3D model…' : '3D view unavailable · model preview'}
          </span>
        </div>
      )}
      {interactive && (
        <>
          <span className="robot-view-label">{status === 'ready' ? 'INTERACTIVE 3D' : 'ROBOT MODEL'}</span>
          <button
            className="robot-reset"
            onClick={() => host.current?.dispatchEvent(new Event('robot-reset'))}
            aria-label="Reset robot view"
          >
            ↺ Reset view
          </button>
          <span className="robot-view-hint">Drag to orbit · Scroll to zoom</span>
        </>
      )}
    </div>
  );
}
