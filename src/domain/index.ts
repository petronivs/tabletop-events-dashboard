export type Role = 'hosting' | 'attending';
export type SessionState = 'signed-out' | 'authenticated';

export interface DeveloperCredentials {
  username: string;
  password: string;
  apiKeyId: string;
}

export interface ConventionChoice {
  id: string;
  name: string;
}

export interface BadgeChoice {
  id: string;
  conventionId: string;
  label: string;
}

export interface ScheduleSelection {
  conventionId: string;
  badgeIds: readonly string[];
}

export interface AgendaRow {
  key: string;
  id: string;
  objectType: 'event' | 'eventsession';
  conventionId: string;
  parentEventId: string;
  name: string;
  eventNumber: string | null;
  sessionName: string | null;
  startUtc: string | null;
  endUtc: string | null;
  durationMinutes: number | null;
  roomName: string | null;
  spaceName: string | null;
  cancelled: boolean;
  trashed: boolean;
  isScheduled: boolean;
  publishedToSchedule: boolean;
  roles: readonly Role[];
}

export interface ScheduleSnapshot {
  selection: ScheduleSelection;
  convention: ConventionChoice;
  timeZone: string;
  refreshedAt: string;
  rows: readonly AgendaRow[];
}

export type ApiErrorCode =
  | 'not-authenticated' | 'session-expired' | 'sign-in-failed'
  | 'access-denied' | 'network' | 'timeout' | 'rate-limited'
  | 'service-unavailable' | 'invalid-response' | 'incomplete-refresh'
  | 'invalid-selection' | 'aborted' | 'busy';

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface LogoutResult {
  revocation: 'confirmed' | 'unconfirmed' | 'not-needed';
}
