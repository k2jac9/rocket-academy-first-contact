import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { createRoverModel, roverDisplayScale } from './roverModel';

describe('rover visibility', () => {
  it('places all six wheels on the model ground plane', () => {
    const rover = createRoverModel();
    const wheels = rover.children.filter((child) => child.name === 'wheel');
    expect(wheels).toHaveLength(6);
    for (const wheel of wheels) expect(new Box3().setFromObject(wheel).min.y).toBeCloseTo(0, 6);
    expect(new Box3().setFromObject(rover).min.y).toBeGreaterThanOrEqual(-1e-6);
  });

  it.each([20, 200, 2_000_000])('keeps the model readable at camera distance %s', (distance) => {
    const position = new Vector3(3_396_190, 0, 0);
    const camera = new PerspectiveCamera(52, 2, 0.1, 20_000_000);
    camera.position.copy(position).add(new Vector3(0, 0.9, distance));
    camera.lookAt(position.clone().add(new Vector3(0, 0.9, 0)));
    camera.updateMatrixWorld();
    const rover = createRoverModel();
    rover.position.copy(position);
    rover.scale.setScalar(roverDisplayScale(camera, position, 600));
    const bounds = new Box3().setFromObject(rover);
    const ys: number[] = [];
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) ys.push(new Vector3(x, y, z).project(camera).y);
    const pixels = (Math.max(...ys) - Math.min(...ys)) * 300;
    expect(pixels).toBeGreaterThanOrEqual(70);
    expect(pixels).toBeLessThan(90);
    expect(rover.position.equals(position)).toBe(true);
  });
});
