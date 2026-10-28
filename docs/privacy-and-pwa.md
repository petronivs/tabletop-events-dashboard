# Session privacy and PWA behavior

## Trust boundary

The UI imports only the public `src/api/index.ts` and `src/domain/index.ts` contracts. One client is created outside React rendering in `src/main.tsx`. Only that client handles credentials, session IDs, TTE network requests, response validation, membership, pagination, and normalization.

Developer credentials are entered at runtime, never bundled in configuration. Sign-in fields clear when an attempt settles; cancellation and logout discard the form immediately. The client keeps a validated session in closure memory, with no automatic password retry or remembered login. Browser password-manager behavior is outside the app’s control.

All personal state is React/closure memory. There is no authentication or agenda storage in localStorage, sessionStorage, IndexedDB, cookies set by this app, worker messages, URLs, or Cache Storage. Never save an agenda as a fixture, build asset, screenshot, log, or team note. Tests use synthetic records only.

Changing selections aborts old work, clears the visible snapshot, waits for the old read to settle before starting its replacement, and checks a UI generation before publishing results. The API has its own generation guard. Refresh errors can preserve only a complete previous snapshot for the same account/selection; the original refresh timestamp stays visible. Session expiry and logout clear personal state rather than treating it as stale.

Logout attempts server revocation once; an offline/failed result is shown as unconfirmed. Reload, navigation, tab termination, and browser shutdown cannot promise server revocation. They lose access to the client’s in-memory token but do not prove the remote session ended.

## Worker and offline contract

`vite-plugin-pwa` uses Workbox `generateSW` to precache local versioned app-shell files only: HTML, JavaScript, CSS, icons, and the manifest. No runtime cache strategies, background sync, polling, keepalive, or personal offline snapshots are configured.

`public/sw-privacy.js` runs before Workbox’s fetch listeners. It leaves all cross-origin, outside-base, and `/api/` requests entirely to the browser/network. This explicit origin guard matters because Workbox’s navigation allowlist matches pathnames, not origins. Within the app base, navigation fallback allows only the app entry URL and `index.html`; arbitrary paths/API URLs do not receive the shell fallback.

- **Warm document offline:** a previously loaded same-selection agenda can remain visible from memory, marked stale with the last successful refresh timestamp.
- **Cold start offline:** the cached shell may open after a successful worker install, but contains no personal data or sign-in. Reconnect and sign in again.
- **Install:** the button appears only when the browser supplies an install prompt. Other browsers may offer Add to Home Screen; this is not guaranteed.
- **Update:** a waiting worker prompts the user. Nothing auto-reloads a signed-in tab. The explicit update action signs out before activating the worker and reloading.
- **Storage eviction/private mode/registration failure:** shell availability is not guaranteed; the app can still be used online. Uninstalling clears browser-managed shell storage according to browser behavior.

The HTML has a restrictive self-only asset/worker CSP with TTE HTTPS connectivity and a no-referrer policy. No inline script/style exceptions, external fonts, remote icons, analytics, unsafe HTML, or router are used. Developer hot reload is disabled so the same CSP remains usable locally.

## Validation and remaining acceptance

Automated checks:

```bash
npm run coverage
npm run lint
npm run build
npm run test:pwa
VITE_BASE_PATH=/convention-companion/ npm run build
VITE_BASE_PATH=/convention-companion/ npm run test:pwa
```

The PWA output check asserts icon dimensions, base paths, manifest/worker registration, CSP/no-referrer, local shell precache, restricted navigation, and executes the fetch privacy guard against synthetic URLs. Unit tests cover credentials, safe errors, selection/refresh races, stale timestamps, expiry/logout, convention-zone display and DST, filters, empty/loading views, warm/cold offline messages, and update/install consent.

These are not a substitute for real-browser/device and authenticated integration acceptance:

1. On a voluntary developer-account sign-in, verify login-response CORS and body-session authorization. Never send credentials to reviewers or commit them.
2. Compare discovered conventions, hosting-only, each explicitly selected owned badge’s confirmed tickets, both-role events, additional sessions, timezone, and slot durations with the real TTE schedule. Validate private projections, self-hosted access, and ticket qualifiers rather than assuming public probes prove them.
3. On desktop and mobile browsers, test keyboard/screen-reader flow, zoom, touch targets, contrast, long labels, and landscape layout.
4. Preview the production build over localhost/HTTPS; inspect installability, cache contents, offline warm versus cold starts, worker update confirmation, and Pages subpath navigation. Ensure all TTE requests bypass the worker and no private data appears in browser-managed app storage.
5. Check expiry, disconnect/refresh, sign-out revocation warnings, and close/reopen behavior. An installed app must not claim saved personal data.

Basic real developer sign-in, convention selection, event loading, Windows PWA, and offline use have been user-verified. Independent synthetic Chromium checks also passed at root and non-root paths, including mobile emulation and service-worker-controlled cold/warm offline use. Detailed real-schedule comparison, private API edge cases, physical mobile devices, broader accessibility/browser coverage, and the complete waiting-worker/multi-tab update lifecycle remain open; deployment does not certify those checks.
