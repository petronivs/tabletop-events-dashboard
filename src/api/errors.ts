import type { ApiErrorCode } from '../domain';

const messages: Record<ApiErrorCode, string> = {
  'not-authenticated': 'Sign in with a developer account to continue.',
  'session-expired': 'Your session expired. Please sign in again.',
  'sign-in-failed': 'Developer account sign-in failed. Check your account and API key ID.',
  'access-denied': 'This account does not have access to the requested data.',
  network: 'Unable to reach Tabletop.events. Check your connection and try again.',
  timeout: 'The request timed out. Please try again.',
  'rate-limited': 'Tabletop.events is limiting requests. Please try again later.',
  'service-unavailable': 'Tabletop.events is temporarily unavailable.',
  'invalid-response': 'Tabletop.events returned unsupported or invalid data.',
  'incomplete-refresh': 'The complete schedule could not be verified. Please refresh again.',
  'invalid-selection': 'The convention or badge selection is no longer available.',
  aborted: 'The operation was cancelled.',
  busy: 'Another schedule operation is still running.',
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode) {
    super(messages[code]);
    this.name = 'ApiError';
    this.code = code;
  }
}

export class RetryableError extends ApiError {
  readonly retryAfterMs: number;

  constructor(code: 'network' | 'rate-limited' | 'service-unavailable', retryAfterMs = 0) {
    super(code);
    this.retryAfterMs = retryAfterMs;
  }
}
