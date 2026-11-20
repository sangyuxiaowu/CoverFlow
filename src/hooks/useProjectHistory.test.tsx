// @vitest-environment jsdom
import { act, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useProjectHistory } from './useProjectHistory.ts';
import type { ProjectState } from '../types.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { insertProjectPage, selectProjectPage } from '../utils/projectPages.ts';
import { editLayers } from '../features/ai/domain/layerOperations.ts';
import { imageAssets } from '../storage/imageAssets.ts';
import { ProjectImageSession } from '../storage/projectImageSession.ts';

it('retains images through undo history and AI checkpoints, then releases expired assets', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const session = new ProjectImageSession();
  const reference = await session.addImage('data:image/png;base64,AQIDBA==');
  const initial = syncProjectPages({ id: 'assets', title: 'Initial', selectedLayerId: null, updatedAt: 1,
    layers: [{ id: 'image', name: 'Image', type: 'image', content: reference, x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }],
    pageInfo: { width: 100, height: 100, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });
  let state: ReturnType<typeof useProjectHistory> & { project: ProjectState | null };
  function Harness() {
    const [project, setProject] = useState<ProjectState | null>(initial);
    const history = useProjectHistory(project, setProject);
    state = { ...history, project };
    useEffect(() => { if (project) session.reconcile([project, ...history.retainedProjects]); }, [project, history.retainedProjects]);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => state!.modifyProject(current => syncProjectPages({ ...current, layers: [] })));
    await act(async () => state!.handleUndo());
    expect(state!.project!.layers[0].content).toBe(reference);
    expect(imageAssets.blob(reference)).toBeDefined();
    let token!: symbol;
    await act(async () => { token = state!.aiHistory.begin()!; });
    for (let index = 0; index < 55; index++) {
      await act(async () => state!.aiHistory.commit(syncProjectPages({ ...state!.project!, layers: [], title: `AI ${index}` })));
    }
    expect(state!.aiHistory.isValid(token)).toBe(true);
    expect(imageAssets.blob(reference)).toBeDefined();
    await act(async () => state!.aiHistory.clear());
    expect(imageAssets.blob(reference)).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    session.close();
    vi.unstubAllGlobals();
  }
});

it('keeps image payloads out of structured clones across 40 generated images while isolating mutable fields', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const clone = vi.spyOn(globalThis, 'structuredClone');
  const initial = syncProjectPages({ id: 'images', title: 'Images', layers: [], selectedLayerId: null, updatedAt: 1, pageInfo: { ...({ width: 100, height: 100 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });
  const firstLayer = { id: 'image-0', name: 'Image', type: 'image' as const,
    content: `data:image/png;base64,${'A'.repeat(400_000)}`, x: 0, y: 0, width: 100, height: 100,
    rotation: 0, zIndex: 0, visible: true, locked: false, opacity: 1,
    imageFilters: { brightness: 100, contrast: 100, grayscale: 0, blur: 0 }, children: ['child'] };
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
    for (let index = 0; index < 40; index++) {
      const layer = index === 0 ? firstLayer : { ...firstLayer, id: `image-${index}`, content: `${firstLayer.content}${index}` };
      await act(async () => state!.modifyProject(current => syncProjectPages({ ...current, layers: [...current.layers, layer] })));
    }
    expect(clone).not.toHaveBeenCalled();
    firstLayer.imageFilters.brightness = 0;
    firstLayer.children.push('external');
    await act(async () => state!.handleUndo());
    expect(state!.project!.layers).toHaveLength(39);
    expect(state!.project!.layers[0].content).toBe(firstLayer.content);
    expect(state!.project!.layers[0].imageFilters!.brightness).toBe(100);
    expect(state!.project!.layers[0].children).toEqual(['child']);
    await act(async () => state!.handleRedo());
    expect(state!.project!.layers).toHaveLength(40);
  } finally {
    await act(async () => root.unmount());
    clone.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('pins one immediate AI checkpoint beyond 100 steps without grouping normal undo and invalidates manual edits', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const initial = syncProjectPages({ id: 'ai', title: 'Before AI', layers: [], selectedLayerId: null, updatedAt: 1, pageInfo: { ...({ width: 100, height: 100 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });
  let state: ReturnType<typeof useProjectHistory> & { project: ProjectState | null };
  function Harness() {
    const [project, setProject] = useState<ProjectState | null>(initial);
    state = { ...useProjectHistory(project, setProject), project };
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness />));
    let token!: symbol;
    await act(async () => { token = state!.aiHistory.begin()!; });
    for (let index = 0; index < 100; index++) {
      await act(async () => state!.aiHistory.commit({ ...state!.project!, title: `AI ${index}` }));
    }
    state!.aiHistory.setRunning(token, false);
    expect(state!.aiHistory.isValid(token)).toBe(true);
    let restored: ProjectState | null = null;
    await act(async () => { restored = state!.aiHistory.restore(token); });
    expect(restored!.title).toBe('Before AI');
    expect(state!.aiHistory.isValid(token)).toBe(false);
    await act(async () => state!.handleUndo());
    expect(state!.project!.title).toBe('AI 98');
    await act(async () => { token = state!.aiHistory.begin()!; });
    state!.aiHistory.setRunning(token, false);
    await act(async () => state!.modifyProject(current => ({ ...current, title: 'Manual' })));
    expect(state!.aiHistory.isValid(token)).toBe(false);
    await act(async () => { token = state!.aiHistory.begin()!; });
    state!.aiHistory.setRunning(token, false);
    await act(async () => state!.handleUndo());
    expect(state!.aiHistory.isValid(token)).toBe(false);
    await act(async () => { token = state!.aiHistory.begin()!; });
    await act(async () => state!.initProjectHistory(initial));
    expect(state!.aiHistory.isValid(token)).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('isolates snapshots, groups continuous edits, truncates redo and caps all commits at 50', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const initial: ProjectState = { id: 'project', title: 'Initial', layers: [], selectedLayerId: null, updatedAt: 1, pageInfo: { ...({ width: 100, height: 100 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } };
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
  const initial = insertProjectPage(syncProjectPages({ id: 'pages', title: 'Initial', layers: [], selectedLayerId: null, updatedAt: 1, pageInfo: { ...({ width: 100, height: 100 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } }), 'Second');
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

it('retains unchanged pages through repeated AI edits and restores history', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const image = { id: 'image', name: 'Image', type: 'image' as const, content: `data:image/png;base64,${'A'.repeat(400_000)}`,
    x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 };
  const withSecondPage = insertProjectPage(syncProjectPages({ id: 'ai-images', title: 'Images', layers: [image], selectedLayerId: null, updatedAt: 1,
    pageInfo: { width: 100, height: 100, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } }), 'Second');
  const initial = selectProjectPage(withSecondPage, withSecondPage.pages![0].id);
  let state: ReturnType<typeof useProjectHistory> & { project: ProjectState | null };
  function Harness() {
    const [project, setProject] = useState<ProjectState | null>(initial);
    state = { ...useProjectHistory(project, setProject), project };
    return null;
  }
  const root = createRoot(document.createElement('div'));
  const clone = vi.spyOn(globalThis, 'structuredClone');
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => state!.initProjectHistory(initial));
    const unchangedPage = state!.project!.pages![1];
    for (let index = 1; index <= 30; index++) {
      await act(async () => state!.aiHistory.commit(syncProjectPages(editLayers(state!.project!, 'update', ['image'], { x: index }))));
      expect(state!.project!.pages![1]).toBe(unchangedPage);
    }
    expect(clone).not.toHaveBeenCalled();
    await act(async () => state!.handleUndo());
    expect(state!.project!.layers[0].x).toBe(29);
    expect(state!.project!.layers[0].content).toBe(image.content);
    await act(async () => state!.handleRedo());
    expect(state!.project!.layers[0].x).toBe(30);
  } finally {
    await act(async () => root.unmount());
    clone.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('clears undo history when the project is closed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const initial = syncProjectPages({ id: 'closed', title: 'Initial', layers: [], selectedLayerId: null, updatedAt: 1,
    pageInfo: { width: 100, height: 100, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });
  let state: ReturnType<typeof useProjectHistory> & { setProject: Dispatch<SetStateAction<ProjectState | null>> };
  function Harness() {
    const [project, setProject] = useState<ProjectState | null>(initial);
    state = { ...useProjectHistory(project, setProject), setProject };
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => state!.initProjectHistory(initial));
    await act(async () => state!.modifyProject(current => ({ ...current, title: 'Changed' })));
    expect(state!.canUndo).toBe(true);
    await act(async () => state!.setProject(null));
    expect(state!.canUndo).toBe(false);
    expect(state!.canRedo).toBe(false);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});