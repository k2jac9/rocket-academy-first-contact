/** Usage: node scripts/create_mcap_fixture.ts /tmp/first-contact.mcap [dingo-gap|moon|mars|earth] */
import { writeFile } from 'node:fs/promises';
import { createMissionManifest, type SceneMode } from '../src/domain/mission.ts';
import { createExamplePoints } from '../src/domain/exampleMission.ts';
import { createBaselinePlan, runMission } from '../src/simulation/missionRun.ts';
import { encodeRunMcap, inspectRunMcap } from '../src/recording/mcap.ts';

const output = process.argv[2];
if (!output)
  throw new Error('Provide an output .mcap path; an optional second argument selects the destination.');
const mode = (process.argv[3] ?? 'dingo-gap') as SceneMode;
const points =
  mode === 'dingo-gap'
    ? { rover: { x: 0, y: 0, z: 2 }, goal: { x: 20, y: 0, z: 2 } }
    : createExamplePoints(mode);
const startedAt = '2026-11-14T12:00:00.000Z';
const mission = createMissionManifest({
  mode,
  createdAt: startedAt,
  missionName: `First Contact ${mode} kinematic example`,
  ...points,
});
const plan = createBaselinePlan(mission);
plan.rationale =
  'Deterministic 20 m example at 1 m/s, with initial and final kinematic state observations. No terrain contact, image sensors, or validated physics.';
plan.steps = plan.steps.map((step) => (step.action === 'drive_to' ? { ...step, speedMps: 1 } : step));
const run = runMission({
  mission,
  plan,
  planner: { kind: 'baseline' },
  runId: `example-${mode}`,
  robotId: 'rover-1',
  startedAt,
  seed: 42,
});
const bytes = await encodeRunMcap(run);
const inspection = await inspectRunMcap(bytes);
await writeFile(output, bytes);
console.log(
  JSON.stringify(
    {
      output,
      bytes: bytes.byteLength,
      body: mission.body,
      sourceId: mission.source.sourceId,
      frames: run.frames.length,
      messages: inspection.messages.length,
      result: run.result,
    },
    null,
    2,
  ),
);
