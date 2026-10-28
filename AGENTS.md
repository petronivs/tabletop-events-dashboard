# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Copilot, Cursor, etc.) working in this repo.

## Project

A dashboard built on top of [Tabletop.events](https://tabletop.events) data (convention events, badges, schedules, etc.).

- **Status:** implemented MVP; basic live login/event loading, Windows PWA and offline use user-verified. Detailed schedule correctness and physical mobile acceptance remain open.
- **Goal:** a mobile/desktop personal agenda combining hosted events and confirmed tickets from explicitly selected owned badges.

## Stack

React 19, strict TypeScript 6, Vite 8, npm lockfile, native fetch/Intl, and CSS. Vitest 4 + Testing Library + jsdom + v8 coverage; ESLint with TypeScript and React hooks rules. Installable PWA via `vite-plugin-pwa` / Workbox `generateSW`. Static GitHub Pages target; no app server or router.

## Commands

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run coverage
npm run build
npm run test:pwa
npm run preview
# Non-root Pages acceptance:
VITE_BASE_PATH=/tabletop-events-dashboard/ npm run build
VITE_BASE_PATH=/tabletop-events-dashboard/ npm run test:pwa
```

Use Node.js 24 LTS (24.15+) or a compatible newer Node release. Development HMR is disabled to keep the strict CSP without inline script/style exceptions; reload manually. PWA behavior requires a production build on HTTPS/localhost, not the dev server.

## Tabletop.events API

- API docs: https://tabletop.events/developer/Introduction.html (bare `/developer` returns 404)
- Our notes on using the API, with caveats: [docs/tabletop-events-api.md](docs/tabletop-events-api.md). Read this before writing API code, and add to it when you learn something new.
- [Session privacy, PWA behavior, and live acceptance](docs/privacy-and-pwa.md) documents the memory-only boundary and offline limits.
- [README](README.md) covers setup, sign-in, commands, and Pages deployment on pushes to `main` or manual dispatch. The workflow preserves lint, coverage, typecheck/build and PWA gates; only `dist/` is deployed.
- Never commit API keys, session IDs, passwords, or personal schedules. Runtime developer credentials are entered only in the UI, not `.env` or `VITE_*` configuration. Never read secret files.
- Frontend consumes only `src/api/index.ts` and `src/domain/index.ts`; do not fetch TTE or handle tokens outside the client. Instantiate one client outside React rendering.
- Be polite to the API: one sequential queue spaces request starts by at least 1,100 ms. Manual refresh only; no polling or automatic login retries.
- Auth, badges, selections, and agendas are memory-only. Do not add localStorage/sessionStorage/IndexedDB, URL state, worker messaging, runtime/API caches, or background sync. Worker caches only local shell assets.
- Badge selection is explicit; none means hosting only. Changing account/selection and session expiry clear personal data. Failed same-selection refresh can retain a visibly stale complete snapshot with its original timestamp.

## Environment notes

- When using a WSL checkout also edited from Windows, run tooling (installs, builds, tests) inside WSL so paths, line endings, and file permissions stay consistent.
- Quote checkout paths in scripts; folder names may contain spaces and dots.
- Use LF line endings.

## Conventions

- Keep changes small and focused; match the style of surrounding code.
- Update this file when you add commands, change the stack, or learn something future agents need to know.

### Source documentation

- Maintain targeted [TSDoc](https://tsdoc.org/) `/** ... */` comments on exported APIs, hooks/components, and non-obvious contracts so editor IntelliSense hover/signature help explains usage and side effects.
- Keep summaries concise; use `@remarks`, `@param name - description`, `@returns`, `@throws`, and `{@link ...}` only when useful. Explain promise rejections explicitly; do not repeat TypeScript types or blanket-comment obvious helpers.
- Update comments with behavior changes, especially session privacy, cancellation, selection/stale-data rules, and UTC/convention-zone handling.

## Repository workflow

- Before changes, search for an existing GitHub tracking issue; reuse it or create one if none covers the work.
- Sync `main`, then create an issue-linked feature branch: `squad/{issue-number}-{slug}`.
- Open a PR targeting `main` with `Closes #N`. Do not push directly to or merge into `main` without explicit authorization; pushes to `main` deploy automatically.
