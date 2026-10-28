import type { AgendaRow, Role } from './index';
import {
  flag, identity, integer, InvalidData, objectType, optionalText, text, utcDate,
  type RecordData,
} from './validation';

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

export function hostedDetailsComplete(event: RecordData): boolean {
  // Validate supplied fields even when missing data requires a detail read.
  agendaFields(event, event);
  return [
    'name', 'is_cancelled', 'trashed', 'is_scheduled', 'published_to_schedule',
    'start_date', 'duration',
  ].every((field) => event[field] !== undefined);
}

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
