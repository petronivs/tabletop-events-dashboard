# Convention Companion

A mobile-first personal convention agenda for Tabletop.events. Combine events you host with confirmed event tickets from the badges you explicitly select. Filter by day, role, event, or location; times use the convention’s timezone.

**MVP integration status:** synthetic unit tests and Chromium root/subpath, responsive, and offline checks passed. Basic real developer sign-in, convention selection, event loading, Windows PWA, and offline use have been user-verified. Detailed schedule accuracy, private response edge cases, physical mobile devices, and broader browser/accessibility checks remain to be verified. There is no demo-data fallback.

## Run locally

Use Node.js 24 LTS (24.15 or newer) and npm, inside WSL if using the existing WSL checkout.

```bash
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Hot reload is intentionally disabled to preserve the strict CSP without inline script/style exceptions. Reload manually after edits; reloading also discards your memory-only sign-in and agenda.

```bash
npm run typecheck
npm run lint
npm test
npm run coverage
npm run build
npm run test:pwa
npm run preview
```

`coverage/` contains the HTML coverage report. `dist/` contains the static site. Both are ignored. UI/API/domain tests use synthetic, memory-only fixtures; they never contact Tabletop.events.

For install/offline behavior, use the production build and preview URL. The worker is disabled during development. Service workers require HTTPS or localhost.

## Sign in and choose an agenda

1. Enable developer access and obtain your own **API key ID**, following the [official Tabletop.events guide](https://tabletop.events/developer/APIKey.html). Do **not** enter a private key.
2. Enter your developer username, password, and API key ID in the app. This is developer-account sign-in, not ordinary TTE SSO.
3. Choose a real convention discovered from your verified owned badges and hosted events.
4. Explicitly check attending badges. **No badges selected means hosting only.** Other family/friend badges are not automatically merged.
5. Select **Load my agenda**. Refresh manually when needed; large schedules can take minutes because API requests are deliberately spaced.

Both hosting and confirmed-ticket roles can appear on one event. Membership applies to each of the event’s sessions. Cancelled, removed, unpublished, and unscheduled entries stay visible. Missing times and locations remain unknown rather than being guessed.

### Privacy and limits

- Credentials go directly to `https://tabletop.events` through the API client; there is no app server, shared API key, analytics, or third-party font/script.
- Fields clear after success, failure, or cancellation. The app does not save credentials; your browser’s password manager is independently controlled by you.
- Session IDs, badge selections, and agendas live **only in this document’s memory**. No remember-me, cross-tab sharing, reload recovery, localStorage, sessionStorage, or IndexedDB.
- Sign out clears local personal data immediately and attempts server revocation once. A failed/offline revocation is reported honestly. Closing/reloading is **not** a guarantee that the server session was revoked.
- Installation saves only the app shell. The same open tab can display its current agenda offline, visibly stale. A reopened/cold-start app has no saved login or personal agenda.
- Refresh failures retain a previous agenda only for the same account and exact selection, with its actual last successful refresh time. Changing badges, convention, account, or an expired session clears personal data.
- Worker updates are offered, never forced. Applying one explicitly signs out and reloads; memory-only data is lost.

See [privacy, PWA, and acceptance details](docs/privacy-and-pwa.md) and the [API research notes](docs/tabletop-events-api.md).

## GitHub Pages / another static host

Source: [petronivs/tabletop-events-dashboard](https://github.com/petronivs/tabletop-events-dashboard). Live app: [Convention Companion](https://petronivs.github.io/tabletop-events-dashboard/). Pages uses **Settings → Pages → Source: GitHub Actions**.

For a project site, build with its exact pathname (leading and trailing slash):

```bash
VITE_BASE_PATH=/your-repository/ npm run build
VITE_BASE_PATH=/your-repository/ npm run test:pwa
VITE_BASE_PATH=/your-repository/ npm run preview
```

Visit the preview URL **including `/your-repository/`** and use the same base for build and preview. The build base, asset URLs, worker scope, manifest `id`, `scope`, and `start_url` all use that path. Root/user/custom-domain sites normally use `/` (the default). Do not put credentials in any `VITE_*` setting; those values are public.

The **Deploy to GitHub Pages** workflow runs automatically on **pushes to `main`** and can also be started manually (`workflow_dispatch`). It gates deployment on lint, tests/coverage, typecheck/build, and PWA output checks, then publishes only `dist/`. It derives the base from GitHub’s Pages configuration and uses the `github-pages` deployment environment. Set an environment approval rule if desired.

For another static host, serve `dist/` over HTTPS at the configured base. No history router, API proxy, or backend is needed. The document ships a restrictive CSP and no-referrer policy; a host supporting headers should additionally send `frame-ancestors 'none'` and `X-Content-Type-Options: nosniff` (frame-ancestors cannot be enforced by an HTML meta policy).

Regenerate the original local app icons with `node scripts/generate-icons.mjs`; no image/font service is used.
