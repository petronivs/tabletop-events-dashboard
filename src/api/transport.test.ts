import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { Transport, type Operation } from './transport';

function operation(controller = new AbortController()): Operation {
  return {
    signal: controller.signal, requests: 0, expiresAt: Date.now() + 30 * 60_000,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared transport safety bounds', () => {
  it('serializes login/read/logout starts even when independent callers enqueue together', async () => {
    const starts: number[] = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => {
      starts.push(Date.now());
      return Promise.resolve(new Response(JSON.stringify({ result: { success: 1 } })));
    }));
    const transport = new Transport();
    const pending = [
      transport.request('/api/session', 'POST', new URLSearchParams(), operation(), () => undefined),
      transport.request('/api/event/Event', 'GET', new URLSearchParams(), operation(), () => undefined),
      transport.request('/api/session/Token', 'DELETE', new URLSearchParams(), operation(), () => undefined),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(pending);
    expect(starts).toHaveLength(3);
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(1100);
    expect((starts[2] ?? 0) - (starts[1] ?? 0)).toBeGreaterThanOrEqual(1100);
  });

  it('fails before request 1,001 or after a 30-minute budget instead of truncating', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    const transport = new Transport();
    for (const exhausted of [
      { ...operation(), requests: 1000 },
      { ...operation(), expiresAt: Date.now() },
    ]) {
      await expect(transport.request(
        '/api/event/Event', 'GET', new URLSearchParams(), exhausted, () => undefined,
      )).rejects.toHaveProperty('code', 'incomplete-refresh');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never sends an arbitrary origin, relationship or write path', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    const transport = new Transport();
    for (const path of [
      'https://other.invalid/api/session', '/api/user/User/events-reserved',
      '/api/convention/Convention/message-volunteers', '/api/session/Token?leak=1',
    ]) {
      await expect(transport.request(
        path, 'GET', new URLSearchParams(), operation(), () => undefined,
      )).rejects.toHaveProperty('code', 'invalid-response');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancels a long Retry-After immediately without starting another request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response(
      JSON.stringify({ error: { code: 429 } }), { headers: { 'Retry-After': '3600' } },
    )));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const pending = new Transport().request(
      '/api/event/Event', 'GET', new URLSearchParams(), operation(controller), () => undefined,
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new ApiError('aborted'));
    expect(await pending).toHaveProperty('code', 'aborted');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('includes response body decoding in the per-request timeout', async () => {
    const body = new ReadableStream<Uint8Array>();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.resolve(new Response(body))));
    const pending = new Transport().request(
      '/api/event/Event', 'GET', new URLSearchParams(), operation(), () => undefined,
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toHaveProperty('code', 'timeout');
  });
});
