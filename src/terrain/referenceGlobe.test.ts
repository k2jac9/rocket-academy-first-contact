import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Ray, Vector3 } from 'three';
import {
  createReferencePatchGeometry,
  createReferenceSphereGeometry,
  GLOBE_DISPLAY_ROTATION,
  pickReferenceSphere,
  referenceGlobeViewDistance,
} from './referenceGlobe';

describe('reference-globe coordinates', () => {
  it.each([0.5, 1, 2])('frames the entire reference sphere at viewport aspect %s', (aspect) => {
    const radius = 3_396_190;
    const camera = new PerspectiveCamera(52, aspect, 1, radius * 20);
    camera.position.set(0, 0, referenceGlobeViewDistance(radius, camera.fov, aspect));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const geometry = createReferenceSphereGeometry(radius);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 1) {
      const projected = new Vector3().fromBufferAttribute(positions, i).project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(0.91);
      expect(Math.abs(projected.y)).toBeLessThan(0.91);
    }
    geometry.dispose();
  });

  it('keeps UV equator/central meridian on native +X and north on native +Z', () => {
    const geometry = createReferenceSphereGeometry(100);
    const positions = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    let equator: Vector3 | null = null;
    let north: Vector3 | null = null;
    for (let i = 0; i < uv.count; i += 1) {
      if (Math.abs(uv.getX(i) - 0.5) < 1e-8 && Math.abs(uv.getY(i) - 0.5) < 1e-8) {
        equator = new Vector3().fromBufferAttribute(positions, i);
      }
      if (uv.getY(i) === 1) north = new Vector3().fromBufferAttribute(positions, i);
    }
    expect(equator?.distanceTo(new Vector3(100, 0, 0))).toBeLessThan(1e-6);
    expect(north?.distanceTo(new Vector3(0, 0, 100))).toBeLessThan(1e-6);
    expect(
      north
        ?.applyMatrix4(new Matrix4().makeRotationX(GLOBE_DISPLAY_ROTATION))
        .distanceTo(new Vector3(0, 100, 0)),
    ).toBeLessThan(1e-6);
    geometry.dispose();
  });

  it('picks exact-radius native points through the source-to-display transform', () => {
    const radius = 3_396_190;
    const frame = new Matrix4().makeRotationX(GLOBE_DISPLAY_ROTATION);
    const expected = new Vector3(1, 2, 3).normalize().multiplyScalar(radius);
    const worldPoint = expected.clone().applyMatrix4(frame);
    const ray = new Ray(worldPoint.clone().multiplyScalar(3), worldPoint.clone().negate().normalize());
    const point = pickReferenceSphere(ray, radius, frame);
    expect(point?.distanceTo(expected)).toBeLessThan(1e-7);
    expect(point?.length()).toBeCloseTo(radius, 7);
  });

  it('keeps a close-up reference patch on the same sphere with local-precision vertices', () => {
    const radius = 6_371_000;
    const center = new Vector3(radius, 0, 0);
    const geometry = createReferencePatchGeometry(center, radius, 100);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      const local = new Vector3().fromBufferAttribute(position, i);
      expect(local.length()).toBeLessThan(142);
      expect(local.clone().add(center).length()).toBeCloseTo(radius, 5);
    }
    geometry.dispose();
  });
});
