import type { CelestialBody, SceneMode, TerrainSource } from './mission.ts';
import measuredSites from './measuredSites.json' with { type: 'json' };

export type SurfaceSiteId = 'dingo-gap' | 'apollo-17' | 'amboy-crater';
export const SITE_FOR_BODY: Record<CelestialBody, SurfaceSiteId> = {
  mars: 'dingo-gap',
  moon: 'apollo-17',
  earth: 'amboy-crater',
};
export function isSurfaceSite(mode: unknown): mode is SurfaceSiteId {
  return mode === 'dingo-gap' || mode === 'apollo-17' || mode === 'amboy-crater';
}
/** Context pins only. They never register a local mesh to a planetary frame. */
export const SITE_LOCATIONS = {
  'dingo-gap': {
    latitude: -4.62655059,
    longitude: 137.4072626,
    label: 'Dingo Gap',
    region: 'Gale crater',
    coordinates: '4.6266° S · 137.4073° E',
    evidence: 'Curiosity Sol 528 · RMC 26_184 · approximate context location',
    sourceUrl: 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json',
  },
  'apollo-17': {
    latitude: 20.1911,
    longitude: 30.7723,
    label: 'Apollo 17',
    region: 'Taurus–Littrow',
    coordinates: '20.1911° N · 30.7723° E',
    evidence: 'LROC Apollo 17 landing-site vicinity · approximate context location',
    sourceUrl: 'https://lroc.im-ldi.com/data/support/downloads/2016_LROC_Coordinates_of_Human_Features.pdf',
  },
  'amboy-crater': {
    latitude: 34.545,
    longitude: -115.791,
    label: 'Amboy Crater',
    region: 'Mojave Desert',
    coordinates: '34.5450° N · 115.7910° W',
    evidence: 'Selected USGS DEM crop centre · approximate context location',
    sourceUrl: 'https://www.sciencebase.gov/catalog/item/67590577d34edfeb87103a69',
  },
} as const;

export function globeSite(mode: SceneMode) {
  return isSurfaceSite(mode) ? null : SITE_FOR_BODY[mode];
}

function rasterSource(id: 'apollo-17' | 'amboy-crater'): TerrainSource {
  const metadata = measuredSites[id];
  const hash = metadata.heightfieldSha256;
  const moon = id === 'apollo-17';
  const location = SITE_LOCATIONS[id];
  const frame = moon ? 'LROC Apollo 17 cropped equirectangular ESD' : 'USGS Amboy cropped NAD83 UTM 11N ESD';
  return {
    georeference: metadata.georeference,
    imagerySha256: metadata.imagerySha256,
    id,
    label: location.label,
    body: moon ? 'moon' : 'earth',
    layer: 'terrain',
    geometryKind: 'heightfield',
    radiusM: moon ? 1_737_400 : 6_371_000,
    imageryUrl: `/terrain/${id}/orthophoto.webp`,
    heightfieldUrl: `/terrain/${id}/heightfield.json`,
    summary: moon
      ? 'A 512 m lunar terrain crop from the LROC NAC Apollo 17 stereo DTM, draped with its matching orthophoto.'
      : 'A 512 m Mojave volcanic terrain crop from the USGS 3DEP lidar-derived DEM, draped with USDA NAIP imagery.',
    resolutionLabel: moon
      ? '2 m elevation posts · 2 m NAC imagery'
      : '1 m elevation grid · NAIP aerial imagery',
    locationLabel: `${location.region} · ${location.coordinates}`,
    credit: moon
      ? 'NASA / GSFC / Arizona State University · LROC NAC'
      : 'USGS 3DEP · USDA NAIP / The National Map',
    sourceUrl: moon ? 'https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_APOLLO17' : location.sourceUrl,
    requiresToken: false,
    sourceId: moon ? 'lroc:NAC_DTM_APOLLO17_1:crop-v1' : 'usgs:USGS_1M_11_x61y383_CA_FEMALevee_D23:crop-v1',
    frame,
    units: 'm',
    provider: moon ? 'NASA LROC' : 'USGS / USDA',
    tilesetUrl: null,
    ionAssetId: null,
    sourceRevision: `sha256:${hash}`,
    revisionStatus: 'pinned',
    dataReleaseId: moon ? 'LROLRC_2001:NAC_DTM_APOLLO17_1' : '67590577d34edfeb87103a69',
    geometryId: `first-contact:${id}:heightfield:${hash}`,
    coordinateSpace: {
      kind: 'source-local',
      frame,
      units: 'm',
      handedness: 'right',
      axes: {
        x: 'Projected grid east',
        y: 'Projected grid south',
        z: 'Down relative to the crop centre elevation',
      },
      origin: `Centre DEM sample; exact projection, projected origin and vertical reference in /terrain/${id}/provenance.json and heightfield.json`,
      geodeticRegistration: 'provider-defined',
    },
  };
}
export const RASTER_SOURCES = [rasterSource('apollo-17'), rasterSource('amboy-crater')] as const;
