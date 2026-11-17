export function isTauriRuntime(): boolean {
  // Match @tauri-apps/api/core's isTauri without loading the API during render.
  return import.meta.env.VITE_APP_MODE === 'tauri' || ('isTauri' in globalThis && Boolean(globalThis.isTauri));
}
