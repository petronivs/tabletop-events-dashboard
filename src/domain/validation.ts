/** Internal schema failure mapped to a safe client error rather than raw upstream data. */
export class InvalidData extends Error {
  constructor() {
    super('Invalid response data.');
  }
}

/** Untrusted object fields that still require individual validation. */
export type RecordData = Record<string, unknown>;

function isRecord(value: unknown): value is RecordData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Requires a non-null, non-array object; throws {@link InvalidData} synchronously. */
export function record(value: unknown): RecordData {
  if (!isRecord(value)) throw new InvalidData();
  return value;
}

/** Requires nonblank text without trimming the returned value; throws {@link InvalidData}. */
export function text(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new InvalidData();
  return value;
}

/**
 * Preserves an exact, case-sensitive ID while rejecting whitespace, control
 * characters, and dot path segments. Throws {@link InvalidData} synchronously;
 * it does not enforce a GUID shape or URL-encode the result.
 */
export function identity(value: unknown): string {
  const result = text(value);
  if (result !== result.trim() || result === '.' || result === '..' ||
      /[\s\p{Cc}]/u.test(result)) throw new InvalidData();
  return result;
}

/**
 * Accepts nonnegative safe integers as numbers or digit-only strings.
 * Throws {@link InvalidData} for coercions such as booleans, blanks, fractions,
 * signs, whitespace, or exponent notation in strings.
 */
export function integer(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/u.test(value))) {
    throw new InvalidData();
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new InvalidData();
  return result;
}

/** Converts only numeric/string 0 or 1 to a boolean; otherwise throws {@link InvalidData}. */
export function flag(value: unknown): boolean {
  const result = integer(value);
  if (result !== 0 && result !== 1) throw new InvalidData();
  return result === 1;
}

/** Maps undefined, null, or empty string to null; otherwise validates with {@link text}. */
export function optionalText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value);
}

/** Maps absent/empty links to null; nonempty values must pass {@link identity}. */
export function optionalIdentity(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return identity(value);
}

/** Allows an omitted object type, but throws {@link InvalidData} for a supplied mismatch. */
export function objectType(value: RecordData, expected: string): void {
  if (value.object_type !== undefined && value.object_type !== expected) throw new InvalidData();
}

/**
 * Parses the API's `YYYY-MM-DD HH:MM:SS` explicitly as UTC, never device-local time.
 *
 * @returns ISO UTC with Z, or null for undefined, null, empty string, or the API's
 * `0000-00-00 00:00:00` sentinel.
 * @throws {@link InvalidData} - Synchronously for other formats, invalid components,
 * year zero, or calendar rollover (such as February 30).
 */
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

/**
 * Validates a named convention zone, including Intl-supported IANA aliases.
 *
 * @returns The original zone string; no canonicalization or device-zone fallback.
 * @throws {@link InvalidData} - Synchronously for missing/unsupported names or
 * numeric UTC-offset strings, even if the runtime could otherwise format them.
 */
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
