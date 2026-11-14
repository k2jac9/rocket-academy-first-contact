export type SceneMode = 'dingo-gap' | 'moon' | 'mars' | 'earth';
export type TerrainLayer = 'imagery' | 'terrain';
export type MarkerKind = 'rover' | 'goal';
export type CelestialBody = 'moon' | 'mars' | 'earth';
export interface TerrainPoint {
  x: number;
  y: number;
  z: number;
}

export interface CoordinateSpace {
  kind: 'source-local' | 'body-fixed';
  frame: string;
  units: 'm';
  handedness: 'right';
  axes: { x: string; y: string; z: string };
  origin: string;
  geodeticRegistration: 'not-established' | 'provider-defined' | 'approximate-spherical';
}

export interface TerrainSource {
  readonly id: SceneMode;
  readonly layer: TerrainLayer;
  readonly geometryKind: 'reference-sphere' | 'streamed-terrain';
  readonly radiusM: number;
  readonly imageryUrl: string | null;
  readonly imagerySourceUrl?: string;
  readonly label: string;
  readonly body: CelestialBody;
  readonly summary: string;
  readonly resolutionLabel: string;
  readonly locationLabel: string;
  readonly credit: string;
  readonly sourceUrl: string;
  readonly requiresToken: boolean;
  readonly sourceId: string;
  readonly frame: string;
  readonly units: 'm';
  readonly provider: string;
  readonly tilesetUrl: string | null;
  readonly ionAssetId: number | null;
  readonly sourceRevision: string | null;
  readonly revisionStatus: 'pinned' | 'provider-managed-unpinned';
  readonly dataReleaseId: string | null;
  readonly geometryId: string;
  readonly coordinateSpace: CoordinateSpace;
}

const DINGO_REVISION = '76444abbb4faff1b05f46a09b81ca2c24602b333';
const DINGO_GEOMETRY_PATH =
  'msl-dingo-gap/0528_0260184_to_s64o256_colorize/0528_0260184_to_s64o256_colorize/0528_0260184_to_s64o256_colorize_tileset.json';

function bodyFixedSpace(body: 'Moon' | 'Mars'): CoordinateSpace {
  return {
    kind: 'body-fixed',
    frame: `Cesium ${body} body-fixed XYZ`,
    units: 'm',
    handedness: 'right',
    axes: {
      x: 'Source +X in the equatorial plane; meridian defined by provider',
      y: 'Source +Y in the equatorial plane, completing the right-handed frame',
      z: 'Source +Z toward the north pole',
    },
    origin: `${body} body center as defined by the provider`,
    geodeticRegistration: 'provider-defined',
  };
}

/** Source provenance is pinned where possible. ion content versions are not pinned. */
const TERRAIN_SOURCES: readonly TerrainSource[] = [
  {
    id: 'dingo-gap',
    layer: 'terrain',
    geometryKind: 'streamed-terrain',
    radiusM: 3_396_190,
    imageryUrl: null,
    label: 'Dingo Gap',
    body: 'mars',
    summary:
      'A local reconstruction of Curiosity’s Dingo Gap site from rover and orbital imagery, processed with NASA’s Landform pipeline.',
    resolutionLabel: 'Variable reconstruction detail; ground resolution not specified',
    locationLabel: 'Gale crater · Curiosity’s Dingo Gap site',
    credit: 'NASA/JPL-Caltech/MSSS · University of Arizona · USGS Astrogeology · F. Calef / T. Parker',
    sourceUrl: `https://github.com/NASA-AMMOS/3DTilesSampleData/tree/${DINGO_REVISION}/msl-dingo-gap`,
    requiresToken: false,
    sourceId: 'nasa-msl-dingo-gap-colorized-ground',
    frame: 'Dingo Gap native local XYZ',
    units: 'm',
    provider: 'NASA/JPL-Caltech',
    tilesetUrl: `https://raw.githubusercontent.com/NASA-AMMOS/3DTilesSampleData/${DINGO_REVISION}/${DINGO_GEOMETRY_PATH}`,
    ionAssetId: null,
    sourceRevision: DINGO_REVISION,
    revisionStatus: 'pinned',
    dataReleaseId: 'URS297920',
    geometryId: `NASA-AMMOS/3DTilesSampleData@${DINGO_REVISION}:${DINGO_GEOMETRY_PATH}`,
    coordinateSpace: {
      kind: 'source-local',
      frame: 'Dingo Gap native local XYZ',
      units: 'm',
      handedness: 'right',
      axes: {
        x: 'Native source +X; geographic direction unverified',
        y: 'Native source +Y; geographic direction unverified',
        z: 'Native source +Z; downward after the display orientation',
      },
      origin: 'Dataset-local origin; no verified tie to a planetary geodetic frame',
      geodeticRegistration: 'not-established',
    },
  },
  {
    id: 'moon',
    layer: 'terrain',
    geometryKind: 'streamed-terrain',
    radiusM: 1_737_400,
    imageryUrl: null,
    label: 'The Moon',
    body: 'moon',
    summary:
      'Cesium’s global lunar terrain combines NASA LRO and other lunar datasets, with finer terrain around the poles.',
    resolutionLabel: 'Terrain ~59–60 m globally; down to ~5 m near the poles',
    locationLabel: 'Lunar surface · global coverage',
    credit: 'Cesium · NASA · USGS Astrogeology Science Center',
    sourceUrl: 'https://cesium.com/platform/cesium-ion/content/cesium-moon/',
    requiresToken: true,
    sourceId: 'cesium-ion:2684829',
    frame: 'Cesium Moon body-fixed XYZ',
    units: 'm',
    provider: 'Cesium ion',
    tilesetUrl: null,
    ionAssetId: 2684829,
    sourceRevision: null,
    revisionStatus: 'provider-managed-unpinned',
    dataReleaseId: null,
    geometryId: 'cesium-ion:2684829:provider-managed',
    coordinateSpace: bodyFixedSpace('Moon'),
  },
  {
    id: 'mars',
    layer: 'terrain',
    geometryKind: 'streamed-terrain',
    radiusM: 3_396_190,
    imageryUrl: null,
    label: 'Mars',
    body: 'mars',
    summary:
      'Cesium’s global Mars terrain combines NASA MOLA and ESA HRSC elevation data with Viking imagery and finer crater coverage.',
    resolutionLabel: 'Terrain ~200 m globally; ~20 m Jezero; ~1 m Gale',
    locationLabel: 'Martian surface · global coverage',
    credit: 'Cesium · NASA · ESA · USGS Astrogeology Science Center',
    sourceUrl: 'https://cesium.com/platform/cesium-ion/content/cesium-mars/',
    requiresToken: true,
    sourceId: 'cesium-ion:3644333',
    frame: 'Cesium Mars body-fixed XYZ',
    units: 'm',
    provider: 'Cesium ion',
    tilesetUrl: null,
    ionAssetId: 3644333,
    sourceRevision: null,
    revisionStatus: 'provider-managed-unpinned',
    dataReleaseId: null,
    geometryId: 'cesium-ion:3644333:provider-managed',
    coordinateSpace: bodyFixedSpace('Mars'),
  },
];

const NASA_TEXTURE_REVISION = '11ebb4ee043715aefbba6aeec8a61746fad67fa7';

function imagerySource(input: {
  id: CelestialBody;
  label: string;
  radiusM: number;
  imageryUrl: string;
  imagerySourceUrl?: string;
  sourceId: string;
  sourceUrl: string;
  sourceRevision: string | null;
  resolutionLabel: string;
  summary: string;
  credit: string;
  registration: CoordinateSpace['geodeticRegistration'];
}): TerrainSource {
  const frame = `${input.label} spherical reference XYZ`;
  return {
    ...input,
    body: input.id,
    layer: 'imagery',
    geometryKind: 'reference-sphere',
    frame,
    units: 'm',
    locationLabel: 'Whole-body visual context · reference sphere',
    requiresToken: false,
    provider: 'NASA',
    tilesetUrl: null,
    ionAssetId: null,
    revisionStatus: input.sourceRevision ? 'pinned' : 'provider-managed-unpinned',
    dataReleaseId: null,
    geometryId: `first-contact:reference-sphere:${input.id}:${input.radiusM}m:v1`,
    coordinateSpace: {
      kind: 'body-fixed',
      frame,
      units: 'm',
      handedness: 'right',
      axes: {
        x:
          input.registration === 'not-established'
            ? 'Application equatorial +X; texture central-meridian registration unverified'
            : 'Application equatorial +X at 0 degrees east on the spherical model',
        y: 'Equatorial +Y, completing the right-handed model frame',
        z: 'Application +Z toward the north pole',
      },
      origin: `Application body center; spherical modeling radius ${input.radiusM} m, not a surveyed terrain origin`,
      geodeticRegistration: input.registration,
    },
  };
}

/** Token-free overview sources. Measured terrain is selected explicitly by layer. */
export const SOURCES: readonly TerrainSource[] = [
  imagerySource({
    id: 'mars',
    label: 'Mars',
    radiusM: 3_396_190,
    imageryUrl: `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/${NASA_TEXTURE_REVISION}/Images%20and%20Textures/Mars/Mars.jpg`,
    sourceId: 'nasa-3d-resources:mars-imagery',
    sourceUrl: 'https://science.nasa.gov/3d-resources/mars/',
    sourceRevision: NASA_TEXTURE_REVISION,
    resolutionLabel: '1440 × 720 imagery · reference sphere, no elevation',
    summary:
      'NASA’s Mars image texture displayed on a declared reference sphere. It provides whole-planet visual context, not measured terrain relief or a collision mesh.',
    credit: 'NASA / JPL / Caltech · Viking imagery processed at USGS',
    registration: 'not-established',
  }),
  imagerySource({
    id: 'moon',
    label: 'The Moon',
    radiusM: 1_737_400,
    imageryUrl: '/textures/moon-lroc-color-2k.jpg',
    imagerySourceUrl: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg',
    sourceId: 'nasa-svs:4720:lroc-color-2k',
    sourceUrl: 'https://svs.gsfc.nasa.gov/4720/',
    sourceRevision: 'sha256:f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170',
    resolutionLabel: '2048 × 1024 LRO imagery · reference sphere, no elevation',
    summary:
      'NASA’s LRO CGI Moon Kit equirectangular color map, displayed on a reference sphere. The image is processed for visualization and does not supply terrain elevation.',
    credit: 'NASA Scientific Visualization Studio · NASA / GSFC / Arizona State University',
    registration: 'approximate-spherical',
  }),
  imagerySource({
    id: 'earth',
    label: 'Earth',
    radiusM: 6_371_000,
    imageryUrl:
      'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x5400x2700.jpg',
    sourceId: 'nasa-blue-marble:2004-07:base',
    sourceUrl: 'https://earthobservatory.nasa.gov/features/BlueMarble/BlueMarble_monthlies.php',
    sourceRevision: null,
    resolutionLabel: '5400 × 2700 Blue Marble imagery · no elevation',
    summary:
      'NASA Blue Marble July 2004 imagery on a rounded mean-radius reference sphere. This is a static visual layer, not live weather, a terrain DEM, or a WGS84 ellipsoid.',
    credit: 'NASA Earth Observatory · Blue Marble Next Generation',
    registration: 'approximate-spherical',
  }),
  TERRAIN_SOURCES[0]!,
];

export interface MissionSource {
  layer: TerrainLayer;
  geometryKind: TerrainSource['geometryKind'];
  radiusM: number;
  imageryUrl: string | null;
  sourceId: string;
  provider: string;
  sourceUrl: string;
  tilesetUrl: string | null;
  ionAssetId: number | null;
  sourceRevision: string | null;
  revisionStatus: TerrainSource['revisionStatus'];
  dataReleaseId: string | null;
  geometryId: string;
  credit: string;
  geometryUsage: 'view-dependent-visualization' | 'reference-sphere';
  fixedCollisionMesh: false;
}

export interface MissionManifest {
  schema: 'rocket-academy.mission';
  schemaVersion: '2.0.0';
  missionName: string;
  createdAt: string;
  status: 'planned';
  mode: SceneMode;
  layer: TerrainLayer;
  body: CelestialBody;
  source: MissionSource;
  coordinateSpace: CoordinateSpace;
  markers: {
    rover: { kind: 'rover'; position: TerrainPoint };
    goal: { kind: 'goal'; position: TerrainPoint };
  };
  traverse: {
    straightLineDistanceM: number;
    distanceMetric: 'euclidean-chord';
    terrainSafetyValidated: false;
  };
  simulation: { physicsValidated: false; trainingRun: false };
}

export interface CreateMissionInput {
  mode: SceneMode;
  layer?: TerrainLayer;
  rover: TerrainPoint;
  goal: TerrainPoint;
  createdAt?: string;
  missionName?: string;
}

export type MissionValidationResult =
  { valid: true; manifest: MissionManifest } | { valid: false; errors: string[] };

export function getSource(mode: SceneMode, layer: TerrainLayer = 'imagery'): TerrainSource {
  if (!SOURCES.some((item) => item.id === mode)) throw new Error('Unknown terrain source mode');
  if (layer !== 'imagery' && layer !== 'terrain') throw new Error('Unsupported source layer');
  const resolvedLayer = mode === 'dingo-gap' ? 'terrain' : layer;
  const source = (resolvedLayer === 'terrain' ? TERRAIN_SOURCES : SOURCES).find((item) => item.id === mode);
  if (!source) throw new Error('This terrain layer is not available for the selected body');
  return source;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinitePoint(value: unknown): value is TerrainPoint {
  return (
    isRecord(value) &&
    ['x', 'y', 'z'].every((axis) => typeof value[axis] === 'number' && Number.isFinite(value[axis]))
  );
}

/** Euclidean distance in native metre coordinates; on a globe this is a chord, not a surface route. */
export function distanceMeters(start: TerrainPoint, end: TerrainPoint): number {
  if (!isFinitePoint(start) || !isFinitePoint(end))
    throw new Error('Positions require finite numeric XYZ coordinates');
  const distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  if (!Number.isFinite(distance)) throw new Error('Position separation exceeds the supported numeric range');
  return distance;
}

function sourceMetadata(source: TerrainSource): MissionSource {
  return {
    layer: source.layer,
    geometryKind: source.geometryKind,
    radiusM: source.radiusM,
    imageryUrl: source.imagerySourceUrl ?? source.imageryUrl,
    sourceId: source.sourceId,
    provider: source.provider,
    sourceUrl: source.sourceUrl,
    tilesetUrl: source.tilesetUrl,
    ionAssetId: source.ionAssetId,
    sourceRevision: source.sourceRevision,
    revisionStatus: source.revisionStatus,
    dataReleaseId: source.dataReleaseId,
    geometryId: source.geometryId,
    credit: source.credit,
    geometryUsage:
      source.geometryKind === 'reference-sphere' ? 'reference-sphere' : 'view-dependent-visualization',
    fixedCollisionMesh: false,
  };
}

function copyPosition(value: TerrainPoint, label: string): TerrainPoint {
  if (!isFinitePoint(value)) throw new Error(`${label} requires finite numeric XYZ coordinates`);
  return { x: value.x, y: value.y, z: value.z };
}

/** Explicit field selection intentionally excludes credentials and unrelated application state. */
export function createMissionManifest(input: CreateMissionInput): MissionManifest {
  const source = getSource(input.mode, input.layer);
  const rover = copyPosition(input.rover, 'Rover');
  const goal = copyPosition(input.goal, 'Goal');
  const manifest: MissionManifest = {
    schema: 'rocket-academy.mission',
    schemaVersion: '2.0.0',
    missionName: input.missionName === undefined ? `${source.label} traverse` : input.missionName.trim(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    status: 'planned',
    mode: source.id,
    layer: source.layer,
    body: source.body,
    source: sourceMetadata(source),
    coordinateSpace: { ...source.coordinateSpace, axes: { ...source.coordinateSpace.axes } },
    markers: { rover: { kind: 'rover', position: rover }, goal: { kind: 'goal', position: goal } },
    traverse: {
      straightLineDistanceM: distanceMeters(rover, goal),
      distanceMetric: 'euclidean-chord',
      terrainSafetyValidated: false,
    },
    simulation: { physicsValidated: false, trainingRun: false },
  };
  const result = validateMissionManifest(manifest);
  if (!result.valid) throw new Error(`Invalid mission: ${result.errors.join('; ')}`);
  return manifest;
}

function requireKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  errors: string[],
) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    errors.push(`${path} contains unsupported fields`);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
  }
}

/** Match all fixed provenance fields and reject additions instead of retaining hidden payloads. */
function requireExact(value: unknown, expected: unknown, path: string, errors: string[]): void {
  if (!isRecord(expected)) {
    if (value !== expected) errors.push(`${path} does not match the supported mission contract`);
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  requireKeys(value, Object.keys(expected), path, errors);
  for (const [key, expectedValue] of Object.entries(expected))
    requireExact(value[key], expectedValue, `${path}.${key}`, errors);
}

function validatePosition(
  value: unknown,
  source: TerrainSource,
  path: string,
  errors: string[],
): value is TerrainPoint {
  const mode = source.id;
  if (!isFinitePoint(value)) {
    errors.push(`${path} requires finite numeric XYZ coordinates`);
    return false;
  }
  requireKeys(value as unknown as Record<string, unknown>, ['x', 'y', 'z'], path, errors);
  const radius = Math.hypot(value.x, value.y, value.z);
  // Broad sanity bounds only. These are neither terrain intersection tests nor geodetic validation.
  if (mode === 'dingo-gap' && radius > 1_000)
    errors.push(`${path} exceeds the Dingo Gap local coordinate bound`);
  if (mode === 'moon' && (radius < 1_000_000 || radius > 2_500_000))
    errors.push(`${path} is outside the Moon body-radius bounds`);
  if (mode === 'mars' && (radius < 2_500_000 || radius > 4_500_000))
    errors.push(`${path} is outside the Mars body-radius bounds`);
  if (mode === 'earth' && (radius < 5_500_000 || radius > 7_500_000))
    errors.push(`${path} is outside the Earth body-radius bounds`);
  if (
    source.geometryKind === 'reference-sphere' &&
    Math.abs(radius - source.radiusM) > Math.max(0.1, source.radiusM * 1e-8)
  )
    errors.push(`${path} is not on the declared reference sphere`);
  return true;
}

/** Validate parsed JSON without accepting additional fields, credentials, or unsupported scientific claims. */
export function validateMissionManifest(value: unknown): MissionValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['Mission must be an object'] };
  requireKeys(
    value,
    [
      'schema',
      'schemaVersion',
      'missionName',
      'createdAt',
      'status',
      'mode',
      'layer',
      'body',
      'source',
      'coordinateSpace',
      'markers',
      'traverse',
      'simulation',
    ],
    'Mission',
    errors,
  );
  if (value.layer !== 'imagery' && value.layer !== 'terrain')
    return { valid: false, errors: [...errors, 'Mission layer is not supported'] };
  let source: TerrainSource;
  try {
    source = getSource(value.mode as SceneMode, value.layer);
  } catch {
    return { valid: false, errors: [...errors, 'Mission source mode or layer is not supported'] };
  }

  for (const [key, expected] of Object.entries({
    schema: 'rocket-academy.mission',
    schemaVersion: '2.0.0',
    status: 'planned',
    layer: source.layer,
    body: source.body,
    source: sourceMetadata(source),
    coordinateSpace: source.coordinateSpace,
    simulation: { physicsValidated: false, trainingRun: false },
  }))
    requireExact(value[key], expected, key, errors);

  if (
    typeof value.missionName !== 'string' ||
    value.missionName.trim().length === 0 ||
    value.missionName.length > 120
  ) {
    errors.push('missionName must contain 1–120 characters');
  }
  if (
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt
  ) {
    errors.push('createdAt must be a canonical UTC ISO timestamp');
  }

  const positions: Partial<Record<MarkerKind, TerrainPoint>> = {};
  if (!isRecord(value.markers)) {
    errors.push('markers must include rover and goal');
  } else {
    requireKeys(value.markers, ['rover', 'goal'], 'markers', errors);
    for (const kind of ['rover', 'goal'] as const) {
      const marker = value.markers[kind];
      if (!isRecord(marker)) {
        errors.push(`markers.${kind} is required`);
        continue;
      }
      requireKeys(marker, ['kind', 'position'], `markers.${kind}`, errors);
      requireExact(marker.kind, kind, `markers.${kind}.kind`, errors);
      if (validatePosition(marker.position, source, `markers.${kind}.position`, errors))
        positions[kind] = marker.position;
    }
  }

  if (!isRecord(value.traverse)) {
    errors.push('traverse must be an object');
  } else {
    requireKeys(
      value.traverse,
      ['straightLineDistanceM', 'distanceMetric', 'terrainSafetyValidated'],
      'traverse',
      errors,
    );
    requireExact(value.traverse.distanceMetric, 'euclidean-chord', 'traverse.distanceMetric', errors);
    requireExact(value.traverse.terrainSafetyValidated, false, 'traverse.terrainSafetyValidated', errors);
    const distance = value.traverse.straightLineDistanceM;
    if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) {
      errors.push('traverse.straightLineDistanceM must be a finite nonnegative number');
    } else if (positions.rover && positions.goal) {
      const expected = Math.hypot(
        positions.goal.x - positions.rover.x,
        positions.goal.y - positions.rover.y,
        positions.goal.z - positions.rover.z,
      );
      if (!Number.isFinite(expected) || Math.abs(distance - expected) > Math.max(1e-6, expected * 1e-12)) {
        errors.push('traverse.straightLineDistanceM does not match marker positions');
      }
    }
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, manifest: value as unknown as MissionManifest };
}
