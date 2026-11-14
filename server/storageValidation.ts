import type { Db, Document } from 'mongodb';
import { STORAGE_SCHEMAS, STORAGE_SCHEMA_HASH } from './storageSchemas.ts';
import { jsonHash } from './hash.ts';

export class ValidationCheckError extends Error {}
export function check(value: unknown, message: string): asserts value {
  if (!value) throw new ValidationCheckError(message);
}
export const schemaNames = Object.keys(STORAGE_SCHEMAS);
export type Settings = { validator: Document; validationLevel: string; validationAction: string };
export type Snapshot = {
  version: 1;
  target: string;
  schemaHash: string;
  createdAt: string;
  collections: Record<string, { uuid: string; before: Settings }>;
};
const same = (a: unknown, b: unknown) => jsonHash(a) === jsonHash(b);
export const desired = (name: string, action: 'warn' | 'error'): Settings => ({
  validator: { $jsonSchema: STORAGE_SCHEMAS[name] },
  validationLevel: 'strict',
  validationAction: action,
});
export async function collectionSettings(db: Db, name: string) {
  const info = await db.listCollections({ name }, { maxTimeMS: 5000, nameOnly: false }).next();
  check(info?.type === 'collection', `Required collection ${name} is missing or is not a collection.`);
  const options = info.options ?? {};
  return {
    uuid: info.info?.uuid?.toString('hex') ?? '',
    settings: {
      validator: options.validator ?? {},
      validationLevel: options.validationLevel ?? 'strict',
      validationAction: options.validationAction ?? 'error',
    } as Settings,
  };
}
export async function auditStorage(db: Db, namespace = (name: string) => name) {
  const rows = [];
  for (const name of schemaNames) {
    const collection = db.collection(namespace(name));
    const state = await collectionSettings(db, namespace(name));
    const counts = await collection
      .aggregate(
        [
          {
            $facet: {
              total: [{ $count: 'count' }],
              invalid: [{ $match: { $nor: [{ $jsonSchema: STORAGE_SCHEMAS[name] }] } }, { $count: 'count' }],
              invalidSamples: [
                { $match: { $nor: [{ $jsonSchema: STORAGE_SCHEMAS[name] }] } },
                { $project: { _id: 1 } },
                { $limit: 20 },
              ],
              shapes: [
                {
                  $group: {
                    _id: {
                      storageVersion: { $ifNull: ['$storageSchemaVersion', 'legacy-unversioned'] },
                      state: { $ifNull: ['$state', 'not-applicable'] },
                      payloadVersion: {
                        $ifNull: [
                          '$record.schemaVersion',
                          {
                            $ifNull: [
                              '$mission.schemaVersion',
                              {
                                $ifNull: [
                                  '$run.schemaVersion',
                                  { $ifNull: ['$plan.schemaVersion', 'not-declared'] },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    },
                    count: { $sum: 1 },
                  },
                },
              ],
            },
          },
        ],
        { maxTimeMS: 10000, allowDiskUse: false, signal: AbortSignal.timeout(15000) },
      )
      .next();
    rows.push({
      name,
      total: counts?.total[0]?.count ?? 0,
      invalid: counts?.invalid[0]?.count ?? 0,
      invalidIds: counts?.invalidSamples.map((d: Document) => String(d._id)) ?? [],
      shapes: counts?.shapes ?? [],
      action: state.settings.validationAction,
      level: state.settings.validationLevel,
      managed: same(state.settings.validator, desired(name, 'warn').validator),
      hasValidator: Object.keys(state.settings.validator).length > 0,
    });
  }
  return rows;
}
export async function captureSnapshot(
  db: Db,
  target: string,
  namespace = (name: string) => name,
): Promise<Snapshot> {
  const collections: Snapshot['collections'] = {};
  for (const name of schemaNames) {
    const { uuid, settings } = await collectionSettings(db, namespace(name));
    check(uuid, `Collection identity unavailable for ${name}.`);
    check(
      Object.keys(settings.validator).length === 0,
      `Collection ${name} already has a validator. Review it before starting another rollout.`,
    );
    collections[name] = { uuid, before: settings };
  }
  return {
    version: 1,
    target,
    schemaHash: STORAGE_SCHEMA_HASH,
    createdAt: new Date().toISOString(),
    collections,
  };
}
export function validateSnapshot(snapshot: Snapshot, target: string) {
  check(
    snapshot?.version === 1 && snapshot.target === target && snapshot.schemaHash === STORAGE_SCHEMA_HASH,
    'Snapshot target or schema revision does not match this rollout.',
  );
  check(
    same(Object.keys(snapshot.collections ?? {}).sort(), [...schemaNames].sort()),
    'Snapshot must cover exactly the managed collections.',
  );
  for (const row of Object.values(snapshot.collections)) {
    check(
      typeof row.uuid === 'string' && /^[a-f0-9]{32}$/.test(row.uuid),
      'Snapshot collection identity is invalid.',
    );
    check(
      row.before &&
        Object.keys(row.before.validator).length === 0 &&
        ['strict', 'moderate', 'off'].includes(row.before.validationLevel) &&
        ['error', 'warn'].includes(row.before.validationAction),
      'Snapshot original settings are unsupported.',
    );
  }
}
export async function applyValidation(
  db: Db,
  snapshot: Snapshot,
  target: string,
  mode: 'warn' | 'enforce' | 'rollback',
  namespace = (name: string) => name,
) {
  validateSnapshot(snapshot, target);
  // Preflight every collection before making the first change. collMod is not a cross-collection transaction.
  for (const name of schemaNames) {
    const current = await collectionSettings(db, namespace(name)),
      saved = snapshot.collections[name];
    check(current.uuid === saved.uuid, `Collection ${name} was replaced; automatic changes are refused.`);
    const permitted =
      mode === 'enforce'
        ? same(current.settings, desired(name, 'warn')) || same(current.settings, desired(name, 'error'))
        : same(current.settings, saved.before) ||
          same(current.settings, desired(name, 'warn')) ||
          (mode === 'rollback' && same(current.settings, desired(name, 'error')));
    check(permitted, `Collection ${name} has unexpected settings; review changes before resuming.`);
  }
  if (mode !== 'rollback')
    check(
      (await auditStorage(db, namespace)).every((row) => row.invalid === 0),
      'Incompatible stored records block rollout. Preserve and review the audit exceptions.',
    );
  for (const name of schemaNames) {
    const settings =
      mode === 'rollback'
        ? snapshot.collections[name].before
        : desired(name, mode === 'warn' ? 'warn' : 'error');
    await db.command(
      { collMod: namespace(name), ...settings, maxTimeMS: 10000 },
      { signal: AbortSignal.timeout(15000) },
    );
  }
  if (mode !== 'rollback')
    check(
      (await auditStorage(db, namespace)).every((row) => row.invalid === 0),
      'A concurrent incompatible write was found. Preserve it for review; use the snapshot for rollback if needed.',
    );
}
