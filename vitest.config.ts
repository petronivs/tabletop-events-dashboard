import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'virtual:pwa-register': fileURLToPath(new URL('./src/test/pwa-register.ts', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
      reporter: ['text', 'html', 'json-summary'],
    },
  },
});
