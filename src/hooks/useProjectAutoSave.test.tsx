// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProjectAutoSave } from './useProjectAutoSave.ts';
import type { ProjectState } from '../types.ts';
import { selectProjectPage } from '../utils/projectPages.ts';
import { Blob as NodeBlob } from 'node:buffer';
import { imageAssets } from '../storage/imageAssets.ts';

type Options = Parameters<typeof useProjectAutoSave>[0];
const initial: ProjectState = { id: 'project', title: 'Initial', layers: [], selectedLayerId: null, updatedAt: 1, pageInfo: { ...({ width: 100, height: 100 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } }, activePageId: 'page', pages: [{ id: 'page', name: '', layers: [], pageInfo: { ...({ width: 100, height: 100 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } }] };
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
  vi.restoreAllMocks();
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
  const stringify = vi.spyOn(JSON, 'stringify');
  stringify.mockClear();
  await harness.render({ project: { ...initial, title: 'Intermediate' } });
  await harness.render({ project: { ...initial, title: 'Latest' } });
  expect(stringify).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(4999));
  expect(save).toHaveBeenCalledTimes(1);
  expect(stringify).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0].title).toBe('Latest');
  expect(stringify).not.toHaveBeenCalled();
});

it('ignores selection changes but saves distinct content with the same timestamp', async () => {
  const harness = await mount();
  const save = vi.mocked(harness.options.storageAdapter.saveProject);
  await harness.render({ project: { ...initial, selectedLayerId: 'selected' } });
  expect(save).not.toHaveBeenCalled();
  const changed = { ...initial, layers: [{ id: 'image', type: 'image', content: 'data:image/png;base64,AAAA' }] } as ProjectState;
  await harness.render({ project: changed });
  expect(save).toHaveBeenCalledTimes(1);
  await harness.render({ project: { ...changed, layers: [...changed.layers] } });
  await act(async () => vi.advanceTimersByTime(5000));
  expect(save).toHaveBeenCalledTimes(2);
});

it('does not save when navigating between unchanged pages', async () => {
  const first = { ...initial.pages![0], layers: initial.layers, pageInfo: initial.pageInfo };
  const second = { ...first, id: 'second', layers: [] };
  const project = { ...initial, pages: [first, second] };
  const harness = await mount({ project });
  await harness.render({ project: selectProjectPage(project, second.id) });
  await act(async () => vi.advanceTimersByTime(5000));
  expect(harness.options.storageAdapter.saveProject).not.toHaveBeenCalled();
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

it('shares an in-flight save and serializes newer revisions', async () => {
  const harness = await mount({ isCloudMode: true });
  let release!: () => void;
  const firstWrite = new Promise<void>(resolve => { release = resolve; });
  const save = vi.mocked(harness.options.storageAdapter.saveProject);
  save.mockImplementationOnce(() => firstWrite);
  const first = { ...initial, title: 'First' };
  const second = { ...initial, title: 'Second' };
  const firstTask = harness.getResult().saveActiveProject(first);
  const duplicate = harness.getResult().saveActiveProject(first);
  const secondTask = harness.getResult().saveActiveProject(second);
  expect(duplicate).toBe(firstTask);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].title).toBe('First');
  await act(async () => { release(); await Promise.all([firstTask, duplicate, secondTask]); });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0].title).toBe('Second');
});

it('propagates shared save failures and permits later writes', async () => {
  const harness = await mount({ isCloudMode: true });
  const error = new Error('Disk full');
  const save = vi.mocked(harness.options.storageAdapter.saveProject);
  save.mockRejectedValueOnce(error);
  const changed = { ...initial, title: 'Changed' };
  const firstTask = harness.getResult().saveActiveProject(changed);
  const duplicate = harness.getResult().saveActiveProject(changed);
  await expect(firstTask).rejects.toBe(error);
  await expect(duplicate).rejects.toBe(error);
  await expect(harness.getResult().saveActiveProject(changed)).resolves.toBe(changed);
  expect(save).toHaveBeenCalledTimes(2);
});

it('saves an unchanged document when the destination adapter changes', async () => {
  const harness = await mount();
  const replacement = { ...harness.options.storageAdapter, saveProject: vi.fn(async () => {}) };
  await harness.render({ storageAdapter: replacement });
  expect(replacement.saveProject).toHaveBeenCalledOnce();
  expect(replacement.saveProject).toHaveBeenCalledWith(initial);
});

it('does not confuse different local file destinations', async () => {
  const harness = await mount({ isTauri: true, activeLocalFilePath: 'first.cfjx' });
  await harness.render({ activeLocalFilePath: 'second.cfjx' });
  await act(async () => harness.getResult().performAutoSave('manual'));
  expect(harness.options.saveLocalProjectToFile).toHaveBeenCalledExactlyOnceWith('second.cfjx', initial);
});

it('retains binary assets while an automatic save is queued', async () => {
  const owner = imageAssets.createOwner();
  const blob = new NodeBlob(['image'], { type: 'image/png' }) as unknown as Blob;
  const reference = await imageAssets.add(owner, blob);
  const layer = { id: 'image', type: 'image' as const, name: 'Image', content: reference, x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 };
  const page = { ...initial.pages![0], layers: [layer] };
  const project = { ...initial, layers: page.layers, pages: [page] };
  const harness = await mount({ project, isCloudMode: true });
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(harness.options.storageAdapter.saveProject).mockImplementation(async () => {
    await waiting;
    expect(imageAssets.blob(reference)).toBe(blob);
  });
  try {
    const saving = harness.getResult().saveActiveProject(project, undefined, true);
    imageAssets.release(owner);
    expect(imageAssets.blob(reference)).toBe(blob);
    release();
    await saving;
    await Promise.resolve();
    expect(imageAssets.blob(reference)).toBeUndefined();
  } finally { release(); imageAssets.release(owner); }
});