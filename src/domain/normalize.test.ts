import { describe, expect, it } from 'vitest';
import { agendaRow } from './normalize';
import { flag, identity, integer, InvalidData, timeZone, utcDate } from './validation';

const parent = {
  id: 'Event', convention_id: 'Convention', name: 'Synthetic event',
  is_cancelled: '1', trashed: '1', is_scheduled: '0', published_to_schedule: '0',
};

describe('schedule normalization', () => {
  it('keeps unscheduled, unpublished, trashed and cancelled membership without invented times', () => {
    expect(agendaRow(parent, parent, 'Convention', ['hosting'], 'event')).toMatchObject({
      key: 'Convention:event:Event', parentEventId: 'Event', name: 'Synthetic event',
      cancelled: true, trashed: true, isScheduled: false, publishedToSchedule: false,
      startUtc: null, endUtc: null, durationMinutes: null, eventNumber: null,
      roomName: null, spaceName: null, sessionName: null,
    });
  });

  it('keeps parent and additional sessions distinct, inherits cancellation, and computes full slot duration', () => {
    const source = {
      id: 'Event', event_id: 'Event', convention_id: 'Convention', object_type: 'eventsession',
      session_name: 'Second session', start_date: '2026-03-08 06:30:00',
      duration: '120', is_scheduled: '1', published_to_schedule: 1,
      end_date: '2026-03-08 08:20:00',
    };
    const row = agendaRow(source, parent, 'Convention', ['hosting', 'attending'], 'eventsession');
    expect(row).toMatchObject({
      key: 'Convention:eventsession:Event', name: 'Synthetic event',
      sessionName: 'Second session', cancelled: true, trashed: true,
      startUtc: '2026-03-08T06:30:00.000Z', endUtc: '2026-03-08T08:30:00.000Z',
      durationMinutes: 120, roles: ['hosting', 'attending'],
    });
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone('America/New_York'), hour: 'numeric', minute: '2-digit', hour12: false,
    });
    expect(formatter.format(new Date(row.startUtc ?? ''))).toBe('01:30');
    expect(formatter.format(new Date(row.endUtc ?? ''))).toBe('04:30');
  });

  it('rejects broken session associations instead of showing unrelated rows', () => {
    expect(() => agendaRow(
      { ...parent, event_id: 'foreign' }, parent, 'Convention', ['attending'], 'eventsession',
    )).toThrow(InvalidData);
  });

  it('does not turn a missing duration into an end time', () => {
    const row = agendaRow(
      { ...parent, start_date: '2026-11-01 05:30:00' }, parent, 'Convention', ['hosting'], 'event',
    );
    expect(row.startUtc).toBe('2026-11-01T05:30:00.000Z');
    expect(row.endUtc).toBeNull();
  });
});

describe('wire field guards', () => {
  it.each([
    '2026-02-29 12:00:00', '2024-02-30 12:00:00', '2026-04-31 00:00:00',
    '2026-01-01 24:00:00', '2026-00-01 00:00:00', '0000-01-01 00:00:00',
    '2026-01-01T00:00:00Z', '2026-01-01 00:00:60', '2026-01-01',
  ])('rejects invalid or ambiguous UTC date %s', (value) => {
    expect(() => utcDate(value)).toThrow(InvalidData);
  });

  it('parses documented UTC independently of device zone, including leap dates and small years', () => {
    expect(utcDate('2024-02-29 23:59:59')).toBe('2024-02-29T23:59:59.000Z');
    expect(utcDate('0099-01-01 00:00:00')).toBe('0099-01-01T00:00:00.000Z');
    expect(utcDate('0000-00-00 00:00:00')).toBeNull();
    expect(utcDate(undefined)).toBeNull();
  });

  it('requires a valid convention zone rather than the device zone', () => {
    expect(timeZone('America/Chicago')).toBe('America/Chicago');
    for (const zone of [undefined, '', 'Mars/Olympus', '+01:00']) {
      expect(() => timeZone(zone)).toThrow(InvalidData);
    }
  });

  it('accepts Intl-supported named IANA aliases containing digits', () => {
    for (const zone of ['EST5EDT', 'GMT0']) {
      expect(timeZone(zone)).toBe(zone);
    }
  });

  it('rejects numeric UTC offsets rather than treating them as convention zones', () => {
    for (const zone of ['+01:00', '-08:00', '+0100', '-0800', '+01', '-08']) {
      expect(() => timeZone(zone)).toThrow(InvalidData);
    }
  });

  it('coerces only strict numeric fields and preserves case-sensitive identities', () => {
    expect(flag('0')).toBe(false);
    expect(flag('1')).toBe(true);
    expect(integer('100')).toBe(100);
    expect(identity('MiXeD')).toBe('MiXeD');
    for (const value of [true, '', ' 1', '1e2', '1.0', -1, Infinity]) {
      expect(() => integer(value)).toThrow(InvalidData);
    }
    expect(() => flag(2)).toThrow(InvalidData);
    expect(() => identity('..')).toThrow(InvalidData);
  });
});
