import {
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Ray,
  RepeatWrapping,
  Sphere,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three';

/** Native body-fixed XYZ has +Z north. The display uses Three's +Y up. */
export const GLOBE_DISPLAY_ROTATION = -Math.PI / 2;

export function referenceGlobeViewDistance(radius: number, verticalFovDegrees: number, aspect: number) {
  const verticalHalfAngle = (verticalFovDegrees * Math.PI) / 360;
  const horizontalHalfAngle = Math.atan(Math.tan(verticalHalfAngle) * Math.max(aspect, 0.1));
  return Math.max(
    radius * 3.05,
    (radius / Math.sin(Math.min(verticalHalfAngle, horizontalHalfAngle))) * 1.12,
  );
}

export function createReferenceSphereGeometry(radius: number) {
  // SphereGeometry starts Y-up, with u=.5 on +X. This makes it native Z-up,
  // preserving x=R cos(lat) cos(lon), y=R cos(lat) sin(lon), z=R sin(lat).
  return new SphereGeometry(radius, 128, 64).rotateX(Math.PI / 2);
}

/** Exact reference-sphere picking, independent of the visual mesh's LOD. */
export function pickReferenceSphere(worldRay: Ray, radius: number, sourceFrame: Matrix4) {
  const localRay = worldRay.clone().applyMatrix4(sourceFrame.clone().invert());
  return localRay.intersectSphere(new Sphere(new Vector3(), radius), new Vector3());
}

/**
 * A high precision patch of the same mathematical sphere for close inspection.
 * This supplies no measured elevation. Relative vertices avoid metre-scale
 * float rounding when a small robot is viewed on a planet-sized coordinate grid.
 */
export function createReferencePatchGeometry(
  center: Vector3,
  radius: number,
  halfSpan: number,
  segments = 32,
) {
  const normal = center.clone().normalize();
  const east = new Vector3(0, 0, 1).cross(normal);
  if (east.lengthSq() < 1e-12) east.set(0, 1, 0);
  east.normalize();
  const north = normal.clone().cross(east).normalize();
  const positions: number[] = [];
  const normals: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const centerU = (Math.atan2(normal.y, normal.x) + Math.PI) / (Math.PI * 2);
  const point = new Vector3();

  for (let y = 0; y <= segments; y += 1) {
    for (let x = 0; x <= segments; x += 1) {
      point
        .copy(center)
        .addScaledVector(east, ((x / segments) * 2 - 1) * halfSpan)
        .addScaledVector(north, ((y / segments) * 2 - 1) * halfSpan)
        .normalize()
        .multiplyScalar(radius);
      positions.push(point.x - center.x, point.y - center.y, point.z - center.z);
      normals.push(point.x / radius, point.y / radius, point.z / radius);
      let u = (Math.atan2(point.y, point.x) + Math.PI) / (Math.PI * 2);
      if (u - centerU > 0.5) u -= 1;
      if (u - centerU < -0.5) u += 1;
      uv.push(u, (Math.asin(Math.max(-1, Math.min(1, point.z / radius))) + Math.PI / 2) / Math.PI);
      if (x < segments && y < segments) {
        const a = y * (segments + 1) + x;
        const b = a + 1;
        const d = a + segments + 1;
        const c = d + 1;
        indices.push(a, b, d, b, c, d);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export async function fetchReferenceTexture(url: string, signal: AbortSignal, maxTextureSize: number) {
  const response = await fetch(url, { signal, mode: 'cors' });
  if (!response.ok) throw new Error(`Imagery returned HTTP ${response.status}`);
  const blob = await response.blob();
  signal.throwIfAborted();
  let bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
  if (signal.aborted) {
    bitmap.close();
    signal.throwIfAborted();
  }
  try {
    if (Math.max(bitmap.width, bitmap.height) > maxTextureSize) {
      const ratio = maxTextureSize / Math.max(bitmap.width, bitmap.height);
      const resized = await createImageBitmap(bitmap, {
        resizeWidth: Math.max(1, Math.floor(bitmap.width * ratio)),
        resizeHeight: Math.max(1, Math.floor(bitmap.height * ratio)),
        resizeQuality: 'high',
      });
      bitmap.close();
      bitmap = resized;
    }
    signal.throwIfAborted();
    const texture = new Texture(bitmap);
    texture.flipY = false; // ImageBitmap has already been flipped during decoding.
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  } catch (error) {
    bitmap.close();
    throw error;
  }
}
