// This runs before Workbox registers fetch listeners. NavigationRoute itself
// matches pathnames, so explicitly keep cross-origin and API traffic outside it.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (
    url.origin !== scope.origin
    || !url.pathname.startsWith(scope.pathname)
    || /\/api(?:\/|$)/.test(url.pathname)
  ) {
    event.stopImmediatePropagation();
  }
});
