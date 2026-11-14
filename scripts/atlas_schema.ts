import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { readConfig } from '../server/config.ts';
import { ATLAS_CLIENT_OPTIONS } from '../server/atlasConnection.ts';
import { jsonHash } from '../server/hash.ts';
import { STORAGE_SCHEMA_HASH } from '../server/storageSchemas.ts';
import {
  applyValidation,
  auditStorage,
  captureSnapshot,
  check,
  ValidationCheckError,
} from '../server/storageValidation.ts';
import type { Snapshot } from '../server/storageValidation.ts';

const config = readConfig({
    ...process.env,
    MONGODB_URI: process.env.MONGODB_MIGRATION_URI ?? process.env.MONGODB_URI,
  }),
  client = new MongoClient(config.mongodbUri, ATLAS_CLIENT_OPTIONS);
try {
  const [command = 'audit', snapshotArg, ...extra] = process.argv.slice(2);
  check(
    ['audit', 'warn', 'enforce', 'rollback'].includes(command) && extra.length === 0,
    'Use audit, or warn/enforce/rollback with a snapshot path.',
  );
  check(
    command === 'audit' ? !snapshotArg : Boolean(snapshotArg),
    'Mutations require a snapshot path; audit takes no path.',
  );
  await client.connect();
  const db = client.db(config.mongodbDb);
  const target = jsonHash({
    hosts: client.options.srvHost ?? client.options.hosts.map((host) => host.toString()).sort(),
    database: config.mongodbDb,
  });
  if (command !== 'audit') {
    const path = resolve(snapshotArg!);
    let snapshot: Snapshot;
    try {
      snapshot = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (command !== 'warn' || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      snapshot = await captureSnapshot(db, target);
      check(
        (await auditStorage(db)).every((row) => row.invalid === 0),
        'Audit found incompatible records; no settings were changed.',
      );
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
    }
    await applyValidation(db, snapshot, target, command as 'warn' | 'enforce' | 'rollback');
  }
  const audit = await auditStorage(db);
  console.log(
    JSON.stringify(
      { ok: audit.every((row) => row.invalid === 0), command, schemaHash: STORAGE_SCHEMA_HASH, audit },
      null,
      2,
    ),
  );
  if (audit.some((row) => row.invalid)) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      message:
        error instanceof ValidationCheckError
          ? error.message
          : (error as { code?: number })?.code === 13
            ? 'Atlas denied the schema operation. Use a separate migration credential with collMod on this database; keep the app credential readWrite. Retain the snapshot for partial-rollout recovery.'
            : 'Schema operation failed. No document bodies, credentials or raw database errors are logged. Retain the snapshot to inspect or recover a partial rollout.',
      code:
        typeof (error as { code?: unknown })?.code === 'number'
          ? (error as { code: number }).code
          : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
