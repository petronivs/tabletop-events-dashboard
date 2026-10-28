import type { AgendaRow, Role } from './index';
import {
  flag, identity, integer, InvalidData, objectType, optionalText, text, utcDate,
  type RecordData,
} from './validation';

/**
 * Combines parent identity/display state with per-session schedule fields.
 * Missing name/state fields stay undefined for the completeness check; malformed
 * supplied fields throw even if a later detail read could have replaced them.
 */
function agendaFields(source: RecordData, parent: RecordData) {
  if (parent.session_count !== undefined) integer(parent.session_count);
  const durationMinutes = source.duration === undefined || source.duration === null ||
    source.duration === '' ? null : integer(source.duration);
  const startUtc = utcDate(source.start_date);
  let endUtc: string | null = null;
  if (startUtc !== null && durationMinutes !== null) {
    const end = new Date(Date.parse(startUtc) + durationMinutes * 60_000);
    if (!Number.isFinite(end.getTime()) || end.getUTCFullYear() > 9999) throw new InvalidData();
    endUtc = end.toISOString();
  }
  let eventNumber: string | null = null;
  if (parent.event_number !== undefined && parent.event_number !== null && parent.event_number !== '') {
    eventNumber = typeof parent.event_number === 'number'
      ? String(integer(parent.event_number)) : optionalText(parent.event_number);
  }
  return {
    name: parent.name === undefined ? undefined : text(parent.name),
    eventNumber,
    sessionName: optionalText(source.session_name),
    startUtc,
    endUtc,
    durationMinutes,
    roomName: optionalText(source.room_name),
    spaceName: optionalText(source.space_name),
    cancelled: parent.is_cancelled === undefined ? undefined : flag(parent.is_cancelled),
    trashed: parent.trashed === undefined ? undefined : flag(parent.trashed),
    isScheduled: source.is_scheduled === undefined ? undefined : flag(source.is_scheduled),
    publishedToSchedule: source.published_to_schedule === undefined
      ? undefined : flag(source.published_to_schedule),
  };
}

/**
 * Checks whether a hosted Event can supply the first row without a detail read.
 *
 * @returns True when required name/status/time/duration fields are supplied.
 * Explicit null/empty time and duration count as supplied unknown values.
 * Optional display fields and session count are not required.
 * @throws {@link InvalidData} - Synchronously for malformed supplied agenda fields,
 * including a supplied session count; missing fields alone return false.
 */
export function hostedDetailsComplete(event: RecordData): boolean {
  // Validate supplied fields even when missing data requires a detail read.
  agendaFields(event, event);
  return [
    'name', 'is_cancelled', 'trashed', 'is_scheduled', 'published_to_schedule',
    'start_date', 'duration',
  ].every((field) => event[field] !== undefined);
}

/**
 * Validates and projects an Event's first session or an additional EventSession.
 *
 * @param source - Per-session fields; use the parent itself for the first session.
 * @param parent - Event supplying name, number, cancellation, and trash state.
 * @param conventionId - Exact identity that both records must match.
 * @param roles - Event-level membership copied onto this row.
 * @param kind - Expected source type; a supplied object type must agree.
 * @returns A distinct composite-keyed row with UTC times and full-slot end time,
 * without subtracting an API end buffer. Missing time/duration stays unknown.
 * @throws {@link InvalidData} - Synchronously for malformed fields, missing
 * required state, mismatched convention/parent links, or an unrepresentable end.
 */
export function agendaRow(
  source: RecordData,
  parent: RecordData,
  conventionId: string,
  roles: readonly Role[],
  kind: 'event' | 'eventsession',
): AgendaRow {
  objectType(source, kind);
  const id = identity(source.id);
  const parentId = identity(parent.id);
  if (identity(source.convention_id) !== conventionId ||
      identity(parent.convention_id) !== conventionId ||
      (kind === 'eventsession' && identity(source.event_id) !== parentId)) {
    throw new InvalidData();
  }
  const fields = agendaFields(source, parent);
  if (fields.name === undefined || fields.cancelled === undefined || fields.trashed === undefined ||
      fields.isScheduled === undefined || fields.publishedToSchedule === undefined) {
    throw new InvalidData();
  }
  return {
    ...fields,
    name: fields.name,
    cancelled: fields.cancelled,
    trashed: fields.trashed,
    isScheduled: fields.isScheduled,
    publishedToSchedule: fields.publishedToSchedule,
    key: `${conventionId}:${kind}:${id}`,
    id,
    objectType: kind,
    conventionId,
    parentEventId: parentId,
    roles: [...roles],
  };
}
