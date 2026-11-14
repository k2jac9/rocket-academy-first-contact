import { describe, expect, it, vi } from 'vitest';
import type { Db } from 'mongodb';
import {
  applyValidation,
  captureSnapshot,
  desired,
  schemaNames,
  validateSnapshot,
} from './storageValidation.ts';
import type { Settings } from './storageValidation.ts';

function fixture() {
  const initial: Settings = { validator: {}, validationLevel: 'strict', validationAction: 'error' };
  const state = new Map(
    schemaNames.map((name) => [
      name,
      { uuid: 'a'.repeat(32), settings: structuredClone(initial), invalid: 0 },
    ]),
  );
  const command = vi.fn(async (request: Record<string, unknown>) => {
    const row = state.get(request.collMod as string)!;
    row.settings = {
      validator: request.validator as Settings['validator'],
      validationLevel: request.validationLevel as string,
      validationAction: request.validationAction as string,
    };
    return { ok: 1 };
  });
  const db = {
    listCollections: ({ name }: { name: string }) => ({
      next: async () => {
        const row = state.get(name);
        return row
          ? { name, type: 'collection', info: { uuid: { toString: () => row.uuid } }, options: row.settings }
          : null;
      },
    }),
    collection: (name: string) => ({
      aggregate: () => ({
        next: async () => ({
          total: [{ count: 1 }],
          invalid: [{ count: state.get(name)!.invalid }],
          invalidSamples: [],
          shapes: [],
        }),
      }),
    }),
    command,
  } as unknown as Db;
  return { db, state, command, initial };
}
describe('schema rollout safeguards', () => {
  it('requires warning mode before enforcement and rejects wrong targets without mutation', async () => {
    const { db, command } = fixture(),
      snapshot = await captureSnapshot(db, 'target');
    expect(() => validateSnapshot(snapshot, 'another-target')).toThrow(/target/);
    await expect(applyValidation(db, snapshot, 'target', 'enforce')).rejects.toThrow(/unexpected settings/);
    expect(command).not.toHaveBeenCalled();
  });
  it('preflights every collection before modifying any and preserves incompatible data', async () => {
    const { db, state, command } = fixture(),
      snapshot = await captureSnapshot(db, 'target');
    state.get(schemaNames.at(-1)!)!.invalid = 1;
    await expect(applyValidation(db, snapshot, 'target', 'warn')).rejects.toThrow(/Incompatible/);
    expect(command).not.toHaveBeenCalled();
  });
  it('resumes a partial rollout and restores the saved settings', async () => {
    const { db, state, command, initial } = fixture(),
      snapshot = await captureSnapshot(db, 'target');
    state.get(schemaNames[0])!.settings = desired(schemaNames[0], 'warn');
    await applyValidation(db, snapshot, 'target', 'warn');
    await applyValidation(db, snapshot, 'target', 'enforce');
    expect(
      [...state.values()].every(
        (row) =>
          row.settings.validationAction === 'error' && Object.keys(row.settings.validator).length === 1,
      ),
    ).toBe(true);
    await expect(applyValidation(db, snapshot, 'target', 'warn')).rejects.toThrow(/unexpected settings/);
    await applyValidation(db, snapshot, 'target', 'rollback');
    expect([...state.values()].every((row) => JSON.stringify(row.settings) === JSON.stringify(initial))).toBe(
      true,
    );
    expect(command).toHaveBeenCalledTimes(schemaNames.length * 3);
  });
  it.each(['replacement', 'foreign-validator'] as const)('refuses rollback over a %s', async (kind) => {
    const { db, state, command } = fixture(),
      snapshot = await captureSnapshot(db, 'target');
    await applyValidation(db, snapshot, 'target', 'warn');
    command.mockClear();
    const row = state.get(schemaNames.at(-1)!)!;
    if (kind === 'replacement') row.uuid = 'b'.repeat(32);
    else row.settings.validator = { other: { $exists: true } };
    await expect(applyValidation(db, snapshot, 'target', 'rollback')).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });
  it('requires complete snapshots with supported original settings', async () => {
    const { db } = fixture(),
      snapshot = await captureSnapshot(db, 'target');
    const missing = structuredClone(snapshot);
    delete missing.collections.missions;
    expect(() => validateSnapshot(missing, 'target')).toThrow(/exactly/);
    const edited = structuredClone(snapshot);
    edited.collections.missions.before.validator = { unexpected: true };
    expect(() => validateSnapshot(edited, 'target')).toThrow(/unsupported/);
  });
});
