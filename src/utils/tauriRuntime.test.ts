import { afterEach, expect, it, vi } from 'vitest';
import { isTauri } from '@tauri-apps/api/core';
import { isTauriRuntime } from './tauriRuntime.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('matches Tauri runtime detection in browser and desktop environments', () => {
  vi.stubEnv('VITE_APP_MODE', 'web');
  for (const value of [undefined, false, true]) {
    vi.stubGlobal('isTauri', value);
    expect(isTauriRuntime()).toBe(isTauri());
  }
});

it('recognizes the configured Tauri mode even without the runtime marker', () => {
  vi.stubEnv('VITE_APP_MODE', 'tauri');
  vi.stubGlobal('isTauri', undefined);
  expect(isTauriRuntime()).toBe(true);
});
