import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import {
  createSurfaceGeometry,
  surfaceHeight,
  captureHeightfieldPatch,
  validateHeightfield,
} from './surfaceHeightfield';
import type { SurfaceHeightfield } from './surfaceHeightfield';
import { getSource, createMissionManifest, validateMissionManifest } from '../domain/mission';
import { validateEpisodeRequest } from '../simulation/episode';
import { SITE_LOCATIONS } from '../domain/surfaceSites';

describe('measured lunar and Earth packages', () => {
  it.each(['apollo-17', 'amboy-crater'] as const)(
    'verifies %s bytes, projection, triangle interpolation and source-frame capture',
    (id) => {
      const source = getSource(id);
      const bytes = readFileSync(new URL(`../../public${source.heightfieldUrl}`, import.meta.url));
      expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(source.sourceRevision);
      expect(
        createHash('sha256')
          .update(readFileSync(new URL(`../../public${source.imageryUrl}`, import.meta.url)))
          .digest('hex'),
      ).toBe(source.imagerySha256);
      const data = validateHeightfield(JSON.parse(bytes.toString()), source);
      expect(data.originLatitudeDeg).toBeCloseTo(SITE_LOCATIONS[id].latitude, 3);
      expect(data.originLongitudeDeg).toBeCloseTo(SITE_LOCATIONS[id].longitude, 3);
      const origin = { x: 0, y: 0, z: 0 };
      const patch = captureHeightfieldPatch(data, source, origin);
      expect(patch.heights[32 * 65 + 32]).toBe(0);
      expect(patch.heights[0]).toBe(surfaceHeight(data, -8, 8));
      expect(patch.heights[4224]).toBe(surfaceHeight(data, 8, -8));
      expect(
        validateEpisodeRequest({
          terrain: patch,
          durationS: 5,
          speedMps: 0.25,
          seed: 1,
          robotModels: ['husky', 'jackal'],
        }).terrain.source.body,
      ).toBe(source.body);
      expect(() =>
        captureHeightfieldPatch(data, source, { x: 255, y: 0, z: -surfaceHeight(data, 255, 0) }),
      ).toThrow(/boundary/);
      expect(() => captureHeightfieldPatch(data, source, { x: 0, y: 0, z: 10 })).toThrow(/origin/);
      const geometry = createSurfaceGeometry(data),
        mesh = new Mesh(geometry, new MeshBasicMaterial());
      // Actual rendered triangles and sampled patches must agree, including diagonal splits.
      for (const [x, y] of [
        [0.31, 0.27],
        [-4.81, 3.16],
        [7.72, -7.44],
      ]) {
        const hit = new Raycaster(new Vector3(x, y, -200), new Vector3(0, 0, 1)).intersectObject(mesh)[0];
        expect(hit).toBeDefined();
        expect(-hit.point.z).toBeCloseTo(surfaceHeight(data, x, y), 4);
      }
      const manifest = createMissionManifest({
        mode: id,
        rover: origin,
        goal: { x: 8, y: 0, z: -surfaceHeight(data, 8, 0) },
      });
      expect(validateMissionManifest(manifest).valid).toBe(true);
      expect(manifest.simulation.physicsValidated).toBe(false);
      geometry.dispose();
      mesh.material.dispose();
    },
  );
  it('does not interpolate through missing elevations', () => {
    const invalid = {
      schemaVersion: '1.0.0',
      siteId: 'apollo-17',
      rows: 2,
      cols: 2,
      spacingM: 2,
      heights: [0, NaN, 0, 0],
    } as SurfaceHeightfield;
    expect(() => validateHeightfield(invalid, getSource('apollo-17'))).toThrow(/Invalid/);
  });
});
