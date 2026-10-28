import { vi } from 'vitest';

export const callbacks: {
  onNeedRefresh?: () => void;
  onNeedReload?: () => void;
  onOfflineReady?: () => void;
  onRegisterError?: () => void;
} = {};
export const applyUpdate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
export const registerSW = vi.fn((options: typeof callbacks) => {
  Object.assign(callbacks, options);
  return applyUpdate;
});
