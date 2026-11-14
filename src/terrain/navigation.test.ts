import { afterAll, describe, expect, it } from 'vitest';
import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { panLocalCamera } from './navigation';

const geometry = new PlaneGeometry(1000, 1000);
const material = new MeshBasicMaterial({ side: DoubleSide });
const surface = new Mesh(geometry, material);
surface.rotation.x = -Math.PI / 2;
surface.updateMatrixWorld();

function centerSurfacePick(camera: PerspectiveCamera) {
  camera.updateMatrixWorld();
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(0, 0), camera);
  const hit = raycaster.intersectObject(surface)[0];
  if (!hit) throw new Error('Center ray did not hit the test surface');
  return hit.point;
}

afterAll(() => {
  geometry.dispose();
  material.dispose();
});

// Real CPU geometry/raycasting: no renderer or mocked raycaster is involved.
describe('keyboard surface navigation', () => {
  it.each([
    ['right', 1, 0],
    ['up', 0, 1],
  ] as const)('can select distinct surface endpoints after panning %s', (_, horizontal, vertical) => {
    const camera = new PerspectiveCamera(52, 1.6, 0.1, 2000);
    const target = new Vector3(0, 0, 0);
    camera.position.set(27, 18, 32);
    camera.lookAt(target);
    const firstPoint = centerSurfacePick(camera);
    const originalDirection = camera.getWorldDirection(new Vector3());
    const originalHeight = camera.position.y;

    panLocalCamera(camera, target, horizontal, vertical);
    const secondPoint = centerSurfacePick(camera);

    expect(firstPoint.distanceTo(secondPoint)).toBeGreaterThan(1);
    expect(secondPoint.y).toBeCloseTo(0, 8);
    expect(secondPoint.distanceTo(target)).toBeLessThan(1e-8);
    expect(camera.position.y).toBe(originalHeight);
    expect(camera.getWorldDirection(new Vector3()).distanceTo(originalDirection)).toBeLessThan(1e-8);
  });
});
