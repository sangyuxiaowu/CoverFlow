// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useEditorShortcuts } from './useEditorShortcuts.ts';
import type { ProjectState } from '../types.ts';
import { applyKeyboardLayerTransform, KEYBOARD_LAYER_TRANSFORM, type KeyboardLayerTransform } from '../utils/keyboardLayerTransform.ts';

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
  const transforms: KeyboardLayerTransform[] = [];
  const capture = (event: Event) => transforms.push((event as CustomEvent<KeyboardLayerTransform>).detail);
  window.addEventListener(KEYBOARD_LAYER_TRANSFORM, capture);
  key('z', { ctrlKey: true });
  key('Z', { metaKey: true, shiftKey: true });
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
  window.removeEventListener(KEYBOARD_LAYER_TRANSFORM, capture);
  expect(options.modifyProject).not.toHaveBeenCalled();
  expect(options.updateLayer).not.toHaveBeenCalled();
  expect(transforms.map(({ dx, dy, rotation }) => [dx, dy, rotation])).toEqual([[1, 0, 0], [0, -10, 0], [0, 0, -5]]);
  expect(options.handleDeleteLayers).toHaveBeenCalledWith(['layer']);
  expect(options.handleCloneLayers).toHaveBeenCalledWith(['layer']);
});

it('accumulates rapid nudges against current state and moves the whole selection', async () => {
  let current = { ...project, layers: [
    { ...project.layers[0], width: 20, height: 20 },
    { ...project.layers[0], id: 'other', x: 50, y: 60, width: 20, height: 20 },
    { ...project.layers[0], id: 'locked', x: 80, y: 90, locked: true }
  ] };
  const modifyProject = vi.fn((modifier: (value: ProjectState) => ProjectState) => { current = modifier(current); });
  await mount({ project: current, selectedLayerIds: ['layer', 'other', 'locked'], modifyProject });
  const transform = (event: Event) => { current = applyKeyboardLayerTransform(current, (event as CustomEvent<KeyboardLayerTransform>).detail); };
  window.addEventListener(KEYBOARD_LAYER_TRANSFORM, transform);
  key('ArrowRight');
  key('ArrowRight');
  key('ArrowUp', { shiftKey: true });
  window.removeEventListener(KEYBOARD_LAYER_TRANSFORM, transform);
  expect(current.layers.map(layer => [layer.x, layer.y])).toEqual([[22, 20], [52, 50], [80, 90]]);
});

it('moves a selected group and its selected child only once', async () => {
  let current = { ...project, selectedLayerId: 'group', layers: [
    { ...project.layers[0], id: 'group', type: 'group', x: 10, y: 20, width: 100, height: 100, children: ['layer'] },
    { ...project.layers[0], parentId: 'group', x: 20, y: 30, width: 20, height: 20 }
  ] } as ProjectState;
  const modifyProject = vi.fn((modifier: (value: ProjectState) => ProjectState) => { current = modifier(current); });
  await mount({ project: current, selectedLayerIds: ['group', 'layer'], modifyProject });
  const transform = (event: Event) => { current = applyKeyboardLayerTransform(current, (event as CustomEvent<KeyboardLayerTransform>).detail); };
  window.addEventListener(KEYBOARD_LAYER_TRANSFORM, transform);
  key('ArrowRight');
  window.removeEventListener(KEYBOARD_LAYER_TRANSFORM, transform);
  expect(current.layers.map(layer => layer.x)).toEqual([11, 21]);
});

it('keeps native controls, dialogs and Alt shortcuts from moving layers', async () => {
  const { options } = await mount();
  const select = document.createElement('select');
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const button = document.createElement('button');
  dialog.append(button);
  document.body.append(select, dialog);
  expect(key('ArrowDown', {}, select).defaultPrevented).toBe(false);
  expect(key('ArrowRight', {}, button).defaultPrevented).toBe(false);
  expect(key('ArrowRight', { altKey: true }).defaultPrevented).toBe(false);
  expect(options.modifyProject).not.toHaveBeenCalled();
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
  paste(JSON.stringify({ id: 'import', title: 'Imported', version: '9.0.0', updatedAt: 1, pages: [{ id: 'first', name: '', layers: [], pageInfo: { ...({ width: 900, height: 383 }), background: { type: 'color', value: '#123456' } } }] }));
  expect(harness.options.applyProjectFromJson).toHaveBeenLastCalledWith(expect.objectContaining({ activePageId: 'first', pageInfo: { width: 900, height: 383, background: { type: 'color', value: '#123456' } }, layers: [] }));
  paste(JSON.stringify({ canvasConfig: { width: 640, height: 480, ratio: '4:3' }, background: { type: 'color', value: '#abcdef' } }));
  expect(harness.options.applyProjectFromJson).toHaveBeenLastCalledWith({ pageInfo: { width: 640, height: 480, background: { type: 'color', value: '#abcdef' } } });
  await act(async () => harness.root.unmount());
  roots.delete(harness.root);
  key('Delete');
  paste('after unmount');
  expect(harness.options.handleDeleteLayers).not.toHaveBeenCalled();
  expect(harness.options.addTextLayerWithContent).toHaveBeenCalledOnce();
});

it('passes pasted image files without creating Base64 strings', async () => {
  const { options } = await mount();
  const file = new File(['image'], 'photo.png', { type: 'image/png' });
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [file], getData: () => '' } });
  await act(async () => document.body.dispatchEvent(event));
  expect(options.addImageLayerWithContent).toHaveBeenCalledExactlyOnceWith(file);
  expect(event.defaultPrevented).toBe(true);
});