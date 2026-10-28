/** Event-level membership applied to every session; both roles may coexist. */
export type Role = 'hosting' | 'attending';
/** Local token presence, not a guarantee of continued server authorization. */
export type SessionState = 'signed-out' | 'authenticated';

/**
 * Runtime developer-account input, never persisted or retained for automatic login.
 * The UI clears its fields; the client does not mutate the caller's object.
 */
export interface DeveloperCredentials {
  username: string;
  password: string;
  /** API key ID used for login, not the private key. */
  apiKeyId: string;
}

/** A convention discovered through owned eligible badges or account-hosted events. */
export interface ConventionChoice {
  /** Exact, case-sensitive API identity. */
  id: string;
  name: string;
}

/** A verified, non-cart badge owned by the signed-in account. */
export interface BadgeChoice {
  id: string;
  conventionId: string;
  /** Minimized selection text held only in page memory. */
  label: string;
}

/** One convention and the explicitly chosen owned badges whose tickets to include. */
export interface ScheduleSelection {
  conventionId: string;
  /** Empty means hosting only; the client copies, deduplicates, and sorts IDs. */
  badgeIds: readonly string[];
}

/**
 * One first or additional session, with validated identity and minimized display data.
 * Unknown optional data is null; inactive or unscheduled memberships are not dropped.
 */
export interface AgendaRow {
  /** Composite convention ID, object type, and ID; IDs alone can collide across types. */
  key: string;
  id: string;
  /** The Event holds the first session; EventSession holds a later one. */
  objectType: 'event' | 'eventsession';
  conventionId: string;
  /** The Event ID, including for the first session where this equals `id`. */
  parentEventId: string;
  /** Parent Event name shared by its sessions. */
  name: string;
  eventNumber: string | null;
  sessionName: string | null;
  /** Validated ISO UTC instant ending in Z, or null for missing/zero API dates. */
  startUtc: string | null;
  /** Start plus duration in minutes, not the API's optionally buffered end date. */
  endUtc: string | null;
  /** Null means unknown; zero is a valid duration. */
  durationMinutes: number | null;
  roomName: string | null;
  spaceName: string | null;
  /** Inherited from the parent Event, including for additional sessions. */
  cancelled: boolean;
  /** Parent trash state, retained for display rather than filtering membership. */
  trashed: boolean;
  isScheduled: boolean;
  publishedToSchedule: boolean;
  /** Event-level roles merged from hosting and selected-badge confirmed tickets. */
  roles: readonly Role[];
}

/**
 * Fully staged result of one refresh, not an atomic server transaction.
 * The UI may retain this exact result and timestamp as stale for the same selection.
 */
export interface ScheduleSnapshot {
  /** Canonical selection used for this refresh, not a reference to caller input. */
  selection: ScheduleSelection;
  convention: ConventionChoice;
  /** Validated convention geolocation zone for grouping/formatting, not device time. */
  timeZone: string;
  /** Successful client completion time as ISO UTC, not the source's update time. */
  refreshedAt: string;
  rows: readonly AgendaRow[];
}

/** Safe local failure categories; `network` also covers indistinguishable CORS failures. */
export type ApiErrorCode =
  | 'not-authenticated' | 'session-expired' | 'sign-in-failed'
  | 'access-denied' | 'network' | 'timeout' | 'rate-limited'
  | 'service-unavailable' | 'invalid-response' | 'incomplete-refresh'
  | 'invalid-selection' | 'aborted' | 'busy';

/** Cancellation shared by every queued/in-flight request in a high-level operation. */
export interface RequestOptions {
  signal?: AbortSignal;
}

/** Server-revocation evidence after local authentication has already been cleared. */
export interface LogoutResult {
  /** Unconfirmed includes offline/failure; not-needed means no local token was known. */
  revocation: 'confirmed' | 'unconfirmed' | 'not-needed';
}
