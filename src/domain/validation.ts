export class InvalidData extends Error {
  constructor() {
    super('Invalid response data.');
  }
}

export type RecordData = Record<string, unknown>;

function isRecord(value: unknown): value is RecordData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function record(value: unknown): RecordData {
  if (!isRecord(value)) throw new InvalidData();
  return value;
}

export function text(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new InvalidData();
  return value;
}

export function identity(value: unknown): string {
  const result = text(value);
  if (result !== result.trim() || result === '.' || result === '..' ||
      /[\s\p{Cc}]/u.test(result)) throw new InvalidData();
  return result;
}

export function integer(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/u.test(value))) {
    throw new InvalidData();
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new InvalidData();
  return result;
}

export function flag(value: unknown): boolean {
  const result = integer(value);
  if (result !== 0 && result !== 1) throw new InvalidData();
  return result === 1;
}

export function optionalText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value);
}

export function optionalIdentity(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return identity(value);
}

export function objectType(value: RecordData, expected: string): void {
  if (value.object_type !== undefined && value.object_type !== expected) throw new InvalidData();
}

export function utcDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '' ||
      value === '0000-00-00 00:00:00') return null;
  if (typeof value !== 'string') throw new InvalidData();
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u.exec(value);
  if (!match) throw new InvalidData();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12 || day < 1 ||
      hour > 23 || minute > 59 || second > 59) throw new InvalidData();
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) throw new InvalidData();
  return date.toISOString();
}

export function timeZone(value: unknown): string {
  const zone = text(value);
  if (!/^[A-Za-z_][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)*$/u.test(zone)) throw new InvalidData();
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(0);
  } catch {
    throw new InvalidData();
  }
  return zone;
}
