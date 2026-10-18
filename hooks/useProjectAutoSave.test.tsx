// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProjectAutoSave } from './useProjectAutoSave.ts';
import type { ProjectState } from '../types.ts';

type Options = Parameters<typeof useProjectAutoSave>[0];
const initial: ProjectState = {
  id: 'project', title: 'Initial', layers: [], selectedLayerId: null, updatedAt: 1,
  background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 },
  canvasConfig: { width: 100, height: 100, ratio: '1:1' }
};
const roots = new Set<Root>();

async function mount(overrides: Partial<Options> = {}) {
  let result: ReturnType<typeof useProjectAutoSave>;
  let options: Options = {
    project: initial, view: 'editor', storageReadyRef: { current: true }, isCloudMode: false, isTauri: false,
    activeLocalFilePath: null, savedMessage: 'Saved', saveFailedMessage: 'Failed',
    storageAdapter: { type: 'indexeddb', isAvailable: () => true, ensureReady: async () => true,
      listProjects: async () => ({ items: [], total: 0 }), saveProject: vi.fn(async () => {}), deleteProject: async () => {} },
    saveLocalProjectToFile: vi.fn(async (_path, project) => project), clearActiveLocalFilePath: vi.fn(),
    showToast: vi.fn(), reportStorageError: vi.fn(), ...overrides
  };
  function Harness({ current }: { current: Options }) {
    result = useProjectAutoSave(current);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.add(root);
  const render = async (changes: Partial<Options> = {}) => {
    options = { ...options, ...changes };
    await act(async () => root.render(<Harness current={options} />));
  };
  await render();
  return { getResult: () => result!, render, options, root };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
});

afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount(); });
  roots.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['indexeddb', 'localfile'] as const)('coalesces %s writes for five seconds and reads the latest snapshot', async type => {
  const harness = await mount();
  harness.options.storageAdapter.type = type;
  const save = vi.mocked(harness.options.storageAdapter.saveProject);
  expect(save).not.toHaveBeenCalled();
  await harness.render({ project: { ...initial, title: 'First' } });
  expect(save).toHaveBeenCalledTimes(1);
  await harness.render({ project: { ...initial, title: 'Intermediate' } });
  await harness.render({ project: { ...initial, title: 'Latest' } });
  await act(async () => vi.advanceTimersByTime(4999));
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(1));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0].title).toBe('Latest');
});

it('manual and unload saves bypass the delay without saving an unchanged snapshot again', async () => {
  const harness = await mount();
  const save = vi.mocked(harness.options.storageAdapter.saveProject);
  await harness.render({ project: { ...initial, title: 'First' } });
  await harness.render({ project: { ...initial, title: 'Manual' } });
  await act(async () => harness.getResult().performAutoSave('manual'));
  expect(save).toHaveBeenCalledTimes(2);
  expect(harness.options.showToast).toHaveBeenCalledWith('Saved');
  await act(async () => vi.advanceTimersByTime(5000));
  expect(save).toHaveBeenCalledTimes(2);
  await harness.render({ project: { ...initial, title: 'Unload' } });
  await harness.render({ project: { ...initial, title: 'Unload latest' } });
  await act(async () => window.dispatchEvent(new Event('beforeunload')));
  expect(save.mock.calls.at(-1)![0].title).toBe('Unload latest');
});

it('does not autosave cloud projects but supports explicit persistence and leave saves', async () => {
  const harness = await mount({ isCloudMode: true });
  const next = { ...initial, title: 'Cloud' };
  await harness.render({ project: next });
  expect(harness.options.storageAdapter.saveProject).not.toHaveBeenCalled();
  await act(async () => harness.getResult().persistProject(next));
  await act(async () => harness.getResult().performAutoSave('manual'));
  expect(harness.options.storageAdapter.saveProject).toHaveBeenCalledTimes(1);
  await harness.render({ project: { ...next, title: 'Leave' } });
  await harness.render({ view: 'landing' });
  expect(harness.options.storageAdapter.saveProject).toHaveBeenCalledTimes(2);
  expect(harness.options.clearActiveLocalFilePath).toHaveBeenCalledOnce();
});

it('uses only the Tauri file path for manual/leave saves even when the adapter is not ready', async () => {
  const harness = await mount({ isTauri: true, activeLocalFilePath: 'cover.cfj', storageReadyRef: { current: false } });
  const next = { ...initial, title: 'Native' };
  await harness.render({ project: next });
  await act(async () => vi.advanceTimersByTime(5000));
  expect(harness.options.saveLocalProjectToFile).not.toHaveBeenCalled();
  await act(async () => harness.getResult().performAutoSave('manual'));
  expect(harness.options.saveLocalProjectToFile).toHaveBeenCalledWith('cover.cfj', next);
  expect(harness.options.storageAdapter.saveProject).not.toHaveBeenCalled();
});

it('reports a failed write once and does not retry on unrelated rerenders', async () => {
  const harness = await mount();
  const error = new Error('Quota exceeded');
  vi.mocked(harness.options.storageAdapter.saveProject).mockRejectedValue(error);
  await harness.render({ project: { ...initial, title: 'Dirty' } });
  await harness.render();
  await act(async () => vi.advanceTimersByTime(10000));
  expect(harness.options.storageAdapter.saveProject).toHaveBeenCalledOnce();
  expect(harness.options.reportStorageError).toHaveBeenCalledWith(error, 'save-auto', 'Failed', initial.id);
});

it('cancels pending work on backend changes, explicit deletion and unmount', async () => {
  const harness = await mount();
  const save = vi.mocked(harness.options.storageAdapter.saveProject);
  await harness.render({ project: { ...initial, title: 'First' } });
  await harness.render({ project: { ...initial, title: 'Pending' } });
  await act(async () => harness.getResult().cancelPendingSave());
  await act(async () => vi.advanceTimersByTime(5000));
  expect(save).toHaveBeenCalledTimes(1);
  await harness.render({ project: { ...initial, title: 'Saved again' } });
  await harness.render({ project: { ...initial, title: 'Pending again' } });
  const replacement = { ...harness.options.storageAdapter, saveProject: vi.fn(async () => {}) };
  await harness.render({ storageAdapter: replacement, view: 'landing' });
  const callsAfterSwitch = save.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(5000));
  expect(save).toHaveBeenCalledTimes(callsAfterSwitch);
  await harness.render({ view: 'editor', project: { ...initial, title: 'Final' } });
  await harness.render({ project: { ...initial, title: 'Unmount pending' } });
  await act(async () => harness.root.unmount());
  roots.delete(harness.root);
  const callsAfterUnmount = replacement.saveProject.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(5000));
  expect(replacement.saveProject).toHaveBeenCalledTimes(callsAfterUnmount);
});