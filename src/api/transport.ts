import { integer, record } from '../domain/validation';
import { ApiError, RetryableError } from './errors';

/** Shared cancellation and cumulative safety budget for one high-level operation. */
export interface Operation {
  signal: AbortSignal;
  /** Started wire attempts, including retries, across all lists/details. */
  requests: number;
  /** Absolute epoch-millisecond deadline, checked before queued attempts. */
  expiresAt: number;
}

/** Preserves a safe ApiError abort reason, otherwise supplies the local `aborted` error. */
export function abortError(signal: AbortSignal): ApiError {
  return signal.reason instanceof ApiError ? signal.reason : new ApiError('aborted');
}

/** Throws synchronously on cancellation or deadline expiry, before more work starts. */
export function checkOperation(operation: Operation): void {
  if (operation.signal.aborted) throw abortError(operation.signal);
  if (Date.now() >= operation.expiresAt) throw new ApiError('incomplete-refresh');
}

/**
 * Rejects promptly on cancellation even if work ignores its own signal.
 * Does not cancel the underlying promise; its eventual settlement remains observed.
 */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    if (signal.aborted) reject(abortError(signal));
    else signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Waits a nonnegative timer-safe delay; cancellation rejects and clears its timer. */
export function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, Math.min(2_147_483_647, Math.max(0, milliseconds)));
    signal.addEventListener('abort', abort, { once: true });
  });
}

function retryAfter(response: Response): number {
  const raw = response.headers.get('Retry-After');
  if (!raw) return 0;
  if (/^\d+(?:\.\d+)?$/u.test(raw)) {
    const milliseconds = Number(raw) * 1000;
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function statusError(code: number, delay: number): ApiError {
  if (code === 451) return new ApiError('session-expired');
  if (code === 450 || code === 401 || code === 403) return new ApiError('access-denied');
  if (code === 454) return new ApiError('sign-in-failed');
  if (code === 452 || code === 429) return new RetryableError('rate-limited', delay);
  if (code === 500 || code === 504) return new RetryableError('service-unavailable', delay);
  if (code >= 500) return new ApiError('service-unavailable');
  return new ApiError('invalid-response');
}

function allowedPath(path: string, method: 'GET' | 'POST' | 'DELETE'): boolean {
  const segment = '[A-Za-z0-9._~!%*\\x27()-]+';
  if (method === 'POST') return path === '/api/session';
  if (method === 'DELETE') return new RegExp(`^/api/session/${segment}$`, 'u').test(path);
  return [
    `^/api/user/${segment}/(?:badges|events-hosted)$`,
    `^/api/convention/${segment}(?:/badges/my)?$`,
    `^/api/badge/${segment}/tickets$`,
    `^/api/event/${segment}(?:/sessions)?$`,
    `^/api/geolocation/${segment}$`,
  ].some((pattern) => new RegExp(pattern, 'u').test(path));
}

/**
 * Internal allowlisted, form-body transport with one sequential queue per instance.
 *
 * @remarks
 * All wire requests are POSTs; logical reads/deletes use the X-HTTP-Method query
 * override. Parameters, including read session IDs, stay in the form body.
 * The documented logout path is the token-bearing URL exception. Cookies are
 * omitted, redirects rejected, caching disabled, and referrers suppressed.
 * HTTP/envelope errors map to safe codes without exposing upstream details.
 */
export class Transport {
  private tail: Promise<void> = Promise.resolve();
  private lastStart: number | null = null;

  /**
   * Queues an allowlisted logical request and unwraps its non-null result.
   *
   * @param path - Encoded API path, not an arbitrary relationship URL.
   * @param method - Logical API verb, independently checked against the path.
   * @param parameters - Form fields used for every attempt; do not mutate while pending.
   * @param operation - Shared signal, deadline, and 1,000-attempt budget.
   * @param expire - Invalidates the current client session on a mapped expiry error.
   * @returns The untrusted result payload, still requiring domain validation.
   * @throws {@link ApiError} - Promise rejection for transport/status/envelope
   * failures, cancellation, timeout, or exhausted budgets. Invalid record fields
   * can instead reject with InvalidData for the client to map.
   * @remarks
   * Starts are at least 1,100 ms apart. Only logical GETs retry network failures,
   * 452/429, and 500/504, at most twice, waiting at least 2 then 4 seconds or a
   * longer usable Retry-After. Login/logout and timeouts are not retried.
   * Each wire attempt has a 30-second timeout, including reading its JSON body.
   */
  async request(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    parameters: URLSearchParams,
    operation: Operation,
    expire: () => void,
  ): Promise<unknown> {
    if (!allowedPath(path, method)) throw new ApiError('invalid-response');
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.enqueue(() => this.send(path, method, parameters, operation), operation);
      } catch (error) {
        checkOperation(operation);
        if (error instanceof ApiError && error.code === 'session-expired') {
          expire();
          throw error;
        }
        if (method !== 'GET' || !(error instanceof RetryableError) || attempt >= 2) throw error;
        await pause(Math.max(attempt === 0 ? 2000 : 4000, error.retryAfterMs), operation.signal);
      }
    }
  }

  private enqueue<T>(work: () => Promise<T>, operation: Operation): Promise<T> {
    const next = this.tail.then(async () => {
      checkOperation(operation);
      if (this.lastStart !== null) {
        await pause(Math.max(0, this.lastStart + 1100 - Date.now()), operation.signal);
      }
      checkOperation(operation);
      if (operation.requests >= 1000) throw new ApiError('incomplete-refresh');
      operation.requests += 1;
      this.lastStart = Date.now();
      return work();
    });
    this.tail = next.then(() => undefined, () => undefined);
    return abortable(next, operation.signal);
  }

  private async send(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    parameters: URLSearchParams,
    operation: Operation,
  ): Promise<unknown> {
    const controller = new AbortController();
    const cancel = () => controller.abort(abortError(operation.signal));
    operation.signal.addEventListener('abort', cancel, { once: true });
    if (operation.signal.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new ApiError('timeout')), 30_000);
    try {
      const read = async (): Promise<unknown> => {
        let response: Response;
        try {
          response = await fetch(
            `https://tabletop.events${path}${method === 'POST' ? '' : `?X-HTTP-Method=${method}`}`,
            {
              method: 'POST',
              mode: 'cors',
              credentials: 'omit',
              cache: 'no-store',
              redirect: 'error',
              referrerPolicy: 'no-referrer',
              body: parameters,
              signal: controller.signal,
            },
          );
        } catch {
          if (controller.signal.aborted) throw abortError(controller.signal);
          throw new RetryableError('network');
        }
        const delay = retryAfter(response);
        // HTTP errors may have an HTML body. Status still takes precedence over parsing.
        if (response.status === 451) throw statusError(451, delay);
        let decoded: unknown;
        try {
          decoded = await response.json();
        } catch {
          if (!response.ok) throw statusError(response.status, delay);
          throw new ApiError('invalid-response');
        }
        const envelope = record(decoded);
        if (envelope.error !== undefined) {
          const error = record(envelope.error);
          throw statusError(integer(error.code), delay);
        }
        if (!response.ok) throw statusError(response.status, delay);
        if (!Object.hasOwn(envelope, 'result') || envelope.result === null ||
            envelope.result === undefined) throw new ApiError('invalid-response');
        return envelope.result;
      };
      return await abortable(read(), controller.signal);
    } finally {
      clearTimeout(timer);
      operation.signal.removeEventListener('abort', cancel);
    }
  }
}
