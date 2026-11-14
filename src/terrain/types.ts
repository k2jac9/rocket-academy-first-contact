import type { MarkerKind, SceneMode, TerrainLayer, TerrainPoint } from '../domain/mission';
import type { TerrainPatch } from '../simulation/episode';

export type { MarkerKind, SceneMode, TerrainLayer, TerrainPoint } from '../domain/mission';

export type TerrainStatus = {
  state: 'loading' | 'ready' | 'error' | 'token-required';
  message: string;
  /** Number of terrain models currently resident; this is not a progress percentage. */
  loadedTiles: number;
};

export type TerrainSceneProps = {
  mode: SceneMode;
  layer: TerrainLayer;
  ionToken: string;
  placementMode: MarkerKind | null;
  rover: TerrainPoint | null;
  goal: TerrainPoint | null;
  onPlace: (kind: MarkerKind, point: TerrainPoint) => void;
  onStatus: (status: TerrainStatus) => void;
  onOpenSite?: (site: SceneMode) => void;
  onSiteReady?: (points: { rover: TerrainPoint; goal: TerrainPoint }) => void;
  resetViewSignal: number;
  robotPosition?: TerrainPoint | null;
  trajectory?: TerrainPoint[];
  focusMissionSignal?: number;
  capturePatchSignal?: number;
  onPatch?: (patch: TerrainPatch | null, error?: string) => void;
  navigationMode?: 'map' | 'orbit';
  cameraAction?: { sequence: number; kind: 'in' | 'out' | 'north' | 'top' };
};
