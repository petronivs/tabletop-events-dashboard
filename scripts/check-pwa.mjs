import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const base = process.env.VITE_BASE_PATH ?? '/';
const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
for (const name of ['id', 'scope', 'start_url']) assert.equal(manifest[name], base, name);
for (const icon of manifest.icons) {
  assert.ok(icon.src.startsWith(base), icon.src);
  const bytes = readFileSync(resolve('dist', icon.src.slice(base.length)));
  const size = Number(icon.sizes.split('x')[0]);
  assert.equal(bytes.readUInt32BE(16), size, 'PNG width');
  assert.equal(bytes.readUInt32BE(20), size, 'PNG height');
}
assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
const html = readFileSync('dist/index.html', 'utf8');
assert.match(html, /name="referrer" content="no-referrer"/);
assert.match(html, /Content-Security-Policy/);
assert.ok(!html.includes("'unsafe-inline'") && !html.includes("'unsafe-eval'"));
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = match[1];
  assert.ok(url.startsWith(base), `asset outside base: ${url}`);
}
const sw = readFileSync('dist/sw.js', 'utf8');
assert.ok(sw.includes(`${base}sw-privacy.js`), 'privacy guard imported');
assert.ok(sw.includes(`${base}index.html`), 'fallback uses base');
assert.ok(!/https:\/\/tabletop\.events|NetworkFirst|StaleWhileRevalidate|BackgroundSync/.test(sw));
const urls = [...sw.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);
assert.ok(urls.length > 4, 'shell precache entries present');
assert.equal(new Set(urls).size, urls.length, 'shell precache has no duplicate URLs');
for (const url of urls) {
  assert.ok(!/^(?:https?:|\/\/)|(?:^|\/)api(?:\/|$)/.test(url), `non-shell precache: ${url}`);
  assert.ok(!url.startsWith('/'), `precache should resolve relative to worker: ${url}`);
}
assert.ok(sw.includes('allowlist:') && sw.includes('denylist:'), 'navigation is restricted');
let navigation;
const workbox = {
  precacheAndRoute() {},
  cleanupOutdatedCaches() {},
  createHandlerBoundToURL() { return () => {}; },
  NavigationRoute: class {
    constructor(_handler, options) { navigation = options; }
  },
  registerRoute() {},
};
const define = (_dependencies, factory) => factory(workbox);
runInNewContext(sw, {
  define, importScripts() {},
  self: { define, addEventListener() {} },
});
assert.ok(navigation, 'generated navigation route executes');
for (const [pathname, matches] of [
  [base, true], [`${base}index.html`, true], [`${base}?installed=1`, true],
  [`${base}index.html?installed=1`, true], [`${base}api/session`, false],
  [`${base}arbitrary-route`, false], ['/outside/index.html', false],
]) {
  const allowed = navigation.allowlist.some((regex) => regex.test(pathname))
    && !navigation.denylist.some((regex) => regex.test(pathname));
  assert.equal(allowed, matches, `generated navigation fallback: ${pathname}`);
}
const assets = readdirSync('dist/assets').filter((name) => name.endsWith('.js'));
assert.ok(assets.some((name) => readFileSync(`dist/assets/${name}`, 'utf8').includes(`${base}sw.js`)), 'registration uses base');

let fetchGuard;
runInNewContext(readFileSync('public/sw-privacy.js', 'utf8'), {
  URL,
  self: {
    registration: { scope: `https://companion.invalid${base}` },
    addEventListener(name, callback) { if (name === 'fetch') fetchGuard = callback; },
  },
});
assert.equal(typeof fetchGuard, 'function');
for (const [url, blocked] of [
  [`https://companion.invalid${base}`, false],
  [`https://companion.invalid${base}index.html`, false],
  [`https://companion.invalid${base}assets/app.js`, false],
  [`https://companion.invalid${base}api/session`, true],
  ['https://companion.invalid/api/session', true],
  ['https://tabletop.events/api/session', true],
  [`https://tabletop.events${base}`, true],
  ['https://elsewhere.invalid/index.html', true],
  ...(base === '/' ? [] : [['https://companion.invalid/outside/', true]]),
]) {
  let stopped = false;
  fetchGuard({ request: { url }, stopImmediatePropagation() { stopped = true; } });
  assert.equal(stopped, blocked, `fetch guard: ${url}`);
}
console.log(`PWA checks passed for ${base}: local shell assets, PNG icons, manifest, scope, restrictive CSP, and API/cross-origin fetch exclusions.`);
