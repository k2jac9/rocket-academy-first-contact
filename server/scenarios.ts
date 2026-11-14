import { GENIE_ADAPTER } from '../src/scenarios/contracts.ts';
import { SITE_FOR_BODY } from '../src/domain/surfaceSites.ts';
import { getSource } from '../src/domain/mission.ts';
import type {
  ExplorationInput,
  ExplorationRecord,
  ExplorationArtifact,
  ScenarioInput,
  ScenarioRecord,
  ScenarioLineage,
} from '../src/scenarios/contracts.ts';
import { validateEpisodeRequest } from '../src/simulation/episode.ts';
import { ApiError, exactKeys } from './errors.ts';
import { jsonHash } from './hash.ts';

export const SHA256 = /^[0-9a-f]{64}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message: string): never => {
  throw new ApiError(422, 'INVALID_EXPLORATION', message);
};
function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
    return fail(`${label} must contain ${empty ? '0' : '1'}–${max} characters.`);
  return value.trim();
}
function world(value: unknown): asserts value is 'earth' | 'moon' | 'mars' {
  if (!['earth', 'moon', 'mars'].includes(String(value))) fail('Choose Earth, Moon or Mars.');
}
export function validateExploration(value: unknown): ExplorationInput {
  exactKeys(value, [
    'title',
    'body',
    'objective',
    'prompt',
    'model',
    'modelRevision',
    'settingsNotes',
    'referenceImageSha256',
    'recordingSha256',
  ]);
  world(value.body);
  if (!['unknown', 'genie-3', 'genie-4'].includes(String(value.model)))
    fail('Record the reported Genie model or choose unknown.');
  for (const key of ['referenceImageSha256', 'recordingSha256'])
    if (value[key] !== null && (typeof value[key] !== 'string' || !SHA256.test(value[key] as string)))
      fail('Artifact IDs must be SHA-256 hashes from an upload.');
  const revision = value.modelRevision === null ? null : text(value.modelRevision, 'Model revision', 120);
  if (value.model === 'unknown' && revision !== null)
    fail('Choose the reported model before recording a revision.');
  return {
    title: text(value.title, 'Title', 120),
    body: value.body,
    objective: text(value.objective, 'Mission intent', 2000),
    prompt: text(value.prompt, 'World prompt', 8000),
    model: value.model as ExplorationInput['model'],
    modelRevision: revision,
    settingsNotes: text(value.settingsNotes, 'Settings notes', 2000, true),
    referenceImageSha256: value.referenceImageSha256 as string | null,
    recordingSha256: value.recordingSha256 as string | null,
  };
}
export function explorationRecord(
  id: string,
  input: ExplorationInput,
  artifacts: ExplorationArtifact[],
): ExplorationRecord {
  return {
    id,
    schemaVersion: '1.0.0',
    sourceKind: 'generative_world_model',
    evidenceKind: input.recordingSha256 ? 'imported_recording' : 'exploration_brief',
    createdAt: new Date().toISOString(),
    input,
    adapter: GENIE_ADAPTER,
    modelIdentityEvidence: 'operator_reported',
    publication: 'ready',
    artifacts,
    referenceUse: 'visual_conditioning_only',
    eligibility: {
      exploration: true,
      review: true,
      perception: false,
      imitation: false,
      control: false,
      evaluation: false,
      reason:
        'No verified robot action/observation contract, calibrated ground truth or task-specific validation. Review does not confer training eligibility.',
    },
    knownLimits: [
      'Programmatic Genie access has not been verified for this application.',
      'Reference images guide appearance; measured terrain geometry is not established.',
      'No robot action timeline, calibrated sensors or physical state were imported.',
      ...(input.modelRevision ? [] : ['Exact backend revision was not exposed or recorded.']),
      ...(input.recordingSha256
        ? []
        : ['This is a prompt brief; no generated experience has been imported.']),
    ],
  };
}
export function validateScenario(value: unknown): ScenarioInput {
  exactKeys(value, ['explorationId', 'title', 'body', 'robotModels', 'durationS', 'speedMps', 'seed']);
  if (typeof value.explorationId !== 'string' || !UUID.test(value.explorationId))
    fail('Select a saved exploration.');
  world(value.body);
  if (
    !Array.isArray(value.robotModels) ||
    value.robotModels.length !== 2 ||
    value.robotModels.some((id) => !['husky', 'jackal'].includes(id))
  )
    fail('Select Husky or Jackal for each robot.');
  if (
    !Number.isInteger(value.durationS) ||
    (value.durationS as number) < 5 ||
    (value.durationS as number) > 20
  )
    fail('Duration must be 5–20 seconds.');
  if (
    typeof value.speedMps !== 'number' ||
    !Number.isFinite(value.speedMps) ||
    value.speedMps < 0.1 ||
    value.speedMps > 0.5
  )
    fail('Speed must be 0.1–0.5 m/s.');
  if (!Number.isSafeInteger(value.seed) || (value.seed as number) < 0 || (value.seed as number) > 0xffffffff)
    fail('Seed must be an unsigned 32-bit integer.');
  return {
    ...value,
    title: text(value.title, 'Scenario title', 120),
    explorationId: (value.explorationId as string).toLowerCase(),
  } as unknown as ScenarioInput;
}
export function compileScenario(id: string, input: ScenarioInput, source: ExplorationRecord): ScenarioRecord {
  const core = {
    schemaVersion: '1.0.0' as const,
    input,
    objective: source.input.objective,
    inspiredBy: {
      explorationId: source.id,
      sourceKind: 'generative_world_model' as const,
      body: source.input.body,
    },
    execution: {
      adapter: 'mujoco-local' as const,
      task: 'bounded_reference_traverse' as const,
      controller: 'bounded-lane-velocity' as const,
      controllerVersion: '1.1.0' as const,
      terrain: SITE_FOR_BODY[input.body],
      terrainRevision: getSource(SITE_FOR_BODY[input.body]).sourceRevision,
      geometryId: getSource(SITE_FOR_BODY[input.body]).geometryId,
      body: input.body,
      runnable: true,
      blockers: [],
      limitations: [
        `Requires a complete ${SITE_FOR_BODY[input.body]} measured terrain patch captured in Worlds.`,
        'Body-specific constant gravity with experimental rigid contact; soil, atmosphere, thermal effects and hardware suitability are not validated.',
        'Both robots use scripted reference controllers; no policy training or route handoff is implemented.',
        'Mission intent is retained for design review; the executable task is a bounded reference traverse.',
        'Generated geometry and imagery do not supply physics state or sensor ground truth.',
      ],
    },
  };
  return { id, createdAt: new Date().toISOString(), sha256: jsonHash(core), ...core };
}
export function verifyScenarioExecution(scenario: ScenarioRecord, value: unknown): ScenarioLineage {
  if (!scenario.execution.runnable)
    throw new ApiError(422, 'SCENARIO_NOT_RUNNABLE', scenario.execution.blockers.join(' '));
  let input;
  try {
    input = validateEpisodeRequest(value);
  } catch (e) {
    throw new ApiError(422, 'INVALID_SCENARIO', e instanceof Error ? e.message : 'Invalid scenario.');
  }
  if (
    input.terrain.source.id !== scenario.execution.terrain ||
    input.terrain.source.body !== scenario.execution.body ||
    (scenario.execution.terrainRevision !== undefined &&
      input.terrain.source.sourceRevision !== scenario.execution.terrainRevision) ||
    (scenario.execution.geometryId !== undefined &&
      input.terrain.source.geometryId !== scenario.execution.geometryId)
  )
    throw new ApiError(
      409,
      'SCENARIO_MISMATCH',
      'Terrain differs from the frozen scenario. Capture the selected world and site before running.',
    );
  for (const field of ['durationS', 'speedMps', 'seed', 'robotModels'] as const)
    if (jsonHash(input[field]) !== jsonHash(scenario.input[field]))
      throw new ApiError(
        409,
        'SCENARIO_MISMATCH',
        'Episode settings differ from the frozen scenario. Create a new scenario version or detach it before editing.',
      );
  return {
    scenarioVersionId: scenario.id,
    scenarioSha256: scenario.sha256,
    inspiredBy: scenario.inspiredBy,
    sourceKind: 'physics_simulation',
  };
}
