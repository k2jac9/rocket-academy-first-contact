import { describe, expect, it } from 'vitest'
import {
  createMissionManifest,
  distanceMeters,
  getSource,
  validateMissionManifest,
  type CreateMissionInput,
  type SceneMode,
  type TerrainPoint,
} from './mission'

const createdAt = '2026-11-14T12:00:00.000Z'
const rover = { x: 10, y: 20, z: 2 }
const goal = { x: 13, y: 24, z: 2 }

function validMission() {
  return createMissionManifest({ mode: 'dingo-gap', rover, goal, createdAt })
}

describe('mission export', () => {
  it('exports native source positions and an explicitly unvalidated plan', () => {
    const manifest = validMission()

    expect(manifest.schemaVersion).toBe('1.0.0')
    expect(manifest.body).toBe('mars')
    expect(manifest.createdAt).toBe(createdAt)
    expect(manifest.markers.rover.position).toEqual({ x: 10, y: 20, z: 2 })
    expect(manifest.markers.goal.position).toEqual({ x: 13, y: 24, z: 2 })
    expect(manifest.coordinateSpace.kind).toBe('source-local')
    expect(manifest.coordinateSpace.units).toBe('m')
    expect(manifest.coordinateSpace.geodeticRegistration).toBe('not-established')
    expect(manifest.traverse).toEqual({
      straightLineDistanceM: 5,
      distanceMetric: 'euclidean-chord',
      terrainSafetyValidated: false,
    })
    expect(manifest.status).toBe('planned')
    expect(manifest.simulation).toEqual({ physicsValidated: false, trainingRun: false })
    expect(manifest.source.sourceRevision).toMatch(/^[a-f0-9]{40}$/)
    expect(manifest.source.tilesetUrl).toContain(manifest.source.sourceRevision)
    expect(manifest.source.geometryId).toContain(manifest.source.sourceRevision)
  })

  it('round-trips a JSON mission with source provenance intact', () => {
    const manifest = validMission()
    const parsed: unknown = JSON.parse(JSON.stringify(manifest))
    const result = validateMissionManifest(parsed)

    expect(result.valid).toBe(true)
    if (result.valid) expect(result.manifest).toEqual(manifest)
  })

  it.each([
    ['moon', { x: 1_737_400, y: 0, z: 0 }, 2684829, 'moon'],
    ['mars', { x: 3_396_190, y: 0, z: 0 }, 3644333, 'mars'],
  ] as const)('retains the %s source identity in a planetary export', (mode, point, assetId, body) => {
    const manifest = createMissionManifest({ mode, rover: point, goal: point, createdAt })

    expect(manifest.body).toBe(body)
    expect(manifest.source.ionAssetId).toBe(assetId)
    expect(manifest.source.sourceRevision).toBeNull()
    expect(manifest.source.revisionStatus).toBe('provider-managed-unpinned')
    expect(manifest.coordinateSpace.kind).toBe('body-fixed')
    expect(validateMissionManifest(JSON.parse(JSON.stringify(manifest))).valid).toBe(true)
  })

  it('copies marker positions so later UI edits cannot alter an existing export', () => {
    const position = { x: 10, y: 20, z: 2 }
    const manifest = createMissionManifest({ mode: 'dingo-gap', rover: position, goal, createdAt })
    position.x = 99

    expect(manifest.markers.rover.position.x).toBe(10)
  })

  it('does not serialize unexpected credentials or extra marker properties', () => {
    const input = {
      mode: 'dingo-gap',
      rover: { ...rover, accessToken: 'private-marker-value' },
      goal,
      createdAt,
      ionToken: 'private-ion-value',
      apiKey: 'private-key-value',
      source: { accessToken: 'private-source-value' },
    } as CreateMissionInput
    const manifest = createMissionManifest(input)
    const serialized = JSON.stringify(manifest)

    expect(serialized).not.toContain('private-')
    expect(serialized).not.toMatch(/accessToken|ionToken|apiKey/)
    expect(validateMissionManifest(manifest).valid).toBe(true)
  })

  it.each([
    ['missing rover', { rover: null }],
    ['missing goal', { goal: null }],
    ['non-finite x', { rover: { ...rover, x: Number.NaN } }],
    ['infinite y', { goal: { ...goal, y: Number.POSITIVE_INFINITY } }],
    ['non-numeric z', { goal: { ...goal, z: '2' } }],
    ['missing coordinate', { goal: { x: 1, y: 2 } }],
    ['unknown mode', { mode: 'earth' }],
    ['invalid timestamp', { createdAt: 'not-a-time' }],
    ['empty mission name', { missionName: '  ' }],
  ])('refuses to create a mission with %s', (_name, overrides) => {
    expect(() => createMissionManifest({
      mode: 'dingo-gap', rover, goal, createdAt, ...overrides,
    } as CreateMissionInput)).toThrow()
  })

  it('rejects planet-sized positions in the local Dingo Gap frame', () => {
    expect(() => createMissionManifest({
      mode: 'dingo-gap', rover: { x: 3_390_000, y: 0, z: 0 }, goal, createdAt,
    })).toThrow(/local|bound/i)
  })

  it.each(['moon', 'mars'] as const)('rejects near-origin positions in the %s body-fixed frame', (mode) => {
    expect(() => createMissionManifest({ mode, rover, goal, createdAt })).toThrow(/body|radius/i)
  })
})

describe('mission validation', () => {
  it.each([null, [], 'not-a-mission', 42, {}].map((value) => ({ value })))('rejects malformed input without throwing: $value', ({ value }) => {
    expect(validateMissionManifest(value).valid).toBe(false)
  })

  it.each([
    ['body', (m: Record<string, any>) => { m.body = 'moon' }],
    ['source identity', (m: Record<string, any>) => { m.source.sourceId = 'cesium-ion:2684829' }],
    ['source revision', (m: Record<string, any>) => { m.source.sourceRevision = 'unverified' }],
    ['geometry identity', (m: Record<string, any>) => { m.source.geometryId = 'different-geometry' }],
    ['credential-bearing source URL', (m: Record<string, any>) => { m.source.tilesetUrl += '?access_token=private-value' }],
    ['frame', (m: Record<string, any>) => { m.coordinateSpace.frame = 'earth-fixed' }],
    ['units', (m: Record<string, any>) => { m.coordinateSpace.units = 'km' }],
    ['axes', (m: Record<string, any>) => { m.coordinateSpace.axes.z = 'north' }],
    ['missing marker', (m: Record<string, any>) => { delete m.markers.goal }],
    ['swapped marker role', (m: Record<string, any>) => { m.markers.goal.kind = 'rover' }],
    ['invalid position', (m: Record<string, any>) => { m.markers.rover.position.x = Infinity }],
    ['out-of-bounds local position', (m: Record<string, any>) => { m.markers.rover.position.x = 3_390_000 }],
    ['incorrect distance', (m: Record<string, any>) => { m.traverse.straightLineDistanceM = 999 }],
    ['physics validation claim', (m: Record<string, any>) => { m.simulation.physicsValidated = true }],
    ['training claim', (m: Record<string, any>) => { m.simulation.trainingRun = true }],
    ['terrain safety claim', (m: Record<string, any>) => { m.traverse.terrainSafetyValidated = true }],
    ['unknown schema version', (m: Record<string, any>) => { m.schemaVersion = '2.0.0' }],
    ['unknown root credential', (m: Record<string, any>) => { m.ionToken = 'private-value' }],
    ['nested credential', (m: Record<string, any>) => { m.markers.goal.position.token = 'private-value' }],
  ])('rejects tampered %s', (_name, mutate) => {
    const manifest = JSON.parse(JSON.stringify(validMission())) as Record<string, any>
    mutate(manifest)
    const result = validateMissionManifest(manifest)

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.join(' ')).not.toContain('private-value')
    }
  })
})

describe('native-frame distance', () => {
  it('is translation-invariant and uses all three axes', () => {
    const start = { x: 1, y: 2, z: 3 }
    const end = { x: 3, y: 5, z: 9 }
    const offset = { x: 50_000, y: -70_000, z: 90_000 }
    const translate = (point: TerrainPoint) => ({
      x: point.x + offset.x,
      y: point.y + offset.y,
      z: point.z + offset.z,
    })

    expect(distanceMeters(start, end)).toBe(7)
    expect(distanceMeters(translate(start), translate(end))).toBe(7)
    expect(distanceMeters(end, start)).toBe(7)
    expect(distanceMeters(start, start)).toBe(0)
  })

  it('refuses non-finite coordinates and overflow instead of producing invalid JSON values', () => {
    expect(() => distanceMeters({ x: NaN, y: 0, z: 0 }, goal)).toThrow()
    expect(() => distanceMeters({ x: 1e308, y: 0, z: 0 }, { x: -1e308, y: 0, z: 0 })).toThrow()
  })
})

describe('source lookup', () => {
  it('rejects an unknown runtime mode', () => {
    expect(() => getSource('earth' as SceneMode)).toThrow(/source|mode/i)
  })
})
