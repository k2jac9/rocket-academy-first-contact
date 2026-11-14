import { PerspectiveCamera, Vector3 } from 'three';

/**
 * Move a local orbit target beneath the center reticle. Translating the camera
 * and target together preserves view direction and camera height. Screen-right
 * and screen-up are projected onto the local horizontal plane so repeated keys
 * move across the site instead of lifting the orbit target into the sky.
 */
export function panLocalCamera(
  camera: PerspectiveCamera,
  target: Vector3,
  horizontalSteps: number,
  verticalSteps: number,
) {
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  right.y = 0;
  up.y = 0;
  right.normalize();
  up.normalize();

  // A key step covers about 4% of the vertical span at the orbit target.
  const step =
    Math.max(camera.position.distanceTo(target), 1) * 2 * Math.tan((camera.fov * Math.PI) / 360) * 0.04;
  const offset = right.multiplyScalar(horizontalSteps * step).addScaledVector(up, verticalSteps * step);
  camera.position.add(offset);
  target.add(offset);
  camera.updateMatrixWorld();
}
