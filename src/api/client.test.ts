import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createScheduleClient } from './index';

const credentials = {
  username: 'synthetic-user', password: 'synthetic-password', apiKeyId: 'synthetic-key-id',
};
const account = { id: 'synthetic-session', object_type: 'session', user_id: 'User' };
const badge = {
  id: 'Badge', user_id: 'User', convention_id: 'Convention', verified: '1',
  conventioncart_id: null, badge_number: '7',
};
const event = {
  id: 'Event', convention_id: 'Convention', name: 'Synthetic event', event_number: '12',
  is_cancelled: '0', trashed: '0', is_scheduled: '1', published_to_schedule: '1',
  start_date: '2026-10-28 15:00:00', duration: '90',
};
const ticket = {
  id: 'Ticket', badge_id: 'Badge', convention_id: 'Convention', event_id: 'Event',
  verified: '1', conventioncart_id: null,
};

function response(result: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify({ result }), { status, headers });
}

function errorResponse(code: number, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify({
    error: { code, message: 'UPSTREAM PRIVATE DETAILS', data: 'DO NOT EXPOSE' },
  }), { status, headers });
}

function list(items: readonly unknown[]): Response {
  return response({
    items, paging: {
      total_items: items.length, total_pages: items.length ? 1 : 0,
      page_number: '1', items_per_page: '100', next_page_number: 2,
    },
  });
}

interface WireCall {
  url: URL;
  options: RequestInit;
  body: URLSearchParams;
  startedAt: number;
}

function stubFetch(handler: (call: WireCall) => Response | Promise<Response>) {
  const calls: WireCall[] = [];
  vi.stubGlobal('fetch', vi.fn<typeof fetch>((input, options) => {
    if (!(options?.body instanceof URLSearchParams)) throw new Error('Expected form body');
    const call = {
      url: new URL(String(input)), options, body: options.body, startedAt: Date.now(),
    };
    calls.push(call);
    return Promise.resolve(handler(call));
  }));
  return calls;
}

function defaultResponse(call: WireCall): Response {
  switch (call.url.pathname) {
    case '/api/session': return response(account);
    case '/api/session/synthetic-session': return response({ success: 1 });
    case '/api/user/User/badges':
    case '/api/convention/Convention/badges/my': return list([badge]);
    case '/api/user/User/events-hosted': return list([event]);
    case '/api/badge/Badge/tickets': return list([ticket]);
    case '/api/convention/Convention':
      return response({ id: 'Convention', name: 'Synthetic convention', geolocation_id: 'Location' });
    case '/api/geolocation/Location': return response({ id: 'Location', timezone: 'America/Chicago' });
    case '/api/event/Event': return response(event);
    case '/api/event/Event/sessions': return list([]);
    default: throw new Error('Unexpected synthetic route');
  }
}

async function complete<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const result = await settled;
  if ('error' in result) throw result.error;
  return result.value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('form transport and safe errors', () => {
  it('uses only allowlisted form POSTs with secure flags, body tokens and one documented logout URL exception', async () => {
    const calls = stubFetch(defaultResponse);
    const client = createScheduleClient();
    await complete(client.login(credentials));
    expect(await complete(client.listConventions())).toEqual([
      { id: 'Convention', name: 'Synthetic convention' },
    ]);
    expect(await complete(client.logout())).toEqual({ revocation: 'confirmed' });
    expect(calls[0]?.body.get('api_key_id')).toBe(credentials.apiKeyId);
    expect(calls[0]?.body.get('password')).toBe(credentials.password);
    for (const [index, call] of calls.entries()) {
      expect(call.url.origin).toBe('https://tabletop.events');
      expect(call.options).toMatchObject({
        method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer',
      });
      expect(call.options.headers).toBeUndefined();
      expect([...call.url.searchParams.keys()]).toEqual(index === 0 ? [] : ['X-HTTP-Method']);
      if (index > 0) {
        expect(call.body.get('session_id')).toBe(account.id);
        expect(call.body.has('password')).toBe(false);
        expect(call.startedAt - (calls[index - 1]?.startedAt ?? 0)).toBeGreaterThanOrEqual(1100);
      }
    }
    expect(calls.at(-1)?.url.pathname).toBe('/api/session/synthetic-session');
    expect(calls.at(-1)?.url.searchParams.get('X-HTTP-Method')).toBe('DELETE');
    expect(calls.slice(1, -1).every((call) =>
      !call.url.href.includes(account.id) && call.url.searchParams.get('X-HTTP-Method') === 'GET',
    )).toBe(true);
    expect(calls.find((call) => call.url.pathname.endsWith('events-hosted'))?.body.has('convention_id'))
      .toBe(false);
  });

  it.each([
    [450, 'access-denied'], [451, 'session-expired'], [454, 'sign-in-failed'],
    [452, 'rate-limited'], [500, 'service-unavailable'],
  ] as const)('maps error envelope %s under HTTP 200 without retaining upstream details or retrying login', async (code, expected) => {
    const calls = stubFetch(() => errorResponse(code));
    const client = createScheduleClient();
    const failure = await complete(client.login(credentials)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toHaveProperty('code', expected);
    expect(String(failure)).not.toContain('PRIVATE');
    expect(failure).not.toHaveProperty('cause');
    expect(calls).toHaveLength(1);
    expect(client.getSessionState()).toBe('signed-out');
  });

  it.each([
    { result: { id: 'Token', user_id: 'User' } },
    { result: { ...account, id: '' } },
    { result: { ...account, user_id: null } },
    { result: null },
    { unrelated: [] },
    { error: { code: 'not-a-code' } },
  ])('rejects malformed login envelope', async (body) => {
    stubFetch(() => new Response(JSON.stringify(body)));
    const client = createScheduleClient();
    await expect(complete(client.login(credentials))).rejects.toHaveProperty('code', 'invalid-response');
    expect(client.getSessionState()).toBe('signed-out');
  });

  it('maps HTTP failures with non-JSON bodies safely and never retries sign-in', async () => {
    const calls = stubFetch(() => new Response('<html>PRIVATE</html>', { status: 504 }));
    await expect(complete(createScheduleClient().login(credentials)))
      .rejects.toHaveProperty('code', 'service-unavailable');
    expect(calls).toHaveLength(1);
  });

  it('retries reads only twice with 2s/4s backoff and honors a longer Retry-After', async () => {
    const calls = stubFetch((call) => call.url.pathname === '/api/session'
      ? response(account) : errorResponse(452, 200, { 'Retry-After': '3' }));
    const client = createScheduleClient();
    await complete(client.login(credentials));
    await expect(complete(client.listConventions())).rejects.toHaveProperty('code', 'rate-limited');
    expect(calls).toHaveLength(4);
    expect((calls[2]?.startedAt ?? 0) - (calls[1]?.startedAt ?? 0)).toBeGreaterThanOrEqual(3000);
    expect((calls[3]?.startedAt ?? 0) - (calls[2]?.startedAt ?? 0)).toBeGreaterThanOrEqual(4000);
  });

  it('does not expose raw fetch exceptions and retries only bounded read failures', async () => {
    const calls = stubFetch((call) => {
      if (call.url.pathname === '/api/session') return response(account);
      throw new Error('PRIVATE URL WITH TOKEN');
    });
    const client = createScheduleClient();
    await complete(client.login(credentials));
    const failure = await complete(client.listConventions()).catch((error: unknown) => error);
    expect(failure).toHaveProperty('code', 'network');
    expect(String(failure)).not.toContain('PRIVATE');
    expect(calls).toHaveLength(4);
  });
});

describe('membership and staged snapshots', () => {
  it('discovers the union of real owned badge and hosted conventions without auto-merging family badges', async () => {
    const calls = stubFetch((call) => {
      if (call.url.pathname === '/api/user/User/badges') return list([
        badge,
        { ...badge, id: 'Friend', user_id: 'Other', convention_id: 'Foreign' },
        { ...badge, id: 'Cart', conventioncart_id: 'Cart', convention_id: 'CartConvention' },
        { ...badge, id: 'Unverified', verified: '0', convention_id: 'UnverifiedConvention' },
      ]);
      if (call.url.pathname === '/api/user/User/events-hosted') {
        return list([{ id: 'HostOnly', convention_id: 'Ended' }]);
      }
      if (call.url.pathname === '/api/convention/Ended') {
        return response({ id: 'Ended', name: 'Ended convention', has_ended: 1 });
      }
      return defaultResponse(call);
    });
    const client = createScheduleClient();
    await complete(client.login(credentials));
    expect(await complete(client.listConventions())).toEqual([
      { id: 'Convention', name: 'Synthetic convention' }, { id: 'Ended', name: 'Ended convention' },
    ]);
    expect(calls.some((call) => call.url.pathname === '/api/convention')).toBe(false);
    expect(calls.some((call) => call.url.pathname.includes('reserved'))).toBe(false);
  });

  it('returns an empty real membership list without a public-catalog fallback', async () => {
    stubFetch((call) => call.url.pathname === '/api/session' ? response(account) : list([]));
    const client = createScheduleClient();
    await complete(client.login(credentials));
    expect(await complete(client.listConventions())).toEqual([]);
  });

  it('discovers and loads a genuinely badge-less host through the full hosting-only flow', async () => {
    const calls = stubFetch((call) => {
      if (call.url.pathname === '/api/user/User/badges' ||
          call.url.pathname === '/api/convention/Convention/badges/my') return list([]);
      return defaultResponse(call);
    });
    const client = createScheduleClient();
    await complete(client.login(credentials));
    expect(await complete(client.listConventions())).toEqual([
      { id: 'Convention', name: 'Synthetic convention' },
    ]);
    expect(await complete(client.listBadges('Convention'))).toEqual([]);
    const selection = { conventionId: 'Convention', badgeIds: [] };
    const snapshot = await complete(client.loadSchedule(selection));
    expect(snapshot.selection).toEqual(selection);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({ id: 'Event', roles: ['hosting'] });
    expect(calls.some((call) => call.url.pathname.endsWith('/tickets'))).toBe(false);
  });

  it('revalidates owned badges and rejects selecting a visible friend or unavailable badge', async () => {
    stubFetch((call) => call.url.pathname.endsWith('/badges/my')
      ? list([badge, { ...badge, id: 'Friend', user_id: 'Other' }]) : defaultResponse(call));
    const client = createScheduleClient();
    await complete(client.login(credentials));
    expect(await complete(client.listBadges('Convention'))).toEqual([
      { id: 'Badge', conventionId: 'Convention', label: 'Badge 7' },
    ]);
    await expect(complete(client.loadSchedule({ conventionId: 'Convention', badgeIds: ['Friend'] })))
      .rejects.toHaveProperty('code', 'invalid-selection');
  });

  it('merges event-level roles, canonicalizes explicit badges, includes additional sessions and accepts free/granted/reservation-origin tickets', async () => {
    const calls = stubFetch((call) => {
      if (call.url.pathname === '/api/badge/Badge/tickets') return list([
        { ...ticket, amount_paid: '0', for_reservation: '1', generic: '1' },
        { ...ticket, id: 'Granted', conventionreceipt_id: null },
        { ...ticket, id: 'Cart', conventioncart_id: 'Cart', event_id: 'Excluded' },
        { ...ticket, id: 'Unverified', verified: 0, event_id: 'Excluded' },
        { ...ticket, id: 'Unassigned', event_id: null, generic: 1 },
      ]);
      if (call.url.pathname === '/api/event/Event') return response({ ...event, session_count: '2' });
      if (call.url.pathname === '/api/event/Event/sessions') return list([{
        id: 'Event', event_id: 'Event', convention_id: 'Convention',
        session_name: 'Additional session', start_date: null, duration: null,
        is_scheduled: 0, published_to_schedule: 0,
      }]);
      return defaultResponse(call);
    });
    const client = createScheduleClient();
    await complete(client.login(credentials));
    const selected = ['Badge', 'Badge'];
    const promise = client.loadSchedule({ conventionId: 'Convention', badgeIds: selected });
    selected.push('Foreign');
    const snapshot = await complete(promise);
    expect(snapshot.selection).toEqual({ conventionId: 'Convention', badgeIds: ['Badge'] });
    expect(snapshot.timeZone).toBe('America/Chicago');
    expect(snapshot.rows.map((row) => row.key)).toEqual([
      'Convention:event:Event', 'Convention:eventsession:Event',
    ]);
    expect(snapshot.rows.every((row) => row.roles.join(',') === 'hosting,attending')).toBe(true);
    expect(snapshot.rows[1]).toMatchObject({ startUtc: null, endUtc: null, isScheduled: false });
    expect(calls.filter((call) => call.url.pathname === '/api/event/Event')).toHaveLength(1);
    const qualifiers = calls.find((call) => call.url.pathname.endsWith('/tickets'))?.body;
    for (const key of ['collected', 'picked_up', 'for_reservation', 'generic', 'in_tournament',
      'event.is_cancelled', 'event.is_scheduled']) expect(qualifiers?.get(key)).toBe('');
    expect(qualifiers?.get('verified')).toBe('1');
    expect(calls.some((call) => call.url.pathname.includes('Excluded'))).toBe(false);
    expect(snapshot).not.toHaveProperty('userId');
    expect(JSON.stringify(snapshot)).not.toContain('Ticket');
  });

  it.each([1, '1'])('skips additional-session requests when session_count is %s', async (sessionCount) => {
    const calls = stubFetch((call) => call.url.pathname === '/api/event/Event'
      ? response({ ...event, session_count: sessionCount }) : defaultResponse(call));
    const client = createScheduleClient();
    await complete(client.login(credentials));
    const snapshot = await complete(client.loadSchedule({ conventionId: 'Convention', badgeIds: ['Badge'] }));
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({
      key: 'Convention:event:Event', roles: ['hosting', 'attending'],
    });
    expect(calls.some((call) => call.url.pathname === '/api/event/Event/sessions')).toBe(false);
  });

  it.each([undefined, 2, '2'])('fetches additional sessions when session_count is %s', async (sessionCount) => {
    const calls = stubFetch((call) => {
      if (call.url.pathname === '/api/event/Event') return response({ ...event, session_count: sessionCount });
      if (call.url.pathname === '/api/event/Event/sessions') return list([{
        id: 'Additional', event_id: 'Event', convention_id: 'Convention',
        session_name: 'Additional session', start_date: null, duration: null,
        is_scheduled: 0, published_to_schedule: 0,
      }]);
      return defaultResponse(call);
    });
    const client = createScheduleClient();
    await complete(client.login(credentials));
    const snapshot = await complete(client.loadSchedule({ conventionId: 'Convention', badgeIds: ['Badge'] }));
    expect(snapshot.rows.map((row) => row.key)).toEqual([
      'Convention:event:Event', 'Convention:eventsession:Additional',
    ]);
    expect(calls.filter((call) => call.url.pathname === '/api/event/Event/sessions')).toHaveLength(1);
  });

  it('supports hosting only, never reads unselected tickets, and refreshes hosting truth', async () => {
    let hosted = true;
    const calls = stubFetch((call) => {
      if (call.url.pathname.endsWith('events-hosted')) return list(hosted ? [event] : []);
      return defaultResponse(call);
    });
    const client = createScheduleClient();
    await complete(client.login(credentials));
    const selection = { conventionId: 'Convention', badgeIds: [] };
    expect((await complete(client.loadSchedule(selection))).rows[0]?.roles).toEqual(['hosting']);
    hosted = false;
    expect((await complete(client.loadSchedule(selection))).rows).toEqual([]);
    expect(calls.some((call) => call.url.pathname.endsWith('/tickets'))).toBe(false);
  });

  it('loads ticket-only events even if the account hosts nothing', async () => {
    stubFetch((call) => call.url.pathname.endsWith('events-hosted') ? list([]) : defaultResponse(call));
    const client = createScheduleClient();
    await complete(client.login(credentials));
    const snapshot = await complete(client.loadSchedule({ conventionId: 'Convention', badgeIds: ['Badge'] }));
    expect(snapshot.rows[0]?.roles).toEqual(['attending']);
  });

  it.each([
    ['wrong ticket badge', '/api/badge/Badge/tickets', () => list([{ ...ticket, badge_id: 'Other' }]), 'invalid-response'],
    ['wrong ticket convention', '/api/badge/Badge/tickets', () => list([{ ...ticket, convention_id: 'Other' }]), 'invalid-response'],
    ['wrong event convention', '/api/event/Event', () => response({ ...event, convention_id: 'Other' }), 'invalid-response'],
    ['wrong timezone identity', '/api/geolocation/Location', () => response({ id: 'Other', timezone: 'UTC' }), 'invalid-response'],
    ['missing timezone', '/api/geolocation/Location', () => response({ id: 'Location' }), 'invalid-response'],
    ['missing sessions', '/api/event/Event', () => response({ ...event, session_count: 2 }), 'incomplete-refresh'],
  ] as const)('fails the entire staged snapshot on %s', async (_label, path, makeResponse, code) => {
    stubFetch((call) => call.url.pathname === path ? makeResponse() : defaultResponse(call));
    const client = createScheduleClient();
    await complete(client.login(credentials));
    await expect(complete(client.loadSchedule({ conventionId: 'Convention', badgeIds: ['Badge'] })))
      .rejects.toHaveProperty('code', code);
  });
});

describe('session, cancellation and logout races', () => {
  it('requires authentication and permits only one high-level read at a time', async () => {
    stubFetch(defaultResponse);
    const client = createScheduleClient();
    await expect(client.listConventions()).rejects.toHaveProperty('code', 'not-authenticated');
    await complete(client.login(credentials));
    const reading = client.listConventions();
    await expect(client.listBadges('Convention')).rejects.toHaveProperty('code', 'busy');
    await complete(reading);
    expect(await complete(client.listBadges('Convention'))).toHaveLength(1);
  });

  it('cancels a queued read before it starts and releases the read lock', async () => {
    const calls = stubFetch(defaultResponse);
    const client = createScheduleClient();
    await complete(client.login(credentials));
    const controller = new AbortController();
    const reading = client.listConventions({ signal: controller.signal });
    controller.abort();
    await expect(complete(reading)).rejects.toHaveProperty('code', 'aborted');
    expect(calls).toHaveLength(1);
    expect(await complete(client.listConventions())).toHaveLength(1);
  });

  it('cancels an in-flight read even when fetch ignores abort, and ignores its late response', async () => {
    let resolveRead: ((value: Response) => void) | undefined;
    stubFetch((call) => call.url.pathname === '/api/user/User/badges'
      ? new Promise<Response>((resolve) => { resolveRead = resolve; })
      : defaultResponse(call));
    const client = createScheduleClient();
    await complete(client.login(credentials));
    const controller = new AbortController();
    const reading = client.listConventions({ signal: controller.signal });
    const observed = reading.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1100);
    controller.abort();
    expect(await observed).toHaveProperty('code', 'aborted');
    resolveRead?.(list([badge]));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getSessionState()).toBe('authenticated');
    expect(await complete(client.logout())).toEqual({ revocation: 'confirmed' });
  });

  it('times out a request after 30 seconds without retrying it', async () => {
    const calls = stubFetch(() => new Promise<Response>(() => undefined));
    const client = createScheduleClient();
    await expect(complete(client.login(credentials))).rejects.toHaveProperty('code', 'timeout');
    expect(calls).toHaveLength(1);
    expect(client.getSessionState()).toBe('signed-out');
  });

  it('clears authentication on an HTTP-200 expiry envelope and does not retry', async () => {
    const calls = stubFetch((call) => call.url.pathname === '/api/session'
      ? response(account) : errorResponse(451));
    const client = createScheduleClient();
    await complete(client.login(credentials));
    await expect(complete(client.listConventions())).rejects.toHaveProperty('code', 'session-expired');
    expect(client.getSessionState()).toBe('signed-out');
    await expect(client.listConventions()).rejects.toHaveProperty('code', 'not-authenticated');
    expect(await client.logout()).toEqual({ revocation: 'not-needed' });
    expect(calls).toHaveLength(2);
  });

  it('logout synchronously invalidates local auth and preempts a pending read', async () => {
    const calls = stubFetch(defaultResponse);
    const client = createScheduleClient();
    await complete(client.login(credentials));
    const reading = client.listConventions().catch((error: unknown) => error);
    const logout = client.logout();
    expect(client.getSessionState()).toBe('signed-out');
    expect(await reading).toHaveProperty('code', 'aborted');
    expect(await complete(logout)).toEqual({ revocation: 'confirmed' });
    expect(calls.filter((call) => call.url.searchParams.get('X-HTTP-Method') === 'DELETE')).toHaveLength(1);
  });

  it('ignores a late login after logout instead of resurrecting authentication', async () => {
    let resolveLogin: ((value: Response) => void) | undefined;
    stubFetch(() => new Promise<Response>((resolve) => { resolveLogin = resolve; }));
    const client = createScheduleClient();
    const login = client.login(credentials).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(await client.logout()).toEqual({ revocation: 'not-needed' });
    expect(await login).toHaveProperty('code', 'aborted');
    resolveLogin?.(response(account));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getSessionState()).toBe('signed-out');
  });

  it('account replacement preempts old login and ignores its late success', async () => {
    let resolveOld: ((value: Response) => void) | undefined;
    let logins = 0;
    stubFetch((call) => {
      if (call.url.pathname === '/api/session' && logins++ === 0) {
        return new Promise<Response>((resolve) => { resolveOld = resolve; });
      }
      return defaultResponse(call);
    });
    const client = createScheduleClient();
    const old = client.login(credentials).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    await complete(client.login(credentials));
    expect(await old).toHaveProperty('code', 'aborted');
    resolveOld?.(response({ ...account, id: 'OtherToken', user_id: 'OtherUser' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(await complete(client.listConventions())).toHaveLength(1);
    expect(client.getSessionState()).toBe('authenticated');
  });

  it('a late old logout cannot clear the replacement session', async () => {
    let resolveLogout: ((value: Response) => void) | undefined;
    stubFetch((call) => call.url.searchParams.get('X-HTTP-Method') === 'DELETE'
      ? new Promise<Response>((resolve) => { resolveLogout = resolve; })
      : defaultResponse(call));
    const client = createScheduleClient();
    await complete(client.login(credentials));
    const logout = client.logout();
    await vi.advanceTimersByTimeAsync(1100);
    const replacement = client.login(credentials);
    expect(await complete(replacement)).toBeUndefined();
    expect(await logout).toEqual({ revocation: 'unconfirmed' });
    resolveLogout?.(errorResponse(451));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getSessionState()).toBe('authenticated');
  });

  it('a late in-flight read expiry cannot expire a replacement account or publish the old snapshot', async () => {
    let resolveRead: ((value: Response) => void) | undefined;
    let logins = 0;
    const replacement = { ...account, id: 'ReplacementToken', user_id: 'ReplacementUser' };
    const calls = stubFetch((call) => {
      if (call.url.pathname === '/api/session') {
        return response(logins++ === 0 ? account : replacement);
      }
      if (call.url.pathname === '/api/event/Event') {
        return new Promise<Response>((resolve) => { resolveRead = resolve; });
      }
      if (call.url.pathname.startsWith('/api/user/ReplacementUser/')) return list([]);
      return defaultResponse(call);
    });
    const client = createScheduleClient();
    await complete(client.login(credentials));
    const publish = vi.fn();
    const old = client.loadSchedule({ conventionId: 'Convention', badgeIds: [] })
      .then(publish).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(6600);
    expect(resolveRead).toBeTypeOf('function');
    await complete(client.login({ ...credentials, username: 'replacement-user' }));
    expect(await old).toHaveProperty('code', 'aborted');
    resolveRead?.(errorResponse(451));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getSessionState()).toBe('authenticated');
    expect(publish).not.toHaveBeenCalled();
    expect(await complete(client.listConventions())).toEqual([]);
    expect(client.getSessionState()).toBe('authenticated');
    const newReads = calls.filter((call) =>
      call.url.pathname.startsWith('/api/user/ReplacementUser/'),
    );
    expect(newReads).toHaveLength(2);
    expect(newReads.every((call) => call.body.get('session_id') === replacement.id)).toBe(true);
  });

  it('reports unconfirmed revocation on failure without retrying or restoring the session', async () => {
    const calls = stubFetch((call) => call.url.pathname === '/api/session'
      ? response(account) : errorResponse(500));
    const client = createScheduleClient();
    await complete(client.login(credentials));
    const logout = client.logout();
    expect(client.getSessionState()).toBe('signed-out');
    expect(await complete(logout)).toEqual({ revocation: 'unconfirmed' });
    expect(calls).toHaveLength(2);
  });
});
