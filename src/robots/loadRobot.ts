import { Group, Mesh, Object3D, Quaternion, Vector3, type Material } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { RobotAssetId } from './catalog';

const sources = new Map<RobotAssetId, Promise<Group>>();
const axis = new Vector3(0, 1, 0);
export function disposeRobot(root: Object3D) {
  const materials = new Set<Material>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m);
  });
  materials.forEach((m) => m.dispose());
}

/** Native source frame: +X forward, +Y left, +Z up. Every instance owns its disposable GPU resources. */
export async function loadRobot(id: RobotAssetId) {
  let pending = sources.get(id);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(`/robots/${id}/robot.glb`).then((gltf) => gltf.scene);
    sources.set(id, pending);
    pending.catch(() => sources.delete(id));
  }
  const root = new Group();
  const source = (await pending).clone(true);
  source.rotation.x = Math.PI / 2;
  source.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry = object.geometry.clone();
    object.material = Array.isArray(object.material)
      ? object.material.map((m) => m.clone())
      : object.material.clone();
    object.castShadow = true;
    object.receiveShadow = true;
  });
  root.add(source);
  root.name = id;
  const wheels = Array.from({ length: 4 }, (_, i) => source.getObjectByName(`wheel_${i}`));
  const initial = wheels.map((wheel) => wheel?.quaternion.clone());
  const spin = new Quaternion();
  return {
    root,
    setWheelAngles(angles: number[]) {
      wheels.forEach((wheel, i) => {
        if (wheel && initial[i])
          wheel.quaternion.copy(initial[i]!).multiply(spin.setFromAxisAngle(axis, angles[i] ?? 0));
      });
    },
  };
}
