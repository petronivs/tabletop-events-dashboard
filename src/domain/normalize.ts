import type { AgendaRow, Role } from './index';
import {
  flag, identity, integer, InvalidData, objectType, optionalText, text, utcDate,
  type RecordData,
} from './validation';

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
    key: `${conventionId}:${kind}:${id}`,
    id,
    objectType: kind,
    conventionId,
    parentEventId: parentId,
    name: text(parent.name),
    eventNumber,
    sessionName: optionalText(source.session_name),
    startUtc,
    endUtc,
    durationMinutes,
    roomName: optionalText(source.room_name),
    spaceName: optionalText(source.space_name),
    cancelled: flag(parent.is_cancelled),
    trashed: flag(parent.trashed),
    isScheduled: flag(source.is_scheduled),
    publishedToSchedule: flag(source.published_to_schedule),
    roles: [...roles],
  };
}
