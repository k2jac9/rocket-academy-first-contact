import type { MissionManifest } from '../domain/mission.ts';
import type { MissionPlan, MissionRun, PlannerProvenance } from '../simulation/missionRun.ts';

export interface ServiceStatus {
  service: string;
  version: string;
  atlas: { configured: boolean; connected: boolean };
  planner: { configured: boolean; provider: 'gemini'; model: string };
}

export interface RunSummary {
  id: string;
  body: string;
  missionName: string;
  startedAt: string;
  durationS: number;
  result: MissionRun['result'];
  planner: PlannerProvenance;
  artifact: { id: string; sha256: string; bytes: number; storage: 'gridfs' };
  downloadUrl: string;
}

export interface SavedRun {
  id: string;
  run: MissionRun;
  missionId: string;
  planId: string;
  artifact: RunSummary['artifact'];
  downloadUrl: string;
  storage: 'atlas';
}

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(45_000);
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? data.error : null;
    const message =
      error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : `The local service returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (!data || typeof data !== 'object') throw new Error('The local service returned an invalid response.');
  return data as T;
}

export const missionApi = {
  status: (signal?: AbortSignal) => request<ServiceStatus>('/status', {}, signal),
  plan: (mission: MissionManifest, objective: string, signal?: AbortSignal) =>
    request<{ plan: MissionPlan; planner: PlannerProvenance; providerMetadata: unknown }>(
      '/plans',
      {
        method: 'POST',
        body: JSON.stringify({ mission, objective }),
      },
      signal,
    ),
  saveMission: (mission: MissionManifest, idempotencyKey: string, signal?: AbortSignal) =>
    request<{ id: string; storage: 'atlas' }>(
      '/missions',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ mission }),
      },
      signal,
    ),
  runAndSave: (
    mission: MissionManifest,
    plan: MissionPlan,
    planner: PlannerProvenance,
    seed: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ) =>
    request<SavedRun>(
      '/runs',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ mission, plan, planner, seed }),
      },
      signal,
    ),
  runs: (body: string, signal?: AbortSignal) =>
    request<{ runs: RunSummary[] }>(`/runs?body=${encodeURIComponent(body)}`, {}, signal),
};
