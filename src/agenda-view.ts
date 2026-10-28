import type { AgendaRow, Role } from './domain';

/** Local presentation filters; applying them does not fetch or change membership. */
export interface AgendaFilters {
  /** Convention-local day key from {@link dayKey}, `unknown`, or `all`. */
  date: string;
  role: 'all' | Role;
  search: string;
}

/**
 * Groups a validated UTC instant by convention-local calendar date (YYYY-MM-DD).
 * Null produces `unknown`. Expects a validated zone; Intl errors are not hidden
 * by falling back to the device timezone.
 */
export function dayKey(utc: string | null, timeZone: string): string {
  if (!utc) return 'unknown';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(utc));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Formats a convention-zone day in en-US, or the unscheduled label for null. */
export function dayLabel(utc: string | null, timeZone: string): string {
  return utc ? new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(utc)) : 'Time not scheduled';
}

/** Formats a validated UTC instant as en-US convention-zone time, including DST. */
export function clock(utc: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit',
  }).format(new Date(utc));
}

/** Labels the original completion timestamp in convention time with seconds and zone. */
export function refreshedLabel(utc: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  }).format(new Date(utc));
}

/**
 * Filters by convention-local start day, membership role, and case-insensitive
 * display-text search, then sorts a new array without changing the source rows.
 *
 * @returns Rows ordered by UTC start, unknown starts last, then name and key.
 * Inactive/unpublished rows remain eligible; no status filter is applied.
 */
export function filterRows(
  rows: readonly AgendaRow[], timeZone: string, filters: AgendaFilters,
): AgendaRow[] {
  const query = filters.search.trim().toLocaleLowerCase();
  return rows.filter((row) =>
    (filters.date === 'all' || dayKey(row.startUtc, timeZone) === filters.date)
    && (filters.role === 'all' || row.roles.includes(filters.role))
    && (!query || [row.name, row.sessionName, row.eventNumber, row.roomName, row.spaceName]
      .filter(Boolean).join(' ').toLocaleLowerCase().includes(query)),
  ).sort((a, b) => {
    if (a.startUtc !== b.startUtc) {
      if (!a.startUtc) return 1;
      if (!b.startUtc) return -1;
      return a.startUtc.localeCompare(b.startUtc);
    }
    return a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  });
}
