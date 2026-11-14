import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';

const MODEL_HEIGHT = 1.8;

/** A visible six-wheel representation; dimensions are not a calibrated robot model. */
export function createRoverModel(): Group {
  const rover = new Group();
  rover.name = 'rover-1';
  const shell = new MeshStandardMaterial({ color: '#e2e9df', roughness: 0.6, metalness: 0.25 });
  const frame = new MeshStandardMaterial({ color: '#617c86', roughness: 0.55, metalness: 0.5 });
  const tire = new MeshStandardMaterial({ color: '#202831', roughness: 0.95 });
  const accent = new MeshStandardMaterial({ color: '#68dfc8', roughness: 0.5, metalness: 0.15 });
  const panel = new MeshStandardMaterial({ color: '#243e60', roughness: 0.35, metalness: 0.4 });
  const lens = new MeshStandardMaterial({ color: '#091825', roughness: 0.15, metalness: 0.7 });
  const box = (x: number, y: number, z: number, position: Vector3, material = shell) => {
    const mesh = new Mesh(new BoxGeometry(x, y, z), material);
    mesh.position.copy(position);
    rover.add(mesh);
    return mesh;
  };
  box(1.38, 0.4, 1.8, new Vector3(0, 0.71, 0));
  box(1.65, 0.08, 1.95, new Vector3(0, 0.95, 0), accent);
  box(1.15, 0.1, 0.75, new Vector3(0, 1.04, -0.42), panel);
  for (const x of [-0.38, 0, 0.38]) box(0.018, 0.012, 0.75, new Vector3(x, 1.096, -0.42), frame);
  const mast = new Mesh(new CylinderGeometry(0.055, 0.065, 0.58, 12), frame);
  mast.position.set(0, 1.27, 0.55);
  rover.add(mast);
  box(0.55, 0.24, 0.26, new Vector3(0, 1.68, 0.55));
  for (const x of [-0.15, 0.15]) box(0.12, 0.12, 0.025, new Vector3(x, 1.69, 0.693), lens);
  const wheelGeometry = new CylinderGeometry(0.3, 0.3, 0.28, 20);
  const hubGeometry = new CylinderGeometry(0.12, 0.12, 0.3, 12);
  for (const side of [-1, 1]) {
    for (const z of [-0.78, 0, 0.78]) {
      const wheel = new Mesh(wheelGeometry, tire);
      wheel.name = 'wheel';
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.98, 0.3, z);
      rover.add(wheel);
      const hub = new Mesh(hubGeometry, frame);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      rover.add(hub);
      const lower = new Vector3(side * 0.92, 0.35, z);
      const upper = new Vector3(side * 0.6, 0.68, z * 0.6);
      const strut = new Mesh(new CylinderGeometry(0.045, 0.045, lower.distanceTo(upper), 8), frame);
      strut.position.copy(lower).add(upper).multiplyScalar(0.5);
      strut.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), upper.sub(lower).normalize());
      rover.add(strut);
    }
  }
  return rover;
}

/** Keep the robot legible when zoomed out, without changing recorded coordinates. */
export function roverDisplayScale(
  camera: PerspectiveCamera,
  position: Vector3,
  viewportHeight: number,
  modelHeight = MODEL_HEIGHT,
): number {
  const depth = Math.abs(position.clone().applyMatrix4(camera.matrixWorldInverse).z);
  const unitsPerPixel = (depth * 2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(viewportHeight, 1);
  return Math.max(1, (unitsPerPixel * 72) / modelHeight);
}
