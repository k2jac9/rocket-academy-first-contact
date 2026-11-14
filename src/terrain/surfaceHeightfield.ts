import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { TerrainPoint, TerrainSource } from '../domain/mission.ts';
import type { TerrainPatch } from '../simulation/episode.ts';

export interface SurfaceHeightfield {
  schemaVersion: '1.0.0';
  siteId: string;
  rows: number;
  cols: number;
  spacingM: number;
  heights: number[];
  originHeightM: number;
  originLongitudeDeg: number;
  originLatitudeDeg: number;
}

export function validateHeightfield(value: SurfaceHeightfield, source: TerrainSource) {
  if (
    value.schemaVersion !== '1.0.0' ||
    value.siteId !== source.id ||
    !Number.isInteger(value.rows) ||
    value.rows < 2 ||
    value.rows > 1025 ||
    value.cols !== value.rows ||
    !Number.isFinite(value.spacingM) ||
    value.spacingM <= 0 ||
    value.heights?.length !== value.rows * value.cols ||
    value.heights.some((h) => !Number.isFinite(h))
  )
    throw new Error('Invalid measured terrain package.');
  return value;
}

/** Triangles have outward -Z normals in the right-handed east/south/down frame. */
export function createSurfaceGeometry(data: SurfaceHeightfield) {
  const { rows, cols, spacingM, heights } = data;
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      positions.push(
        (col - (cols - 1) / 2) * spacingM,
        (row - (rows - 1) / 2) * spacingM,
        -heights[row * cols + col],
      );
      // Mesh vertices are raster pixel centres, not the outer edges of the image.
      uv.push((col + 0.5) / cols, 1 - (row + 0.5) / rows);
      if (row < rows - 1 && col < cols - 1) {
        const a = row * cols + col,
          b = a + 1,
          c = a + cols,
          d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Exact piecewise-linear interpolation of the displayed triangles; no added detail. */
export function surfaceHeight(data: SurfaceHeightfield, x: number, y: number) {
  const u = x / data.spacingM + (data.cols - 1) / 2,
    v = y / data.spacingM + (data.rows - 1) / 2;
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || v < 0 || u > data.cols - 1 || v > data.rows - 1)
    throw new Error('The 16 m patch crosses the measured terrain boundary. Move the rover inward.');
  const col = Math.min(Math.floor(u), data.cols - 2),
    row = Math.min(Math.floor(v), data.rows - 2);
  const dx = u - col,
    dy = v - row,
    a = row * data.cols + col;
  const [h00, h10, h01, h11] = [
    data.heights[a],
    data.heights[a + 1],
    data.heights[a + data.cols],
    data.heights[a + data.cols + 1],
  ];
  return dx + dy <= 1
    ? h00 + dx * (h10 - h00) + dy * (h01 - h00)
    : h11 + (1 - dx) * (h01 - h11) + (1 - dy) * (h10 - h11);
}

export function captureHeightfieldPatch(
  data: SurfaceHeightfield,
  source: TerrainSource,
  origin: TerrainPoint,
  capturedAt = new Date().toISOString(),
): TerrainPatch {
  if (Math.abs(origin.z + surfaceHeight(data, origin.x, origin.y)) > 0.02)
    throw new Error('Rover origin does not lie on the measured heightfield. Place it again.');
  const heights: number[] = [];
  for (let row = 0; row < 65; row++)
    for (let col = 0; col < 65; col++)
      heights.push(
        surfaceHeight(data, origin.x + (col - 32) * 0.25, origin.y - (row - 32) * 0.25) + origin.z,
      );
  return {
    version: '1.0.0',
    source,
    capturedAt,
    sampling: 'pinned-heightfield-interpolation',
    resolutionM: 0.25,
    rows: 65,
    cols: 65,
    heights,
    originInSource: { ...origin },
    basisInSource: { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: -1, z: 0 }, z: { x: 0, y: 0, z: -1 } },
    loadedTiles: 1,
  };
}
