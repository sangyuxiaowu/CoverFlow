// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_AUTO_SAVE_IDLE_MS, useProjectAutoSave } from './useProjectAutoSave.ts';
import type { ProjectState } from '../types.ts';
import { selectProjectPage } from '../utils/projectPages.ts';
import { Blob as NodeBlob } from 'node:buffer';
import { imageAssets } from '../storage/imageAssets.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { useProjectHistory } from './useProjectHistory.ts';

type Options = Parameters<typeof useProjectAutoSave>[0];
const initial: ProjectState = {
  id: 'project',
  title: 'Initial',
  layers: [],
  selectedLayerId: null,
  updatedAt: 1,
  pageInfo: {
    width: 100,
    height: 100,
    background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 }
  },
  activePageId: 'page',
  pages: [{
    id: 'page',
    name: '',
    layers: [],
    pageInfo: {
      width: 100,
      height: 100,
      background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 }
    }
  }]
};
const roots = new Set<Root>();

async function mount(overrides: Partial<Options> = {}) {
  let result: ReturnType<typeof useProjectAutoSave>;
  let options: Options = {
    project: initial,
    view: 'editor',
    isCloudMode: false,
    isTauri: false,
    activeLocalFilePath: null,
    savedMessage: 'Saved',
    saveFailedMessage: 'Failed',
    storageAdapter: {
      type: 'indexeddb',
      isAvailable: () => true,
      ensureReady: async () => true,
      listProjects: async () => ({ items: [], total: 0 }),
      saveProject: vi.fn(async () => {}),
      deleteProject: async () => {}
    },
    saveLocalProjectToFile: vi.fn(async (_path, project) => project),
    clearActiveLocalFilePath: vi.fn(),
    showToast: vi.fn(),
    reportStorageError: vi.fn(),
    ...overrides
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

it.each(['indexeddb', 'localfile'] as const)('debounces %s writes until idle timeout and saves the latest snapshot', async type => {
  const harness = await mount();
  harness.options.storageAdapter.type = type;
  const save = vi.mocked(harness.options.storageAdapter.saveProject);
  expect(save).not.toHaveBeenCalled();
  expect(harness.getResult().saveStatus).toBe('saved');

  await harness.render({ project: { ...initial, title: 'First' } });
  expect(save).not.toHaveBeenCalled();
  expect(harness.getResult().saveStatus).toBe('unsaved');
  expect(harness.getResult().hasUnsavedChanges).toBe(true);

  const stringify = vi.spyOn(JSON, 'stringify');
  stringify.mockClear();

  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS - 1000));
  expect(save).not.toHaveBeenCalled();

  await harness.render({ project: { ...initial, title: 'Intermediate' } });
  await harness.render({ project: { ...initial, title: 'Latest' } });
  expect(stringify).not.toHaveBeenCalled();

  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS - 1));
  expect(save).not.toHaveBeenCalled();
  expect(stringify).not.toHaveBeenCalled();

  await act(async () => vi.advanceTimersByTime(1));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].title).toBe('Latest');
  expect(harness.getResult().saveStatus).toBe('saved');
  expect(harness.getResult().hasUnsavedChanges).toBe(false);
  expect(stringify).not.toHaveBeenCalled();
});

it('ignores selection changes and same-content edits without redundant saves', async () => {
  const harness = await mount();
  const save = vi.mocked(harness.options.storageAdapter.saveProject);
  await harness.render({ project: { ...initial, selectedLayerId: 'selected' } });
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(save).not.toHaveBeenCalled();
  expect(harness.getResult().saveStatus).toBe('saved');

  const changed = { ...initial, layers: [{ id: 'image', type: 'image', content: 'data:image/png;base64,AAAA' }] } as ProjectState;
  await harness.render({ project: changed });
  expect(harness.getResult().saveStatus).toBe('unsaved');
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(save).toHaveBeenCalledTimes(1);

  await harness.render({ project: { ...changed, layers: [...changed.layers] } });
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(save).toHaveBeenCalledTimes(1);
});

it('marks actual undo and redo snapshots according to the last saved content', async () => {
  const harness = await mount();
  const options = harness.options;
  await act(async () => harness.root.unmount());
  roots.delete(harness.root);
  const save = vi.mocked(options.storageAdapter.saveProject);
  const projectInitial = syncProjectPages(initial);
  let state!: ReturnType<typeof useProjectHistory> & ReturnType<typeof useProjectAutoSave>;
  function Harness() {
    const [project, setProject] = useState<ProjectState | null>(projectInitial);
    const history = useProjectHistory(project, setProject);
    const autoSave = useProjectAutoSave({ ...options, project });
    state = { ...history, ...autoSave };
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.add(root);
  await act(async () => root.render(<Harness />));
  await act(async () => state.modifyProject(current => syncProjectPages({
    ...current,
    layers: [{ id: 'text', name: 'Text', type: 'text', content: 'Changed', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }]
  })));
  expect(state.saveStatus).toBe('unsaved');
  await act(async () => state.handleUndo());
  expect(state.saveStatus).toBe('saved');
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(save).not.toHaveBeenCalled();
  await act(async () => state.handleRedo());
  expect(state.saveStatus).toBe('unsaved');
  await act(async () => { await state.flushSave('manual'); });
  expect(state.saveStatus).toBe('saved');
  await act(async () => state.handleUndo());
  expect(state.saveStatus).toBe('unsaved');
  await act(async () => state.handleRedo());
  expect(state.saveStatus).toBe('saved');
});

it('saves immediately on page switch only when there are unsaved changes', async () => {
  const first = { ...initial.pages![0], layers: initial.layers, pageInfo: initial.pageInfo };
  const second = { ...first, id: 'second', layers: [] };
  const project = { ...initial, pages: [first, second] };
  const harness = await mount({ project });
  const save = vi.mocked(harness.options.storageAdapter.saveProject);

  // Switching between clean pages does not trigger a write
  const switchedClean = selectProjectPage(project, second.id);
  await harness.render({ project: switchedClean });
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(save).not.toHaveBeenCalled();
  expect(harness.getResult().saveStatus).toBe('saved');

  // Editing then switching pages immediately flushes the save without waiting for idle timeout
  const edited = { ...switchedClean, title: 'Edited on page 2' };
  await harness.render({ project: edited });
  expect(save).not.toHaveBeenCalled();
  expect(harness.getResult().saveStatus).toBe('unsaved');

  await harness.render({ project: selectProjectPage(edited, first.id) });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].title).toBe('Edited on page 2');
  expect(harness.getResult().saveStatus).toBe('saved');
});

it('warns on beforeunload only when there are unsaved changes or in-flight saves', async () => {
  const harness = await mount();

  const cleanEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(cleanEvent);
  expect(cleanEvent.defaultPrevented).toBe(false);

  await harness.render({ project: { ...initial, title: 'Unsaved' } });
  expect(harness.getResult().hasUnsavedChanges).toBe(true);

  const dirtyEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(dirtyEvent);
  expect(dirtyEvent.defaultPrevented).toBe(true);

  await act(async () => { await harness.getResult().flushSave('manual'); });
  expect(harness.getResult().saveStatus).toBe('saved');

  const afterSaveEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(afterSaveEvent);
  expect(afterSaveEvent.defaultPrevented).toBe(false);
});

it('manual save bypasses idle delay and skips redundant write when clean', async () => {
  const harness = await mount();
  const save = vi.mocked(harness.options.storageAdapter.saveProject);

  await harness.render({ project: { ...initial, title: 'Manual' } });
  expect(save).not.toHaveBeenCalled();
  await act(async () => harness.getResult().performAutoSave('manual'));
  expect(save).toHaveBeenCalledTimes(1);
  expect(harness.options.showToast).toHaveBeenCalledWith('Saved');
  expect(harness.getResult().saveStatus).toBe('saved');

  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(save).toHaveBeenCalledTimes(1);

  await act(async () => harness.getResult().performAutoSave('manual'));
  expect(save).toHaveBeenCalledTimes(1);
  expect(harness.options.showToast).toHaveBeenCalledTimes(2);
});

it('tracks saving status during async writes and keeps unsaved if edited mid-flight', async () => {
  const harness = await mount();
  let release!: () => void;
  const save = vi.mocked(harness.options.storageAdapter.saveProject);
  save.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));

  await harness.render({ project: { ...initial, title: 'First' } });
  let flushPromise!: Promise<boolean>;
  await act(async () => {
    flushPromise = harness.getResult().flushSave('manual');
    await Promise.resolve();
  });
  expect(harness.getResult().saveStatus).toBe('saving');

  await harness.render({ project: { ...initial, title: 'Mid-flight edit' } });
  await act(async () => {
    release();
    await flushPromise;
  });
  expect(harness.getResult().saveStatus).toBe('unsaved');
  expect(harness.getResult().hasUnsavedChanges).toBe(true);
});

it('autosaves an undo made while an older snapshot is being written', async () => {
  const harness = await mount();
  const save = vi.mocked(harness.options.storageAdapter.saveProject);
  let release!: () => void;
  save.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  await harness.render({ project: { ...initial, title: 'Edited' } });
  let writing!: Promise<boolean>;
  await act(async () => {
    writing = harness.getResult().flushSave('manual');
    await Promise.resolve();
  });
  await harness.render({ project: structuredClone(initial) });
  await act(async () => { release(); await writing; });
  expect(harness.getResult().saveStatus).toBe('unsaved');
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0].title).toBe('Initial');
  expect(harness.getResult().saveStatus).toBe('saved');
});

it('does not autosave cloud projects but supports explicit persistence and leave saves', async () => {
  const harness = await mount({ isCloudMode: true });
  const next = { ...initial, title: 'Cloud' };
  await harness.render({ project: next });
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(harness.options.storageAdapter.saveProject).not.toHaveBeenCalled();
  expect(harness.getResult().saveStatus).toBe('unsaved');

  await act(async () => harness.getResult().persistProject(next));
  await act(async () => harness.getResult().performAutoSave('manual'));
  expect(harness.options.storageAdapter.saveProject).toHaveBeenCalledTimes(1);

  await harness.render({ project: { ...next, title: 'Leave' } });
  await harness.render({ view: 'landing' });
  expect(harness.options.storageAdapter.saveProject).toHaveBeenCalledTimes(2);
  expect(harness.options.clearActiveLocalFilePath).toHaveBeenCalledOnce();
});

it('uses only the Tauri file path for manual/leave saves even when the adapter is not ready', async () => {
  const harness = await mount({ isTauri: true, activeLocalFilePath: 'cover.cfj' });
  vi.spyOn(harness.options.storageAdapter, 'ensureReady').mockResolvedValue(false);
  const next = { ...initial, title: 'Native' };
  await harness.render({ project: next });
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(harness.options.saveLocalProjectToFile).not.toHaveBeenCalled();
  expect(harness.getResult().saveStatus).toBe('unsaved');

  const saveLocal = vi.mocked(harness.options.saveLocalProjectToFile);
  await act(async () => harness.getResult().performAutoSave('manual'));
  expect(saveLocal).toHaveBeenCalledTimes(1);
  expect(saveLocal.mock.calls[0][0]).toBe('cover.cfj');
  expect(saveLocal.mock.calls[0][1].title).toBe('Native');
  expect(harness.options.storageAdapter.saveProject).not.toHaveBeenCalled();
  expect(harness.getResult().saveStatus).toBe('saved');
});

it('checks the adapter and reports unavailable storage for dirty saves', async () => {
  const harness = await mount();
  await harness.render({ project: { ...initial, title: 'Dirty' } });
  await act(async () => {
    expect(await harness.getResult().flushSave('leave')).toBe(true);
  });
  expect(harness.options.storageAdapter.saveProject).toHaveBeenCalledOnce();

  vi.spyOn(harness.options.storageAdapter, 'ensureReady').mockResolvedValueOnce(false);
  await harness.render({ project: { ...initial, title: 'Still dirty' } });
  await act(async () => {
    expect(await harness.getResult().flushSave('leave')).toBe(false);
  });
  expect(harness.getResult().saveStatus).toBe('error');
});

it('reports a failed write once, sets error status, and does not retry on unrelated rerenders', async () => {
  const harness = await mount();
  const error = new Error('Quota exceeded');
  vi.mocked(harness.options.storageAdapter.saveProject).mockRejectedValue(error);
  await harness.render({ project: { ...initial, title: 'Dirty' } });
  await harness.render();
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(harness.options.storageAdapter.saveProject).toHaveBeenCalledOnce();
  expect(harness.options.reportStorageError).toHaveBeenCalledWith(error, 'save-auto', 'Failed', initial.id);
  expect(harness.getResult().saveStatus).toBe('error');
  expect(harness.getResult().hasUnsavedChanges).toBe(true);

  await harness.render();
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(harness.options.storageAdapter.saveProject).toHaveBeenCalledOnce();
});

it('cancels pending work on backend changes, explicit cancellation and unmount', async () => {
  const harness = await mount();
  const save = vi.mocked(harness.options.storageAdapter.saveProject);
  await harness.render({ project: { ...initial, title: 'Pending' } });
  await act(async () => harness.getResult().cancelPendingSave());
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(save).not.toHaveBeenCalled();

  await harness.render({ project: { ...initial, title: 'Pending again' } });
  const replacement = { ...harness.options.storageAdapter, saveProject: vi.fn(async () => {}) };
  await harness.render({ storageAdapter: replacement, view: 'landing' });
  const callsAfterSwitch = replacement.saveProject.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
  expect(replacement.saveProject).toHaveBeenCalledTimes(callsAfterSwitch);

  await harness.render({ view: 'editor', project: { ...initial, title: 'Final' } });
  await harness.render({ project: { ...initial, title: 'Unmount pending' } });
  await act(async () => harness.root.unmount());
  roots.delete(harness.root);
  const callsAfterUnmount = replacement.saveProject.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(DEFAULT_AUTO_SAVE_IDLE_MS));
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
  let firstTask!: Promise<ProjectState>;
  let duplicate!: Promise<ProjectState>;
  let secondTask!: Promise<ProjectState>;
  await act(async () => {
    firstTask = harness.getResult().saveActiveProject(first);
    duplicate = harness.getResult().saveActiveProject(first);
    secondTask = harness.getResult().saveActiveProject(second);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(duplicate).toBe(firstTask);
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
  await act(async () => {
    const firstTask = harness.getResult().saveActiveProject(changed);
    const duplicate = harness.getResult().saveActiveProject(changed);
    await expect(firstTask).rejects.toBe(error);
    await expect(duplicate).rejects.toBe(error);
  });
  await act(async () => {
    await expect(harness.getResult().saveActiveProject(changed)).resolves.toBe(changed);
  });
  expect(save).toHaveBeenCalledTimes(2);
});

it('saves an unchanged document when the destination adapter changes', async () => {
  const harness = await mount();
  const replacementSave = vi.fn(async (_project: ProjectState) => {});
  const replacement = { ...harness.options.storageAdapter, saveProject: replacementSave };
  await harness.render({ storageAdapter: replacement });
  expect(replacementSave).toHaveBeenCalledOnce();
  expect(replacementSave.mock.calls[0][0].id).toBe(initial.id);
});

it('does not confuse different local file destinations', async () => {
  const harness = await mount({ isTauri: true, activeLocalFilePath: 'first.cfjx' });
  const saveLocal = vi.mocked(harness.options.saveLocalProjectToFile);
  await harness.render({ activeLocalFilePath: 'second.cfjx' });
  await act(async () => harness.getResult().performAutoSave('manual'));
  expect(saveLocal).toHaveBeenCalledTimes(1);
  expect(saveLocal.mock.calls[0][0]).toBe('second.cfjx');
  expect(saveLocal.mock.calls[0][1].id).toBe(initial.id);
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
    let saving!: Promise<ProjectState>;
    await act(async () => {
      saving = harness.getResult().saveActiveProject(project, undefined, true);
      imageAssets.release(owner);
      expect(imageAssets.blob(reference)).toBe(blob);
    });
    await act(async () => {
      release();
      await saving;
      await Promise.resolve();
    });
    expect(imageAssets.blob(reference)).toBeUndefined();
  } finally { release(); imageAssets.release(owner); }
});

it('detects version changes and retains image assets referenced only inside historical versions', async () => {
  const owner = imageAssets.createOwner();
  const blob = new NodeBlob(['ver-img'], { type: 'image/png' }) as unknown as Blob;
  const reference = await imageAssets.add(owner, blob);
  const versionPage = {
    ...initial.pages![0],
    layers: [{ id: 'vimg', type: 'image' as const, name: 'VImg', content: reference, x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }]
  };
  const projectWithVersion: ProjectState = {
    ...initial,
    versions: [{ id: 'v1', info: 'Archived image', createdAt: 10, title: 'Initial', pages: [versionPage] }]
  };
  const harness = await mount({ project: initial, isCloudMode: true });
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(harness.options.storageAdapter.saveProject).mockImplementation(async () => {
    await waiting;
    expect(imageAssets.blob(reference)).toBe(blob);
  });
  try {
    await harness.render({ project: projectWithVersion });
    expect(harness.getResult().saveStatus).toBe('unsaved');
    let saving!: Promise<ProjectState>;
    await act(async () => {
      saving = harness.getResult().saveActiveProject(projectWithVersion, undefined, true);
      imageAssets.release(owner);
      expect(imageAssets.blob(reference)).toBe(blob);
    });
    await act(async () => {
      release();
      await saving;
      await Promise.resolve();
    });
    expect(harness.getResult().saveStatus).toBe('saved');
    expect(imageAssets.blob(reference)).toBeUndefined();
  } finally {
    release?.();
    imageAssets.release(owner);
  }
});