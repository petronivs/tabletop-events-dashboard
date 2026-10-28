import { describe, expect, it } from 'vitest';
import { clock, dayKey, dayLabel, refreshedLabel } from './agenda-view';

describe('convention-zone presentation', () => {
  it('groups UTC rollover into the convention date instead of the device date', () => {
    expect(dayKey('2026-10-29T01:00:00Z', 'America/Los_Angeles')).toBe('2026-10-28');
    expect(dayLabel('2026-10-29T01:00:00Z', 'America/Los_Angeles')).toBe('Wednesday, October 28, 2026');
    expect(clock('2026-10-29T01:00:00Z', 'America/Los_Angeles')).toBe('6:00 PM');
    expect(dayKey(null, 'America/Los_Angeles')).toBe('unknown');
    expect(dayLabel(null, 'America/Los_Angeles')).toBe('Time not scheduled');
  });

  it('formats timestamps using the convention DST offset at that instant', () => {
    expect(refreshedLabel('2026-11-01T08:30:00Z', 'America/Los_Angeles')).toContain('1:30:00 AM PDT');
    expect(refreshedLabel('2026-11-01T09:30:00Z', 'America/Los_Angeles')).toContain('1:30:00 AM PST');
    expect(() => clock('2026-10-29T01:00:00Z', 'Not/A_Timezone')).toThrow();
  });
});
