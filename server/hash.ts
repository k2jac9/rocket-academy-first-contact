import { createHash } from 'node:crypto';

/** Stable key ordering makes retries independent of JSON property order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Cannot hash a non-JSON value');
  return result;
}
export function jsonHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
export function bytesHash(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
