import type { TerrainSource } from '../domain/mission';
import { PHYSICS_ROBOTS, LEGACY_PHYSICS_ROBOTS } from './episode';
import type { EpisodeMetadata, PhysicsModelId } from './episode';

const worlds = { earth: 'Earth', moon: 'the Moon', mars: 'Mars' };
export function missionNarration(
  source: TerrainSource,
  models: readonly PhysicsModelId[],
  durationS: number,
): string {
  const names = models.map(
    (id) => [...PHYSICS_ROBOTS, ...LEGACY_PHYSICS_ROBOTS].find((r) => r.id === id)?.label ?? id,
  );
  return (
    `Welcome to First Contact. Our destination is ${source.label} on ${worlds[source.body]}. ` +
    `Your team is ${names.join(' and ')}. Prepare a measured terrain patch for a ${durationS}-second shared simulation. ` +
    'The episode will record robot states, sampled actions, and virtual camera observations for replay and inspection. This is an experimental simulation.'
  );
}
export function replayNarration(episode: EpisodeMetadata): string {
  const ending =
    episode.termination === 'duration_reached'
      ? 'The configured recording duration was reached.'
      : `The recorded termination was ${episode.termination.replaceAll('_', ' ')}.`;
  return (
    `Mission replay from ${episode.input.terrain.source.label} on ${worlds[episode.input.terrain.source.body]}. ` +
    `${episode.robotModels.map((robot) => robot.label).join(' and ')} shared one simulated world for ${episode.durationS.toFixed(1)} seconds. ` +
    `${ending} The recording contains ${episode.frames.length} state frames and ${episode.sensorSamples} RGB and depth pairs. ` +
    'This summary describes a recorded experiment; it does not establish mission success or real-world robot performance.'
  );
}
