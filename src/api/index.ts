import type {
  BadgeChoice, ConventionChoice, DeveloperCredentials, LogoutResult, RequestOptions,
  Role, ScheduleSelection, ScheduleSnapshot, SessionState,
} from '../domain';
import { agendaRow } from '../domain/normalize';
import {
  flag, identity, integer, InvalidData, objectType, optionalIdentity, optionalText,
  record, text, timeZone, type RecordData,
} from '../domain/validation';
import { ApiError } from './errors';
import { collection } from './pagination';
import { checkOperation, Transport, type Operation } from './transport';

export { ApiError } from './errors';

export interface ScheduleClient {
  getSessionState(): SessionState;
  login(input: DeveloperCredentials, options?: RequestOptions): Promise<void>;
  listConventions(options?: RequestOptions): Promise<readonly ConventionChoice[]>;
  listBadges(conventionId: string, options?: RequestOptions): Promise<readonly BadgeChoice[]>;
  loadSchedule(selection: ScheduleSelection, options?: RequestOptions): Promise<ScheduleSnapshot>;
  logout(): Promise<LogoutResult>;
}

interface Session {
  token: string;
  userId: string;
}

interface Context extends Operation {
  controller: AbortController;
  generation: number;
  dispose(): void;
}

const ticketQualifiers = {
  verified: '1',
  collected: '',
  picked_up: '',
  for_reservation: '',
  generic: '',
  in_tournament: '',
  'event.is_cancelled': '',
  'event.is_scheduled': '',
};

function safeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof InvalidData) return new ApiError('invalid-response');
  return new ApiError('invalid-response');
}

function segment(id: string): string {
  return encodeURIComponent(identity(id));
}

function convention(raw: unknown, expected: string): ConventionChoice {
  const value = record(raw);
  objectType(value, 'convention');
  const id = identity(value.id);
  if (id !== expected) throw new InvalidData();
  return { id, name: text(value.name) };
}

function ownedBadges(
  items: readonly RecordData[], userId: string, conventionId?: string,
): BadgeChoice[] {
  const result: BadgeChoice[] = [];
  for (const badge of items) {
    objectType(badge, 'badge');
    const id = identity(badge.id);
    const owner = identity(badge.user_id);
    const cid = identity(badge.convention_id);
    const verified = flag(badge.verified);
    const cart = optionalIdentity(badge.conventioncart_id);
    if (owner !== userId) continue;
    if (conventionId !== undefined && cid !== conventionId) throw new InvalidData();
    if (!verified || cart !== null) continue;
    let number: string | null = null;
    if (badge.badge_number !== undefined && badge.badge_number !== null && badge.badge_number !== '') {
      number = String(integer(badge.badge_number));
    }
    const name = optionalText(badge.name_full);
    result.push({
      id, conventionId: cid,
      label: [number === null ? null : `Badge ${number}`, name].filter(
        (part): part is string => part !== null,
      ).join(' — ') || 'Owned badge',
    });
  }
  return result;
}

function hostedMembership(items: readonly RecordData[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const event of items) {
    objectType(event, 'event');
    result.set(identity(event.id), identity(event.convention_id));
  }
  return result;
}

function canonicalSelection(selection: ScheduleSelection): ScheduleSelection {
  try {
    const conventionId = identity(selection.conventionId);
    if (!Array.isArray(selection.badgeIds)) throw new InvalidData();
    const badgeIds = [...new Set(selection.badgeIds.map((id: unknown) => identity(id)))].sort();
    return { conventionId, badgeIds };
  } catch {
    throw new ApiError('invalid-selection');
  }
}

export function createScheduleClient(): ScheduleClient {
  const transport = new Transport();
  const contexts = new Set<Context>();
  let generation = 0;
  let session: Session | null = null;
  let activeRead: Context | null = null;

  function invalidate(code: 'aborted' | 'session-expired'): void {
    generation += 1;
    session = null;
    activeRead = null;
    for (const context of contexts) context.controller.abort(new ApiError(code));
  }

  function context(options?: RequestOptions): Context {
    const controller = new AbortController();
    const cancel = () => controller.abort(new ApiError('aborted'));
    options?.signal?.addEventListener('abort', cancel, { once: true });
    if (options?.signal?.aborted) cancel();
    const timer = setTimeout(
      () => controller.abort(new ApiError('incomplete-refresh')), 30 * 60_000,
    );
    const result: Context = {
      controller,
      signal: controller.signal,
      generation,
      requests: 0,
      expiresAt: Date.now() + 30 * 60_000,
      dispose() {
        clearTimeout(timer);
        options?.signal?.removeEventListener('abort', cancel);
        contexts.delete(result);
      },
    };
    contexts.add(result);
    return result;
  }

  function guard(operation: Context): void {
    checkOperation(operation);
    if (operation.generation !== generation) throw new ApiError('aborted');
  }

  async function request(
    operation: Context, path: string, method: 'GET' | 'POST' | 'DELETE',
    parameters: URLSearchParams,
  ): Promise<unknown> {
    guard(operation);
    const result = await transport.request(path, method, parameters, operation, () => {
      if (operation.generation === generation) invalidate('session-expired');
    });
    guard(operation);
    return result;
  }

  function read(
    operation: Context, account: Session, path: string, parameters: Record<string, string> = {},
  ): Promise<unknown> {
    return request(operation, path, 'GET', new URLSearchParams({
      ...parameters, session_id: account.token,
    }));
  }

  function list(
    operation: Context, account: Session, path: string, qualifiers: Record<string, string> = {},
  ): Promise<RecordData[]> {
    return collection((parameters) => read(operation, account, path, parameters), qualifiers);
  }

  async function runRead<T>(
    options: RequestOptions | undefined,
    work: (operation: Context, account: Session) => Promise<T>,
  ): Promise<T> {
    if (session === null) throw new ApiError('not-authenticated');
    if (activeRead !== null) throw new ApiError('busy');
    const account = session;
    const operation = context(options);
    activeRead = operation;
    try {
      guard(operation);
      const result = await work(operation, account);
      guard(operation);
      return result;
    } catch (error) {
      if (operation.signal.aborted) checkOperation(operation);
      throw safeError(error);
    } finally {
      if (activeRead === operation) activeRead = null;
      operation.dispose();
    }
  }

  const hostPath = (account: Session) => `/api/user/${segment(account.userId)}/events-hosted`;
  const badgesPath = (cid: string) => `/api/convention/${segment(cid)}/badges/my`;

  return {
    getSessionState() {
      return session === null ? 'signed-out' : 'authenticated';
    },

    async login(input, options) {
      invalidate('aborted');
      const operation = context(options);
      try {
        let parameters: URLSearchParams;
        try {
          parameters = new URLSearchParams({
            username: text(input.username),
            password: text(input.password),
            api_key_id: text(input.apiKeyId),
          });
        } catch {
          throw new ApiError('sign-in-failed');
        }
        const response = record(await request(operation, '/api/session', 'POST', parameters));
        if (response.object_type !== 'session') throw new InvalidData();
        const replacement = { token: identity(response.id), userId: identity(response.user_id) };
        guard(operation);
        session = replacement;
      } catch (error) {
        if (operation.signal.aborted) checkOperation(operation);
        throw safeError(error);
      } finally {
        operation.dispose();
      }
    },

    listConventions(options) {
      return runRead(options, async (operation, account) => {
        const badges = ownedBadges(await list(
          operation, account, `/api/user/${segment(account.userId)}/badges`, { verified: '1' },
        ), account.userId);
        const hosted = hostedMembership(await list(operation, account, hostPath(account)));
        const ids = [...new Set([...badges.map((badge) => badge.conventionId), ...hosted.values()])].sort();
        const choices: ConventionChoice[] = [];
        for (const id of ids) {
          choices.push(convention(await read(
            operation, account, `/api/convention/${segment(id)}`,
          ), id));
        }
        return choices;
      });
    },

    listBadges(conventionId, options) {
      return runRead(options, async (operation, account) => {
        let cid: string;
        try {
          cid = identity(conventionId);
        } catch {
          throw new ApiError('invalid-selection');
        }
        const badges = ownedBadges(await list(
          operation, account, badgesPath(cid), { verified: '1' },
        ), account.userId, cid);
        if (badges.length === 0) {
          const hosted = hostedMembership(await list(operation, account, hostPath(account)));
          if (![...hosted.values()].includes(cid)) throw new ApiError('invalid-selection');
        }
        return badges;
      });
    },

    loadSchedule(selection, options) {
      return runRead(options, async (operation, account) => {
        const selected = canonicalSelection(selection);
        const cid = selected.conventionId;
        const hosted = hostedMembership(await list(operation, account, hostPath(account)));
        const badges = ownedBadges(await list(
          operation, account, badgesPath(cid), { verified: '1' },
        ), account.userId, cid);
        const available = new Set(badges.map((badge) => badge.id));
        if (selected.badgeIds.some((id) => !available.has(id)) ||
            (badges.length === 0 && ![...hosted.values()].includes(cid))) {
          throw new ApiError('invalid-selection');
        }
        const roles = new Map<string, Set<Role>>();
        for (const [id, conventionId] of hosted) {
          if (conventionId === cid) roles.set(id, new Set<Role>(['hosting']));
        }
        for (const badgeId of selected.badgeIds) {
          const tickets = await list(
            operation, account, `/api/badge/${segment(badgeId)}/tickets`, ticketQualifiers,
          );
          for (const ticket of tickets) {
            objectType(ticket, 'ticket');
            if (identity(ticket.badge_id) !== badgeId || identity(ticket.convention_id) !== cid) {
              throw new InvalidData();
            }
            const verified = flag(ticket.verified);
            const cart = optionalIdentity(ticket.conventioncart_id);
            const eventId = optionalIdentity(ticket.event_id);
            if (ticket.generic !== undefined) flag(ticket.generic);
            if (ticket.for_reservation !== undefined) flag(ticket.for_reservation);
            if (!verified || cart !== null || eventId === null) continue;
            const membership = roles.get(eventId) ?? new Set<Role>();
            membership.add('attending');
            roles.set(eventId, membership);
          }
        }
        const rawConvention = record(await read(
          operation, account, `/api/convention/${segment(cid)}`,
        ));
        const choice = convention(rawConvention, cid);
        const locationId = identity(rawConvention.geolocation_id);
        const location = record(await read(
          operation, account, `/api/geolocation/${segment(locationId)}`,
        ));
        objectType(location, 'geolocation');
        if (identity(location.id) !== locationId) throw new InvalidData();
        const zone = timeZone(location.timezone);
        const rows: ScheduleSnapshot['rows'][number][] = [];
        const rowKeys = new Set<string>();
        for (const [id, membership] of roles) {
          const parent = record(await read(operation, account, `/api/event/${segment(id)}`));
          if (identity(parent.id) !== id) throw new InvalidData();
          const eventRoles = (['hosting', 'attending'] as const).filter((role) => membership.has(role));
          const first = agendaRow(parent, parent, cid, eventRoles, 'event');
          const sessions = await list(operation, account, `/api/event/${segment(id)}/sessions`);
          if (parent.session_count !== undefined &&
              integer(parent.session_count) !== sessions.length + 1) {
            throw new ApiError('incomplete-refresh');
          }
          const eventRows = [
            first, ...sessions.map((item) => agendaRow(item, parent, cid, eventRoles, 'eventsession')),
          ];
          for (const row of eventRows) {
            if (rowKeys.has(row.key)) throw new ApiError('incomplete-refresh');
            rowKeys.add(row.key);
            rows.push(row);
          }
        }
        guard(operation);
        return {
          selection: selected,
          convention: choice,
          timeZone: zone,
          refreshedAt: new Date().toISOString(),
          rows,
        };
      });
    },

    async logout() {
      const previous = session;
      invalidate('aborted');
      if (previous === null) return { revocation: 'not-needed' };
      const operation = context();
      try {
        const result = record(await request(
          operation, `/api/session/${segment(previous.token)}`, 'DELETE',
          new URLSearchParams({ session_id: previous.token }),
        ));
        if (integer(result.success) !== 1) return { revocation: 'unconfirmed' };
        return { revocation: 'confirmed' };
      } catch {
        return { revocation: 'unconfirmed' };
      } finally {
        operation.dispose();
      }
    },
  };
}
