// @vitest-environment jsdom
import { act, useState, type Dispatch, type SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useProjectHistory } from './useProjectHistory.ts';
import type { ProjectState } from '../types.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { insertProjectPage, selectProjectPage } from '../utils/projectPages.ts';

it('isolates snapshots, groups continuous edits, truncates redo and caps all commits at 50', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const initial: ProjectState = {
    id: 'project', title: 'Initial', layers: [], selectedLayerId: null, updatedAt: 1,
    background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 },
    canvasConfig: { width: 100, height: 100, ratio: '1:1' }
  };
  let state: ReturnType<typeof useProjectHistory> & { project: ProjectState | null, setProject: Dispatch<SetStateAction<ProjectState | null>> };
  function Harness() {
    const [project, setProject] = useState<ProjectState | null>(null);
    state = { ...useProjectHistory(project, setProject), project, setProject };
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      state!.initProjectHistory(initial);
      state!.setProject(initial);
    });
    await act(async () => state!.modifyProject(current => ({ ...current, title: 'Drag' }), false));
    expect(state!.canUndo).toBe(false);
    await act(async () => state!.saveHistorySnapshot());
    await act(async () => state!.handleUndo());
    expect(state!.project!.title).toBe('Initial');
    expect(state!.canRedo).toBe(true);
    await act(async () => state!.handleRedo());
    expect(state!.project!.title).toBe('Drag');
    await act(async () => state!.handleUndo());
    await act(async () => state!.modifyProject(current => ({ ...current, title: 'Branch' })));
    expect(state!.canRedo).toBe(false);
    initial.title = 'Mutated externally';
    await act(async () => state!.handleUndo());
    expect(state!.project!.title).toBe('Initial');
    for (let index = 0; index < 55; index++) {
      await act(async () => state!.modifyProject(current => ({ ...current, title: String(index) }), false));
      await act(async () => state!.saveHistorySnapshot());
    }
    let undoCount = 0;
    while (state!.canUndo) {
      await act(async () => state!.handleUndo());
      undoCount++;
    }
    expect(undoCount).toBe(49);
    expect(state!.project!.title).toBe('5');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('does not record navigation or selection as edits and preserves the active page on undo', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const initial = insertProjectPage(syncProjectPages({ id: 'pages', title: 'Initial', layers: [], selectedLayerId: null, updatedAt: 1, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 }, canvasConfig: { width: 100, height: 100, ratio: '1:1' } }), 'Second');
  let state: ReturnType<typeof useProjectHistory> & { project: ProjectState | null };
  function Harness() {
    const [project, setProject] = useState<ProjectState | null>(initial);
    state = { ...useProjectHistory(project, setProject), project };
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => state!.initProjectHistory(initial));
    const firstId = initial.pages![0].id;
    await act(async () => state!.modifyProject(current => selectProjectPage(current, firstId)));
    await act(async () => state!.modifyProject(current => ({ ...current, selectedLayerId: 'temporary' })));
    expect(state!.canUndo).toBe(false);
    await act(async () => state!.modifyProject(current => ({ ...current, title: 'Changed' })));
    await act(async () => state!.handleUndo());
    expect(state!.project!.title).toBe('Initial');
    expect(state!.project!.activePageId).toBe(firstId);
    expect(state!.project!.pages![1]).toBeDefined();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});