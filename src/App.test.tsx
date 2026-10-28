import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import type { ScheduleClient } from './api';
import type { AgendaRow, ScheduleSelection, ScheduleSnapshot } from './domain';
import { App } from './App';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function row(overrides: Partial<AgendaRow> = {}): AgendaRow {
  return {
    key: 'c1:event:e1', id: 'e1', objectType: 'event', conventionId: 'c1', parentEventId: 'e1',
    name: 'Synthetic strategy session', eventNumber: '17', sessionName: null,
    startUtc: '2026-10-29T01:00:00Z', endUtc: '2026-10-29T02:00:00Z', durationMinutes: 60,
    roomName: 'Maple Hall', spaceName: 'Table 4', cancelled: false, trashed: false,
    isScheduled: true, publishedToSchedule: true, roles: ['hosting'],
    ...overrides,
  };
}

function snapshot(selection: ScheduleSelection = { conventionId: 'c1', badgeIds: [] }, rows = [row()]): ScheduleSnapshot {
  return {
    selection, convention: { id: selection.conventionId, name: selection.conventionId === 'c1' ? 'Synthetic Con' : 'Other Con' },
    timeZone: 'America/Los_Angeles', refreshedAt: '2026-10-28T15:00:00Z', rows,
  };
}

function makeClient() {
  return {
    getSessionState: vi.fn<ScheduleClient['getSessionState']>(() => 'authenticated'),
    login: vi.fn<ScheduleClient['login']>().mockResolvedValue(undefined),
    listConventions: vi.fn<ScheduleClient['listConventions']>().mockResolvedValue([
      { id: 'c1', name: 'Synthetic Con' }, { id: 'c2', name: 'Other Con' },
    ]),
    listBadges: vi.fn<ScheduleClient['listBadges']>().mockImplementation(async (conventionId) => [
      { id: conventionId === 'c1' ? 'b1' : 'b2', conventionId, label: conventionId === 'c1' ? 'Synthetic badge' : 'Other badge' },
    ]),
    loadSchedule: vi.fn<ScheduleClient['loadSchedule']>().mockImplementation(async (selection) => snapshot(selection)),
    logout: vi.fn<ScheduleClient['logout']>().mockResolvedValue({ revocation: 'confirmed' }),
  };
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Developer username'), 'synthetic-user');
  await user.type(screen.getByLabelText('Password', { exact: true }), 'synthetic-password');
  await user.type(screen.getByLabelText(/API key ID/), 'synthetic-key-id');
  await user.click(screen.getByRole('button', { name: /Sign in securely/ }));
}

async function selectConvention(user: ReturnType<typeof userEvent.setup>, id = 'c1') {
  await screen.findByRole('option', { name: 'Synthetic Con' });
  await user.selectOptions(screen.getByLabelText('Convention', { exact: true }), id);
  await waitFor(() => expect(screen.getByRole('button', { name: /Load my agenda/ })).toBeEnabled());
}

async function load(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Load my agenda/ }));
  await screen.findByRole('heading', { name: 'Synthetic strategy session' });
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('developer sign-in and private lifecycle', () => {
  it('clears every credential field after a failed attempt and never renders raw errors', async () => {
    const client = makeClient();
    client.login.mockRejectedValue(new Error('PRIVATE_UPSTREAM_DETAIL'));
    render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(document.body).not.toHaveTextContent('PRIVATE_UPSTREAM_DETAIL');
    for (const name of ['Developer username', 'Password', /API key ID/]) {
      expect(screen.getByLabelText(name, { exact: typeof name === 'string' })).toHaveValue('');
    }
    expect(client.listConventions).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /official API key guide/ })).toHaveAttribute('href', 'https://tabletop.events/developer/APIKey.html');
  });

  it('uses a real discovery lifecycle, removes successful sign-in fields, and focuses the new screen', async () => {
    const client = makeClient();
    render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user);
    await screen.findByRole('option', { name: 'Synthetic Con' });
    expect(screen.queryByLabelText('Password', { exact: true })).not.toBeInTheDocument();
    expect(client.login).toHaveBeenCalledWith({
      username: 'synthetic-user', password: 'synthetic-password', apiKeyId: 'synthetic-key-id',
    }, { signal: expect.any(AbortSignal) });
    expect(client.loadSchedule).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('clears personal data immediately on logout, then reports unconfirmed revocation safely', async () => {
    const client = makeClient();
    const revocation = deferred<Awaited<ReturnType<ScheduleClient['logout']>>>();
    client.logout.mockReturnValue(revocation.promise);
    render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user); await selectConvention(user); await load(user);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.queryByText('Synthetic strategy session')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Convention', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Developer username')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Sign in securely/ })).toBeDisabled();
    await act(async () => revocation.resolve({ revocation: 'unconfirmed' }));
    expect(screen.getByText(/server session revocation could not be confirmed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in securely/ })).toBeEnabled();
  });

  it('cancels a pending login, clears fields immediately, and ignores a late successful response', async () => {
    const client = makeClient();
    const pending = deferred<void>();
    client.login.mockReturnValue(pending.promise);
    render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user);
    const signal = client.login.mock.calls[0][1]?.signal;
    await user.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue('');
    await act(async () => pending.resolve());
    expect(client.listConventions).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Convention', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in securely/ })).toBeEnabled();
  });

  it('erases the agenda, badges, and choices on session expiry instead of retaining stale personal data', async () => {
    const client = makeClient();
    render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user); await selectConvention(user); await load(user);
    client.loadSchedule.mockRejectedValueOnce(new ApiError('session-expired'));
    await user.click(screen.getByRole('button', { name: /Refresh agenda/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your session expired');
    expect(screen.queryByText('Synthetic strategy session')).not.toBeInTheDocument();
    expect(screen.queryByText('Synthetic badge')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Synthetic Con' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue('');
  });
});

describe('explicit selection and complete snapshots', () => {
  it('defaults to hosting only, includes selected badges only on request, and clears old snapshots on badge changes', async () => {
    const client = makeClient();
    render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user); await selectConvention(user);
    const badge = screen.getByRole('checkbox', { name: 'Synthetic badge' });
    expect(badge).not.toBeChecked();
    expect(screen.getByText('Hosting only · No badges selected')).toBeInTheDocument();
    await load(user);
    expect(client.loadSchedule.mock.calls[0][0]).toEqual({ conventionId: 'c1', badgeIds: [] });
    await user.click(badge);
    expect(screen.queryByText('Synthetic strategy session')).not.toBeInTheDocument();
    expect(client.loadSchedule).toHaveBeenCalledTimes(1);
    await load(user);
    expect(client.loadSchedule.mock.calls[1][0]).toEqual({ conventionId: 'c1', badgeIds: ['b1'] });
    await user.click(badge);
    expect(screen.queryByText('Synthetic strategy session')).not.toBeInTheDocument();
  });

  it('retains the same-selection snapshot after refresh failure with the actual last successful time', async () => {
    const client = makeClient();
    render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user); await selectConvention(user); await load(user);
    client.loadSchedule.mockRejectedValueOnce(new ApiError('incomplete-refresh'));
    await user.click(screen.getByRole('button', { name: /Refresh agenda/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('complete agenda could not be verified');
    expect(screen.getByText('Synthetic strategy session')).toBeInTheDocument();
    expect(screen.getByText(/Showing previous agenda/)).toHaveTextContent('Oct 28, 2026, 8:00:00 AM PDT');
    expect(document.querySelector('.freshness time')).toHaveAttribute('datetime', '2026-10-28T15:00:00Z');
  });

  it('aborts and settles old reads before a convention replacement, never relabeling late snapshots', async () => {
    const client = makeClient();
    const pending = deferred<ScheduleSnapshot>();
    client.loadSchedule.mockReturnValueOnce(pending.promise);
    render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user); await selectConvention(user);
    await user.click(screen.getByRole('button', { name: /Load my agenda/ }));
    expect(screen.getByRole('button', { name: /Load my agenda/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    const signal = client.loadSchedule.mock.calls[0][1]?.signal;
    await user.selectOptions(screen.getByLabelText('Convention', { exact: true }), 'c2');
    expect(signal?.aborted).toBe(true);
    expect(client.listBadges).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Synthetic strategy session')).not.toBeInTheDocument();
    await act(async () => pending.resolve(snapshot()));
    await screen.findByRole('checkbox', { name: 'Other badge' });
    expect(screen.getByRole('heading', { name: 'Other Con' })).toBeInTheDocument();
    expect(screen.queryByText('Synthetic strategy session')).not.toBeInTheDocument();
    expect(client.listBadges).toHaveBeenCalledTimes(2);
  });

  it('clears the previous agenda immediately when selecting a different convention', async () => {
    const client = makeClient();
    render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user); await selectConvention(user); await load(user);
    await user.selectOptions(screen.getByLabelText('Convention', { exact: true }), 'c2');
    expect(screen.queryByText('Synthetic strategy session')).not.toBeInTheDocument();
    expect(screen.queryByText(/Last complete refresh/)).not.toBeInTheDocument();
    await screen.findByRole('checkbox', { name: 'Other badge' });
  });

  it('rejects a mismatched client snapshot and does not display its rows', async () => {
    const client = makeClient();
    client.loadSchedule.mockResolvedValue(snapshot({ conventionId: 'c2', badgeIds: [] }));
    render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user); await selectConvention(user);
    await user.click(screen.getByRole('button', { name: /Load my agenda/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not safely read');
    expect(screen.queryByText('Synthetic strategy session')).not.toBeInTheDocument();
  });

  it('distinguishes an empty discovery result, failed discovery, and an empty complete agenda', async () => {
    const client = makeClient();
    client.listConventions.mockResolvedValueOnce([]);
    render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user);
    expect(await screen.findByText(/No conventions with verified owned badges/)).toBeInTheDocument();
    client.listConventions.mockRejectedValueOnce(new ApiError('access-denied'));
    await user.click(screen.getByRole('button', { name: /Reload convention choices/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('did not allow this account');
    await user.click(screen.getByRole('button', { name: /Reload convention choices/ }));
    await selectConvention(user);
    client.loadSchedule.mockResolvedValueOnce(snapshot(undefined, []));
    await user.click(screen.getByRole('button', { name: /Load my agenda/ }));
    expect(await screen.findByRole('heading', { name: 'Your agenda has room for adventure' })).toBeInTheDocument();
  });
});

describe('agenda presentation and offline boundaries', () => {
  it('uses convention-zone dates, combines both roles, preserves statuses, and filters search/day/role', async () => {
    const client = makeClient();
    client.loadSchedule.mockResolvedValue(snapshot(undefined, [
      row({ roles: ['hosting', 'attending'], cancelled: true, publishedToSchedule: false }),
      row({ key: 'c1:event:e2', id: 'e2', name: 'Unknown-time workshop', startUtc: null, endUtc: null,
        roles: ['attending'], trashed: true, isScheduled: false, durationMinutes: null, roomName: null, spaceName: null }),
    ]));
    render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user); await selectConvention(user); await load(user);
    expect(screen.getByRole('heading', { name: /Wednesday, October 28, 2026/ })).toBeInTheDocument();
    expect(screen.getByText('6:00 PM')).toBeInTheDocument();
    expect(screen.getByText('America/Los_Angeles')).toBeInTheDocument();
    const event = screen.getByRole('heading', { name: 'Synthetic strategy session' }).closest('li')!;
    expect(within(event).getByText('Hosting')).toBeInTheDocument();
    expect(within(event).getByText('Attending')).toBeInTheDocument();
    expect(within(event).getByText('Cancelled')).toBeInTheDocument();
    expect(within(event).getByText('Unpublished')).toBeInTheDocument();
    expect(screen.getByText('Removed from public schedule')).toBeInTheDocument();
    expect(screen.getByText('Unscheduled')).toBeInTheDocument();
    expect(screen.getByText('Location not announced')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Your role'), 'hosting');
    expect(screen.queryByText('Unknown-time workshop')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Search agenda'), 'maple');
    expect(screen.getByText('Synthetic strategy session')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search agenda'));
    await user.type(screen.getByLabelText('Search agenda'), 'not-present');
    expect(screen.getByRole('heading', { name: 'No matching events' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await user.selectOptions(screen.getByLabelText('Day'), 'unknown');
    expect(screen.getByText('Unknown-time workshop')).toBeInTheDocument();
    expect(screen.queryByText('Synthetic strategy session')).not.toBeInTheDocument();
  });

  it('keeps only the open tab snapshot offline and starts a fresh offline document without private data', async () => {
    const client = makeClient();
    const view = render(<App client={client} />);
    const user = userEvent.setup();
    await signIn(user); await selectConvention(user); await load(user);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    act(() => { fireEvent(window, new Event('offline')); });
    expect(screen.getByText(/this open tab’s memory-only agenda/)).toBeInTheDocument();
    expect(screen.getByText('Synthetic strategy session')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh agenda/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    view.unmount();
    const freshClient = makeClient();
    render(<App client={freshClient} />);
    expect(screen.getByText(/No saved sign-in or agenda is available/)).toBeInTheDocument();
    expect(screen.queryByText('Synthetic strategy session')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in securely/ })).toBeDisabled();
    expect(freshClient.login).not.toHaveBeenCalled();
    expect(freshClient.loadSchedule).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    act(() => { fireEvent(window, new Event('online')); });
    expect(screen.getByRole('button', { name: /Sign in securely/ })).toBeEnabled();
  });
});
