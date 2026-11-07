// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useEditorShortcuts } from './useEditorShortcuts.ts';
import type { ProjectState } from '../types.ts';

type Options = Parameters<typeof useEditorShortcuts>[0];
const roots = new Set<Root>();
const project = { id: 'project', selectedLayerId: 'layer', layers: [
  { id: 'layer', type: 'text', x: 20, y: 30, rotation: 0, locked: false }
] } as ProjectState;

async function mount(overrides: Partial<Options> = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let options: Options = {
    view: 'editor', project, aiBusy: false, selectedLayerIds: ['layer'], handleUndo: vi.fn(), handleRedo: vi.fn(),
    performAutoSave: vi.fn(), modifyProject: vi.fn(), updateLayer: vi.fn(), handleDeleteLayers: vi.fn(),
    handleCloneLayers: vi.fn(), handleGroupLayers: vi.fn(), addSvgLayerWithContent: vi.fn(),
    addImageLayerWithContent: vi.fn(), addTextLayerWithContent: vi.fn(), applyProjectFromJson: vi.fn(), ...overrides
  };
  const root = createRoot(document.createElement('div'));
  roots.add(root);
  function Harness({ current }: { current: Options }) {
    useEditorShortcuts(current);
    return null;
  }
  const render = async (changes: Partial<Options>) => {
    options = { ...options, ...changes };
    await act(async () => root.render(<Harness current={options} />));
  };
  await render({});
  return { options, render, root };
}

function key(keyValue: string, modifiers: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key: keyValue, bubbles: true, cancelable: true, ...modifiers });
  target.dispatchEvent(event);
  return event;
}

function paste(text: string, target: EventTarget = document.body) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: () => text } });
  target.dispatchEvent(event);
  return event;
}

afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount(); });
  roots.clear();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('routes undo, redo, save, nudges, rotation, deletion and cloning exactly once', async () => {
  const { options } = await mount();
  key('z', { ctrlKey: true });
  key('z', { metaKey: true, shiftKey: true });
  key('y', { ctrlKey: true });
  key('s', { metaKey: true });
  key('ArrowRight');
  key('ArrowUp', { shiftKey: true });
  key('ArrowLeft', { ctrlKey: true });
  key('Delete');
  key('j', { ctrlKey: true });
  expect(options.handleUndo).toHaveBeenCalledOnce();
  expect(options.handleRedo).toHaveBeenCalledTimes(2);
  expect(options.performAutoSave).toHaveBeenCalledWith('manual');
  expect(options.updateLayer).toHaveBeenNthCalledWith(1, 'layer', { x: 21, y: 30 });
  expect(options.updateLayer).toHaveBeenNthCalledWith(2, 'layer', { x: 20, y: 20 });
  expect(options.updateLayer).toHaveBeenNthCalledWith(3, 'layer', { rotation: -5 });
  expect(options.handleDeleteLayers).toHaveBeenCalledWith(['layer']);
  expect(options.handleCloneLayers).toHaveBeenCalledWith(['layer']);
});

it('uses current multi-selection and rebinds callbacks without duplicate listeners', async () => {
  const harness = await mount();
  const undo = vi.fn();
  await harness.render({ selectedLayerIds: ['layer', 'other'], handleUndo: undo });
  key('z', { ctrlKey: true });
  key('g', { ctrlKey: true });
  key('Backspace');
  key('j', { metaKey: true });
  expect(undo).toHaveBeenCalledOnce();
  expect(harness.options.handleUndo).not.toHaveBeenCalled();
  expect(harness.options.handleGroupLayers).toHaveBeenCalledWith(['layer', 'other']);
  expect(harness.options.handleDeleteLayers).toHaveBeenCalledWith(['layer', 'other']);
  expect(harness.options.handleCloneLayers).toHaveBeenCalledWith(['layer', 'other']);
});

it('leaves native copy/input behavior alone and protects AI, locked layers and landing', async () => {
  const harness = await mount();
  expect(key('c', { ctrlKey: true }).defaultPrevented).toBe(false);
  const input = document.createElement('input');
  const panel = document.createElement('div');
  panel.className = 'cf-ai-panel';
  document.body.append(input, panel);
  expect(key('Delete', {}, input).defaultPrevented).toBe(false);
  expect(key('Delete', {}, panel).defaultPrevented).toBe(false);
  expect(paste('input', input).defaultPrevented).toBe(false);
  await harness.render({ aiBusy: true });
  expect(key('Delete').defaultPrevented).toBe(false);
  expect(paste('busy').defaultPrevented).toBe(false);
  await harness.render({ aiBusy: false, project: { ...project, layers: [{ ...project.layers[0], locked: true }] } });
  expect(key('Delete').defaultPrevented).toBe(false);
  await harness.render({ view: 'landing' });
  expect(key('z', { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(paste('landing').defaultPrevented).toBe(false);
  expect(harness.options.handleDeleteLayers).not.toHaveBeenCalled();
  expect(harness.options.handleUndo).not.toHaveBeenCalled();
});

it('dispatches clipboard formats and removes both listeners on unmount', async () => {
  const harness = await mount();
  paste('  text  ');
  paste('<svg></svg>');
  paste('{"layers":[]}');
  expect(harness.options.addTextLayerWithContent).toHaveBeenCalledWith('text');
  expect(harness.options.addSvgLayerWithContent).toHaveBeenCalledWith('<svg></svg>');
  expect(harness.options.applyProjectFromJson).toHaveBeenCalledWith({ layers: [] });
  paste(JSON.stringify({ id: 'import', title: 'Imported', version: '9.0.0', updatedAt: 1, pages: [{ id: 'first', name: '', layers: [], background: { type: 'color', value: '#123456' }, canvasConfig: { width: 900, height: 383, ratio: '2.35:1' } }] }));
  expect(harness.options.applyProjectFromJson).toHaveBeenLastCalledWith(expect.objectContaining({ activePageId: 'first', background: { type: 'color', value: '#123456' }, layers: [] }));
  await act(async () => harness.root.unmount());
  roots.delete(harness.root);
  key('Delete');
  paste('after unmount');
  expect(harness.options.handleDeleteLayers).not.toHaveBeenCalled();
  expect(harness.options.addTextLayerWithContent).toHaveBeenCalledOnce();
});