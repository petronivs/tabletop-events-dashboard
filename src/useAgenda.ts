import { useEffect, useRef, useState } from 'react';
import { ApiError } from './api';
import type { ScheduleClient } from './api';
import type {
  ApiErrorCode, BadgeChoice, ConventionChoice, DeveloperCredentials, ScheduleSelection, ScheduleSnapshot,
} from './domain';

const errorText: Record<ApiErrorCode, string> = {
  'not-authenticated': 'Please sign in again to continue.',
  'session-expired': 'Your session expired. Your personal data has been cleared. Please sign in again.',
  'sign-in-failed': 'Sign-in failed. Check your developer username, password, and API key ID.',
  'access-denied': 'Tabletop.events did not allow this account to access the requested data.',
  network: 'Could not reach Tabletop.events. Check your connection. The service or its browser access policy may also be unavailable.',
  timeout: 'Tabletop.events took too long to respond. Please try again.',
  'rate-limited': 'Tabletop.events is limiting requests. Please wait before trying again.',
  'service-unavailable': 'Tabletop.events is temporarily unavailable. Please try again later.',
  'invalid-response': 'Tabletop.events returned data this app could not safely read. Nothing incomplete has been shown.',
  'incomplete-refresh': 'The complete agenda could not be verified. Please try again; no partial update has been shown.',
  'invalid-selection': 'This convention or badge selection is no longer available. Choose your badges again.',
  aborted: 'The request was cancelled.',
  busy: 'Another request is finishing. Please try again in a moment.',
};

interface PersonalState {
  conventions: readonly ConventionChoice[];
  conventionsReady: boolean;
  conventionId: string;
  badges: readonly BadgeChoice[];
  badgeIds: readonly string[];
  badgesReady: boolean;
  snapshot: ScheduleSnapshot | null;
}

const emptyPersonal = (): PersonalState => ({
  conventions: [], conventionsReady: false, conventionId: '', badges: [], badgeIds: [], badgesReady: false, snapshot: null,
});

/** Builds a comparison key independent of badge order or duplicate badge IDs. */
export function selectionKey(selection: ScheduleSelection): string {
  return JSON.stringify([selection.conventionId, [...new Set(selection.badgeIds)].sort()]);
}

/**
 * Coordinates memory-only personal state, explicit badge selection, and manual reads.
 *
 * @param client - A stable client created outside React rendering; this hook owns
 * the UI snapshot, not the client's session token.
 * @returns Current selection, snapshot, safe status text, and user-action handlers.
 * Async handlers report failures through `error` rather than rejecting API errors.
 * `credentialEpoch` lets the sign-in form discard credentials on logout or expiry.
 * @remarks
 * Login clears personal state and discovers conventions after success. No badge
 * is selected automatically; an empty set loads hosting only. Convention/badge
 * changes erase the snapshot immediately. A same-selection refresh keeps the
 * previous complete snapshot and timestamp while loading and on failures other
 * than `not-authenticated` or `session-expired`, including selection-validation
 * failures. Those two error codes, logout, and login erase personal state.
 * Successful discovery also resets the selection and snapshot; failed discovery
 * leaves them intact unless one of those two authentication errors occurs.
 *
 * Replacement reads abort and await prior work before entering the client's
 * single-read boundary. Generation and mounted checks ignore late results.
 * Unmount aborts active reads, but does not revoke the client session. Offline
 * status is advisory: handlers do not enforce it; the UI disables network actions.
 * Nothing is persisted or restored after reload.
 */
export function useAgenda(client: ScheduleClient) {
  const [personal, setPersonal] = useState<PersonalState>(emptyPersonal);
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [credentialEpoch, setCredentialEpoch] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const generation = useRef(0);
  const active = useRef<{ controller: AbortController; settled: Promise<void> } | null>(null);
  const working = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    generation.current++;
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      mounted.current = false;
      active.current?.controller.abort();
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  function invalidate() {
    const previous = active.current;
    previous?.controller.abort();
    generation.current++;
    return { previous, current: generation.current };
  }

  function report(cause: unknown) {
    const code = cause instanceof ApiError ? cause.code : null;
    if (code === 'aborted') return;
    if (code === 'not-authenticated' || code === 'session-expired') {
      invalidate();
      setAuthenticated(false);
      setPersonal(emptyPersonal());
      setCredentialEpoch((value) => value + 1);
    }
    setError(code ? errorText[code] : 'Something went wrong. Please try again. No technical or account details are displayed.');
  }

  /**
   * Serializes replacement reads and maps current-generation errors into UI state.
   * Only the active controller may release the busy state during cleanup.
   */
  function read(
    label: string,
    action: (signal: AbortSignal) => Promise<void>,
    context = invalidate(),
  ): Promise<void> {
    const controller = new AbortController();
    const { previous, current } = context;
    working.current = true;
    setBusy(label);
    setError('');
    const settled = (async () => {
      // Replacements wait for aborted work to release the client's single-read boundary.
      await previous?.settled;
      if (current !== generation.current || !mounted.current) return;
      try {
        await action(controller.signal);
      } catch (cause) {
        if (current === generation.current && mounted.current) report(cause);
      } finally {
        if (active.current?.controller === controller) {
          active.current = null;
          working.current = false;
          if (mounted.current) setBusy(null);
        }
      }
    })();
    active.current = { controller, settled };
    return settled;
  }

  async function discover() {
    if (working.current) return;
    const context = invalidate();
    await read('Finding your conventions…', async (signal) => {
      const conventions = await client.listConventions({ signal });
      if (context.current === generation.current && mounted.current) {
        setPersonal({ ...emptyPersonal(), conventions, conventionsReady: true });
      }
    }, context);
  }

  async function login(input: DeveloperCredentials) {
    if (working.current) return;
    const context = invalidate();
    let signedIn = false;
    setPersonal(emptyPersonal());
    setAuthenticated(false);
    setNotice('');
    await read('Signing in…', async (signal) => {
      await client.login(input, { signal });
      if (context.current !== generation.current || !mounted.current) return;
      signedIn = true;
      setAuthenticated(true);
    }, context);
    if (signedIn && context.current === generation.current && mounted.current && client.getSessionState() === 'authenticated') {
      void discover();
    }
  }

  function chooseConvention(conventionId: string) {
    const context = invalidate();
    setError('');
    setPersonal((value) => ({
      ...emptyPersonal(), conventions: value.conventions, conventionsReady: value.conventionsReady, conventionId,
    }));
    if (!conventionId) {
      working.current = false;
      setBusy(null);
      return;
    }
    void read('Finding your badges…', async (signal) => {
      const badges = await client.listBadges(conventionId, { signal });
      if (context.current === generation.current && mounted.current) {
        setPersonal((value) => ({ ...value, badges, badgesReady: true }));
      }
    }, context);
  }

  function chooseBadge(badgeId: string, checked: boolean) {
    invalidate();
    working.current = false;
    setBusy(null);
    setError('');
    setPersonal((value) => ({
      ...value,
      badgeIds: checked
        ? [...new Set([...value.badgeIds, badgeId])].sort()
        : value.badgeIds.filter((id) => id !== badgeId),
      snapshot: null,
    }));
  }

  async function refresh() {
    if (working.current || !personal.badgesReady) return;
    const selection = { conventionId: personal.conventionId, badgeIds: [...personal.badgeIds] };
    const context = invalidate();
    await read('Loading your complete agenda…', async (signal) => {
      const snapshot = await client.loadSchedule(selection, { signal });
      if (context.current === generation.current && mounted.current) {
        if (selectionKey(snapshot.selection) !== selectionKey(selection)) {
          throw new ApiError('invalid-response');
        }
        setPersonal((value) => ({ ...value, snapshot }));
      }
    }, context);
  }

  /**
   * Erases personal/form state before waiting for best-effort server sign-out.
   * Revocation failure becomes a notice, not restored authentication.
   */
  async function logout() {
    const context = invalidate();
    active.current = null;
    setPersonal(emptyPersonal());
    setAuthenticated(false);
    setCredentialEpoch((value) => value + 1);
    setError('');
    setNotice('');
    working.current = true;
    setBusy('Signing out…');
    try {
      const result = await client.logout();
      if (context.current === generation.current && mounted.current) {
        setNotice(result.revocation === 'unconfirmed'
          ? 'Signed out here; server session revocation could not be confirmed. Your personal data has been cleared from this page.'
          : 'Signed out. Your personal data has been cleared from this page.');
      }
    } catch {
      if (context.current === generation.current && mounted.current) {
        setNotice('Signed out here; server session revocation could not be confirmed.');
      }
    } finally {
      if (context.current === generation.current) {
        active.current = null;
        working.current = false;
        if (mounted.current) setBusy(null);
      }
    }
  }

  return {
    ...personal, authenticated, busy, error, notice, online, credentialEpoch,
    login, logout, discover, chooseConvention, chooseBadge, refresh,
  };
}
