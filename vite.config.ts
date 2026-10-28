import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const rawBase = process.env.VITE_BASE_PATH ?? '/';
  if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(rawBase)) {
    throw new Error('VITE_BASE_PATH must be an absolute path ending with a slash.');
  }
  const base = rawBase;
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    base,
    server: { hmr: false },
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        includeManifestIcons: false,
        scope: base,
        manifest: {
          id: base,
          name: 'Convention Companion',
          short_name: 'Companion',
          description: 'Your personal hosted and attending convention agenda. Private by design.',
          start_url: base,
          scope: base,
          display: 'standalone',
          background_color: '#f5f4ee',
          theme_color: '#183d35',
          lang: 'en',
          icons: [
            { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: `${base}icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg}'],
          importScripts: [`${base}sw-privacy.js`],
          navigateFallback: `${base}index.html`,
          navigateFallbackAllowlist: [new RegExp(`^${escapedBase}(?:index\\.html)?(?:\\?.*)?$`)],
          navigateFallbackDenylist: [/\/api(?:\/|$)/],
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
          clientsClaim: false,
          skipWaiting: false,
        },
        devOptions: { enabled: false },
      }),
    ],
    build: { sourcemap: mode === 'development' },
  };
});
