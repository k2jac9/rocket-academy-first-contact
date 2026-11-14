import { describe, expect, it } from 'vitest';
import { GENIE_ADAPTER } from '../src/scenarios/contracts.ts';
import type { ExplorationInput, ScenarioInput } from '../src/scenarios/contracts.ts';
import { exampleEpisodeRequest } from '../src/simulation/episodeFixture.ts';
import { SITE_FOR_BODY } from '../src/domain/surfaceSites.ts';
import { getSource } from '../src/domain/mission.ts';
import {
  compileScenario,
  explorationRecord,
  validateExploration,
  validateScenario,
  verifyScenarioExecution,
} from './scenarios.ts';
import { validateArtifact, MAX_REFERENCE_IMAGE_BYTES } from './explorationStore.ts';
import { createApiHandler } from './app.ts';
import { AtlasStore } from './atlas.ts';
import { readConfig } from './config.ts';
import { createGeminiPlanner } from './gemini.ts';

const id = '62c73f31-d9c8-48ef-976e-e30954f85ac6';
const brief: ExplorationInput = {
  title: 'Supply route',
  body: 'moon',
  objective: 'Explore a scout and carrier handoff.',
  prompt: 'A lunar supply route with a blocked passage.',
  model: 'unknown',
  modelRevision: null,
  settingsNotes: 'No external generation performed.',
  referenceImageSha256: null,
  recordingSha256: null,
};
const selection: ScenarioInput = {
  explorationId: id,
  title: 'Reference traverse',
  body: 'mars',
  robotModels: ['husky', 'jackal'],
  durationS: 5,
  speedMps: 0.2,
  seed: 1,
};
const source = () => explorationRecord(id, validateExploration(brief), []);
describe('Genie provenance and execution boundaries', () => {
  it('keeps manual access unverified regardless of Gemini configuration', async () => {
    const config = readConfig({ GEMINI_API_KEY: 'unit-test-only' });
    const handler = createApiHandler({
      config,
      store: new AtlasStore(config),
      planner: createGeminiPlanner(config),
    });
    const get = await handler(
      new Request('http://127.0.0.1:8787/api/integrations/genie', { headers: { host: '127.0.0.1:8787' } }),
    );
    expect(await get.json()).toEqual(GENIE_ADAPTER);
    const run = await handler(
      new Request('http://127.0.0.1:8787/api/integrations/genie/execute', {
        method: 'POST',
        headers: { host: '127.0.0.1:8787' },
      }),
    );
    expect(run.status).toBe(501);
    expect((await run.json()).error.code).toBe('GENIE_ACCESS_UNVERIFIED');
  });
  it('does not call a brief a generated experience or admit it for learning', () => {
    const record = source();
    expect(record.evidenceKind).toBe('exploration_brief');
    expect(record.input.modelRevision).toBeNull();
    expect(record.eligibility).toMatchObject({
      exploration: true,
      review: true,
      perception: false,
      imitation: false,
      control: false,
      evaluation: false,
    });
    const video = explorationRecord(id, { ...brief, recordingSha256: 'a'.repeat(64) }, []);
    expect(video.evidenceKind).toBe('imported_recording');
    expect(video.eligibility.control).toBe(false);
    expect(video.knownLimits).toContain(
      'No robot action timeline, calibrated sensors or physical state were imported.',
    );
  });
  it.each([
    { ...brief, eligibility: { control: true } },
    { ...brief, modelRevision: 'invented' },
    { ...brief, model: 'genie-next' },
    { ...brief, referenceImageSha256: 'not-a-hash' },
    { ...brief, prompt: ' ' },
    { ...brief, body: 'jupiter' },
    { ...brief, title: 'x'.repeat(121) },
  ])('rejects unsupported or forged provenance', (value) =>
    expect(() => validateExploration(value)).toThrow(),
  );
  it('records an explicit Mars adaptation without changing the source world', () => {
    const record = compileScenario(id, validateScenario(selection), source());
    expect(record.execution.runnable).toBe(true);
    expect(record.inspiredBy.body).toBe('moon');
    expect(record.input.body).toBe('mars');
    expect(record.execution.task).toBe('bounded_reference_traverse');
    expect(record.sha256).toBe(compileScenario(id, validateScenario(selection), source()).sha256);
    expect(record.sha256).not.toBe(compileScenario(id, { ...selection, seed: 2 }, source()).sha256);
  });
  it.each(['moon', 'earth'] as const)(
    'pins %s scenarios to their own measured site and rejects a Mars patch',
    (body) => {
      const record = compileScenario(id, { ...selection, body }, source());
      expect(record.execution.runnable).toBe(true);
      expect(record.execution.terrain).toBe(SITE_FOR_BODY[body]);
      expect(record.execution.body).toBe(body);
      expect(record.execution.terrainRevision).toBe(getSource(SITE_FOR_BODY[body]).sourceRevision);
      expect(() => verifyScenarioExecution(record, exampleEpisodeRequest())).toThrow(/Terrain differs/);
      const input = exampleEpisodeRequest();
      input.robotModels = selection.robotModels;
      input.durationS = selection.durationS;
      input.speedMps = selection.speedMps;
      input.seed = selection.seed;
      input.terrain.source = getSource(SITE_FOR_BODY[body]);
      input.terrain.sampling = 'pinned-heightfield-interpolation';
      expect(verifyScenarioExecution(record, input).scenarioVersionId).toBe(id);
      expect(() =>
        verifyScenarioExecution(
          { ...record, execution: { ...record.execution, terrainRevision: 'sha256:' + '0'.repeat(64) } },
          input,
        ),
      ).toThrow(/Terrain differs/);
      // Historical frozen design-only versions keep their original gate.
      expect(() =>
        verifyScenarioExecution(
          {
            ...record,
            execution: { ...record.execution, runnable: false, blockers: ['Legacy design-only version.'] },
          },
          input,
        ),
      ).toThrow(/Legacy/);
    },
  );
  it('binds physical recordings to the frozen settings and original exploration', () => {
    const input = exampleEpisodeRequest();
    const record = compileScenario(
      id,
      {
        ...selection,
        durationS: input.durationS,
        speedMps: input.speedMps,
        seed: input.seed,
        robotModels: ['husky', 'jackal'],
      },
      source(),
    );
    input.robotModels = ['husky', 'jackal'];
    expect(verifyScenarioExecution(record, input)).toMatchObject({
      sourceKind: 'physics_simulation',
      scenarioVersionId: id,
      scenarioSha256: record.sha256,
      inspiredBy: { explorationId: id, body: 'moon' },
    });
    expect(() => verifyScenarioExecution(record, { ...input, seed: input.seed + 1 })).toThrow(/differ/);
    expect(() => verifyScenarioExecution(record, { ...input, robotModels: ['jackal', 'husky'] })).toThrow(
      /differ/,
    );
    expect(() =>
      verifyScenarioExecution(record, { ...input, terrain: { ...input.terrain, source: {} } }),
    ).toThrow(/pinned NASA/);
  });
  it.each([
    { ...selection, robotModels: ['drone', 'husky'] },
    { ...selection, speedMps: NaN },
    { ...selection, durationS: 100 },
    { ...selection, seed: -1 },
    { ...selection, execution: { runnable: true } },
  ])('rejects unbounded or client-forged executable settings', (value) =>
    expect(() => validateScenario(value)).toThrow(),
  );
});
describe('bounded original artifact imports', () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  it('checks content type against signatures without accepting executable formats', () => {
    expect(validateArtifact(png, 'image/png')).toBe('image/png');
    expect(() => validateArtifact(png, 'video/mp4')).toThrow(/matching/);
    expect(() =>
      validateArtifact(new TextEncoder().encode('<svg onload="alert(1)"/>'), 'image/svg+xml'),
    ).toThrow();
  });
  it('rejects empty and oversized reference files', () => {
    expect(() => validateArtifact(new Uint8Array(), 'image/png')).toThrow(/nonempty/);
    const huge = new Uint8Array(MAX_REFERENCE_IMAGE_BYTES + 1);
    huge.set(png);
    expect(() => validateArtifact(huge, 'image/png')).toThrow(/8 MiB/);
  });
});
