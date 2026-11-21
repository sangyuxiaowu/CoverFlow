// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Canvas from './Canvas.tsx';
import type { ProjectState } from '../types.ts';
import * as decorationStyles from '../utils/decorationStyles.ts';
import * as imageLayer from '../utils/imageLayer.ts';
import { KEYBOARD_LAYER_TRANSFORM, type KeyboardLayerTransform } from '../utils/keyboardLayerTransform.ts';
import { useEditorShortcuts } from '../hooks/useEditorShortcuts.ts';
import { useProjectHistory } from '../hooks/useProjectHistory.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { PANEL_LAYER_DRAFT } from '../utils/panelLayerDraft.ts';
import { selectionBounds } from '../utils/canvasLayerTransform.ts';

let host: HTMLDivElement;
let root: Root;

const project = (pageId: string, width = 1600, height = 800): ProjectState => ({ id: 'canvas-project', activePageId: pageId, title: 'Canvas', layers: [], selectedLayerId: null, updatedAt: 1, pageInfo: { ...({ width, height }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } } });

const renderCanvas = async (current: ProjectState, onCommit: () => void = () => {}) => {
  await act(async () => root.render(<Canvas lang="zh" project={current} onSelectLayer={() => {}} updateLayer={() => {}} onKeyboardCommit={() => {}} onCommit={onCommit} />));
};

const scrollContainer = () => host.querySelector<HTMLDivElement>('.canvas-checkerboard')!;
const frame = () => host.querySelector<HTMLDivElement>('#export-target')!.parentElement!;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('getComputedStyle', vi.fn(() => ({ paddingLeft: '64px', paddingRight: '64px', paddingTop: '64px', paddingBottom: '64px' })));
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(700);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(984);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(684);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('fits from the stable viewport size and keeps the scaled frame free of size transitions', async () => {
  await renderCanvas(project('wide'));
  expect(parseFloat(frame().style.width)).toBeCloseTo(872);
  expect(parseFloat(frame().style.height)).toBeCloseTo(436);
  expect(frame().style.transition).toBe('');
  expect(frame().style.overflow).toBe('clip');
  expect(frame().style.overflowClipMargin).toBe('100px');
  expect(host.querySelector<HTMLDivElement>('#export-target')!.style.transform).toBe('scale(0.545)');
  expect(scrollContainer().style.overflowAnchor).toBe('none');
  expect(scrollContainer().style.scrollBehavior).toBe('auto');
});

it('preserves manual zoom on the same page and refits page switches without replacing the viewport', async () => {
  const first = project('wide');
  await renderCanvas(first);
  const viewport = scrollContainer();
  const canvas = host.querySelector('#export-target');
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Zoom in"]')!.click());
  expect(parseFloat(frame().style.width)).toBeCloseTo(1032);
  await renderCanvas({ ...first, title: 'Renamed', selectedLayerId: 'selection' });
  expect(parseFloat(frame().style.width)).toBeCloseTo(1032);

  viewport.scrollLeft = 80;
  viewport.scrollTop = 120;
  await renderCanvas(project('same-size'));
  expect(scrollContainer()).toBe(viewport);
  expect(host.querySelector('#export-target')).toBe(canvas);
  expect(parseFloat(frame().style.width)).toBeCloseTo(872);
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.scrollTop).toBe(0);

  await renderCanvas(project('portrait', 400, 1600));
  expect(scrollContainer()).toBe(viewport);
  expect(parseFloat(frame().style.width)).toBeCloseTo(143);
  expect(parseFloat(frame().style.height)).toBeCloseTo(572);
  expect(host.querySelector<HTMLDivElement>('#export-target')!.style.transform).toBe('scale(0.3575)');
});

it('clears dragging and text editing when the active page changes', async () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  const onCommit = vi.fn();
  const first: ProjectState = {
    ...project('editing'), selectedLayerId: 'text',
    layers: [{ id: 'text', name: 'Title', type: 'text', content: 'Title', x: 0, y: 0, width: 200, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1, color: '#000' }]
  };
  const second = { ...first, activePageId: 'next' };
  const layer = () => host.querySelector<HTMLDivElement>('#export-target > .group')!;
  await renderCanvas(first, onCommit);
  await act(async () => layer().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 20 })));
  expect(layer().style.cursor).toBe('grabbing');
  await renderCanvas(second, onCommit);
  expect(layer().style.cursor).toBe('move');
  await act(async () => window.dispatchEvent(new MouseEvent('mouseup')));
  expect(onCommit).not.toHaveBeenCalled();

  await renderCanvas(first, onCommit);
  await act(async () => layer().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(host.querySelector('textarea')).not.toBeNull();
  await renderCanvas(second, onCommit);
  expect(host.querySelector('textarea')).toBeNull();
});

it('does not reparse unchanged decorations when selection changes', async () => {
  const buildStyle = vi.spyOn(decorationStyles, 'buildDecorationLayerStyle');
  const current: ProjectState = { ...project('decorations'), layers: [
    { id: 'decoration', name: 'Decoration', type: 'decoration', content: 'background: #fff;', x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 },
    { id: 'image', name: 'Image', type: 'image', content: 'data:image/png;base64,AAAA', x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 2, visible: true, locked: false, opacity: 1 }
  ] };
  await renderCanvas(current);
  expect(buildStyle).toHaveBeenCalledOnce();
  await renderCanvas({ ...current, selectedLayerId: 'image' });
  expect(buildStyle).toHaveBeenCalledOnce();
});

it('does not rerender unchanged image contents when selection changes', async () => {
  const buildFilters = vi.spyOn(imageLayer, 'buildImageFilterCss');
  const current: ProjectState = { ...project('images'), layers: Array.from({ length: 8 }, (_, index) => ({
    id: `image-${index}`, name: `Image ${index}`, type: 'image' as const, content: 'data:image/png;base64,AAAA',
    x: index * 10, y: 0, width: 100, height: 100, rotation: 0, zIndex: index, visible: true, locked: false, opacity: 1
  })) };
  await renderCanvas(current);
  expect(buildFilters).toHaveBeenCalledTimes(8);
  await renderCanvas({ ...current, selectedLayerId: 'image-0' });
  await renderCanvas({ ...current, selectedLayerId: 'image-1' });
  expect(buildFilters).toHaveBeenCalledTimes(8);
  await renderCanvas({ ...current, layers: current.layers.map(layer => layer.id === 'image-1' ? { ...layer, opacity: 0.5 } : layer) });
  expect(buildFilters).toHaveBeenCalledTimes(9);
});

it('lets canvas selection pass through locked layers to editable layers below', async () => {
  const onSelectLayer = vi.fn();
  const current: ProjectState = { ...project('locked-hit-test'), layers: [
    { id: 'editable', name: 'Editable', type: 'image', content: 'data:image/png;base64,AAAA', x: 100, y: 100, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 },
    { id: 'locked', name: 'Locked', type: 'image', content: 'data:image/png;base64,AAAA', x: 100, y: 100, width: 100, height: 100, rotation: 0, zIndex: 2, visible: true, locked: true, opacity: 1 }
  ] };
  await act(async () => root.render(<Canvas lang="zh" project={current} onSelectLayer={onSelectLayer} updateLayer={() => {}} onKeyboardCommit={() => {}} onCommit={() => {}} />));
  const layers = host.querySelectorAll<HTMLDivElement>('#export-target > .group');
  expect(layers[0].style.pointerEvents).toBe('auto');
  expect(layers[1].style.pointerEvents).toBe('none');

  await act(async () => layers[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 20 })));
  expect(onSelectLayer).toHaveBeenCalledExactlyOnceWith('editable');
  expect(layers[0].style.cursor).toBe('grabbing');
});

it('supports ctrl multi-selection on the canvas without starting a drag', async () => {
  const onSelectLayer = vi.fn();
  const updateLayer = vi.fn();
  const current: ProjectState = { ...project('ctrl-selection'), layers: [
    { id: 'first', name: 'First', type: 'image', content: 'data:image/png;base64,AAAA', x: 20, y: 20, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }
  ] };
  await act(async () => root.render(<Canvas lang="zh" project={current} onSelectLayer={onSelectLayer} updateLayer={updateLayer} onKeyboardCommit={() => {}} onCommit={() => {}} />));
  const layer = host.querySelector<HTMLDivElement>('#export-target > .group')!;
  await act(async () => layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ctrlKey: true, clientX: 20, clientY: 20 })));
  expect(onSelectLayer).toHaveBeenCalledExactlyOnceWith('first', 'toggle');
  expect(layer.style.cursor).toBe('move');
  await act(async () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60 })));
  expect(layer.style.left).toBe('20px');
});

it('calculates multi-selection bounds from rotated layer corners', () => {
  const current: ProjectState = { ...project('rotated-bounds'), layers: [
    { id: 'rotated', name: 'Rotated', type: 'image', content: 'data:image/png;base64,AAAA', x: 0, y: 0, width: 100, height: 50, rotation: 90, zIndex: 1, visible: true, locked: false, opacity: 1 },
    { id: 'plain', name: 'Plain', type: 'image', content: 'data:image/png;base64,AAAA', x: 100, y: 100, width: 40, height: 30, rotation: 0, zIndex: 2, visible: true, locked: false, opacity: 1 }
  ] };
  const bounds = selectionBounds(current, ['rotated', 'plain'])!;
  expect(bounds.x).toBeCloseTo(25);
  expect(bounds.y).toBeCloseTo(-25);
  expect(bounds.width).toBeCloseTo(115);
  expect(bounds.height).toBeCloseTo(155);
});

it('renders one combined selection box for multiple layers', async () => {
  const current: ProjectState = { ...project('multi-selection'), selectedLayerId: 'second', layers: [
    { id: 'first', name: 'First', type: 'image', content: 'data:image/png;base64,AAAA', x: 20, y: 20, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 },
    { id: 'second', name: 'Second', type: 'image', content: 'data:image/png;base64,AAAA', x: 160, y: 20, width: 100, height: 100, rotation: 0, zIndex: 2, visible: true, locked: false, opacity: 1 }
  ] };
  await act(async () => root.render(<Canvas lang="zh" project={current} selectedLayerIds={['first', 'second']} onSelectLayer={() => {}} updateLayer={() => {}} onKeyboardCommit={() => {}} onCommit={() => {}} />));
  const layers = host.querySelectorAll<HTMLDivElement>('#export-target > .group');
  expect(layers).toHaveLength(2);
  expect(layers[0].classList.contains('selected-layer')).toBe(true);
  expect(layers[1].classList.contains('selected-layer')).toBe(true);
  expect(host.querySelectorAll('#export-target > .group > .border-blue-500')).toHaveLength(0);
  const selectionBox = host.querySelector<HTMLDivElement>('.multi-selection-box');
  expect(selectionBox).not.toBeNull();
  expect(selectionBox!.style.left).toBe('20px');
  expect(selectionBox!.style.top).toBe('20px');
  expect(selectionBox!.style.width).toBe('240px');
  expect(selectionBox!.style.height).toBe('100px');
  const resizeHandles = Array.from(selectionBox!.querySelectorAll<HTMLElement>('[style]'))
    .filter(element => element.style.cursor.endsWith('-resize'));
  expect(resizeHandles).toHaveLength(8);
});

it('scales every selected layer from the combined selection handle', async () => {
  const onKeyboardCommit = vi.fn();
  const current: ProjectState = { ...project('multi-resize'), selectedLayerId: 'second', layers: [
    { id: 'first', name: 'First', type: 'image', content: 'data:image/png;base64,AAAA', x: 20, y: 20, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 },
    { id: 'second', name: 'Second', type: 'image', content: 'data:image/png;base64,AAAA', x: 160, y: 20, width: 100, height: 100, rotation: 0, zIndex: 2, visible: true, locked: false, opacity: 1 }
  ] };
  await act(async () => root.render(<Canvas lang="zh" project={current} selectedLayerIds={['first', 'second']} onSelectLayer={() => {}} updateLayer={() => {}} onKeyboardCommit={onKeyboardCommit} onCommit={() => {}} />));
  const handle = Array.from(host.querySelectorAll<HTMLElement>('.multi-selection-box [style]')).find(element => element.style.cursor === 'se-resize')!;
  await act(async () => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 20 })));
  await act(async () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 70 })));
  await act(async () => window.dispatchEvent(new MouseEvent('mouseup')));
  expect(onKeyboardCommit).toHaveBeenCalledOnce();
  const committed = onKeyboardCommit.mock.calls[0][0](current);
  expect(committed.layers[0].width).toBeGreaterThan(100);
  expect(committed.layers[1].width).toBeGreaterThan(100);
  expect(committed.layers[0].x).toBeCloseTo(20);
  expect(committed.layers[1].x).toBeGreaterThan(160);
});

it('snaps guides from the combined multi-selection bounds', async () => {
  const current: ProjectState = { ...project('multi-snap'), selectedLayerId: 'second', layers: [
    { id: 'first', name: 'First', type: 'image', content: 'data:image/png;base64,AAAA', x: 100, y: 100, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 },
    { id: 'second', name: 'Second', type: 'image', content: 'data:image/png;base64,AAAA', x: 500, y: 200, width: 100, height: 100, rotation: 0, zIndex: 2, visible: true, locked: false, opacity: 1 }
  ] };
  await act(async () => root.render(<Canvas lang="zh" project={current} selectedLayerIds={['first', 'second']} onSelectLayer={() => {}} updateLayer={() => {}} onKeyboardCommit={() => {}} onCommit={() => {}} />));
  const layers = host.querySelectorAll<HTMLDivElement>('#export-target > .group');
  await act(async () => layers[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 20 })));
  await act(async () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20 + 450 * 0.545, clientY: 20 })));
  const guide = Array.from(host.querySelectorAll<HTMLElement>('#export-target [style]')).find(element => element.style.left === '800px' && element.style.width === '1px');
  expect(guide).toBeDefined();
  expect(parseFloat(layers[0].style.left)).toBeCloseTo(550);
  expect(parseFloat(layers[1].style.left)).toBeCloseTo(950);
});

it('moves every selected layer together with one committed transform', async () => {
  const updateLayer = vi.fn();
  const onKeyboardCommit = vi.fn();
  const current: ProjectState = { ...project('multi-drag'), selectedLayerId: 'second', layers: [
    { id: 'first', name: 'First', type: 'image', content: 'data:image/png;base64,AAAA', x: 100, y: 100, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 },
    { id: 'second', name: 'Second', type: 'image', content: 'data:image/png;base64,AAAA', x: 250, y: 160, width: 100, height: 100, rotation: 0, zIndex: 2, visible: true, locked: false, opacity: 1 }
  ] };
  await act(async () => root.render(<Canvas lang="zh" project={current} selectedLayerIds={['first', 'second']} onSelectLayer={() => {}} updateLayer={updateLayer} onKeyboardCommit={onKeyboardCommit} onCommit={() => {}} />));
  const layers = host.querySelectorAll<HTMLDivElement>('#export-target > .group');
  await act(async () => layers[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 20 })));
  await act(async () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 50 })));
  const offsetX = 20 / 0.545;
  const offsetY = 30 / 0.545;
  expect(parseFloat(layers[0].style.left)).toBeCloseTo(100 + offsetX);
  expect(parseFloat(layers[1].style.left)).toBeCloseTo(250 + offsetX);
  expect(parseFloat(layers[0].style.top)).toBeCloseTo(100 + offsetY);
  expect(parseFloat(layers[1].style.top)).toBeCloseTo(160 + offsetY);
  await act(async () => window.dispatchEvent(new MouseEvent('mouseup')));
  expect(updateLayer).not.toHaveBeenCalled();
  expect(onKeyboardCommit).toHaveBeenCalledOnce();
  const committed = onKeyboardCommit.mock.calls[0][0](current);
  expect(committed.layers[0].x).toBeCloseTo(100 + offsetX);
  expect(committed.layers[1].x).toBeCloseTo(250 + offsetX);
});

it('previews continuous dragging locally and commits the final position once', async () => {
  const updateLayer = vi.fn();
  const onCommit = vi.fn();
  const buildFilters = vi.spyOn(imageLayer, 'buildImageFilterCss');
  const current: ProjectState = { ...project('drag'), layers: [
    { id: 'image', name: 'Image', type: 'image', content: 'data:image/png;base64,AAAA', x: 100, y: 100, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }
  ] };
  await act(async () => root.render(<Canvas lang="zh" project={current} onSelectLayer={() => {}} updateLayer={updateLayer} onKeyboardCommit={() => {}} onCommit={onCommit} />));
  const layer = host.querySelector<HTMLDivElement>('#export-target > .group')!;
  await act(async () => layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 20 })));
  await act(async () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 40 })));
  await act(async () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 50 })));
  expect(parseFloat(layer.style.left)).toBeCloseTo(100 + 40 / 0.545);
  expect(buildFilters).toHaveBeenCalledOnce();
  expect(updateLayer).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new MouseEvent('mouseup')));
  expect(updateLayer).toHaveBeenCalledExactlyOnceWith('image', { x: 100 + 40 / 0.545, y: 100 + 30 / 0.545 }, true);
  expect(onCommit).not.toHaveBeenCalled();
});

it('previews group movement for child layers and discards a draft when switching pages', async () => {
  const updateLayer = vi.fn();
  const current: ProjectState = { ...project('group'), selectedLayerId: 'group', layers: [
    { id: 'child', parentId: 'group', name: 'Image', type: 'image', content: 'data:image/png;base64,AAAA', x: 100, y: 100, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 },
    { id: 'group', name: 'Group', type: 'group', content: '', children: ['child'], x: 100, y: 100, width: 100, height: 100, rotation: 0, zIndex: 2, visible: true, locked: false, opacity: 1 }
  ] };
  const render = async (value: ProjectState) => act(async () => root.render(<Canvas lang="zh" project={value} onSelectLayer={() => {}} updateLayer={updateLayer} onKeyboardCommit={() => {}} onCommit={() => {}} />));
  await render(current);
  const group = host.querySelector<HTMLDivElement>('#export-target > [style*="z-index: 9999"]')!;
  await act(async () => group.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 20 })));
  await act(async () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 50 })));
  expect(parseFloat(host.querySelector<HTMLDivElement>('#export-target > .group')!.style.left)).toBeCloseTo(100 + 40 / 0.545);
  await render({ ...current, activePageId: 'other' });
  await act(async () => window.dispatchEvent(new MouseEvent('mouseup')));
  expect(updateLayer).not.toHaveBeenCalled();
});

it('commits the final drag when the window loses focus', async () => {
  const updateLayer = vi.fn();
  const current: ProjectState = { ...project('blur'), layers: [
    { id: 'image', name: 'Image', type: 'image', content: 'data:image/png;base64,AAAA', x: 100, y: 100, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }
  ] };
  await act(async () => root.render(<Canvas lang="zh" project={current} onSelectLayer={() => {}} updateLayer={updateLayer} onKeyboardCommit={() => {}} onCommit={() => {}} />));
  await act(async () => host.querySelector<HTMLDivElement>('#export-target > .group')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 20 })));
  await act(async () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 50 })));
  await act(async () => window.dispatchEvent(new Event('blur')));
  await act(async () => window.dispatchEvent(new MouseEvent('mouseup')));
  expect(updateLayer).toHaveBeenCalledExactlyOnceWith('image', { x: 100 + 40 / 0.545, y: 100 + 30 / 0.545 }, true);
});

it('previews repeated keyboard transforms without committing until key release', async () => {
  const onKeyboardCommit = vi.fn();
  const current: ProjectState = { ...project('keyboard'), selectedLayerId: 'image', layers: [
    { id: 'image', name: 'Image', type: 'image', content: 'data:image/png;base64,AAAA', x: 100, y: 100, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }
  ] };
  await act(async () => root.render(<Canvas lang="zh" project={current} onSelectLayer={() => {}} updateLayer={() => {}} onKeyboardCommit={onKeyboardCommit} onCommit={() => {}} />));
  const layer = host.querySelector<HTMLDivElement>('#export-target > .group')!;
  const transform: KeyboardLayerTransform = { projectId: current.id, pageId: current.activePageId, layerIds: ['image'], key: 'ArrowRight', dx: 1, dy: 0, rotation: 0 };
  await act(async () => {
    window.dispatchEvent(new CustomEvent(KEYBOARD_LAYER_TRANSFORM, { detail: transform }));
    window.dispatchEvent(new CustomEvent(KEYBOARD_LAYER_TRANSFORM, { detail: transform }));
  });
  expect(layer.style.left).toBe('102px');
  expect(onKeyboardCommit).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })));
  expect(onKeyboardCommit).toHaveBeenCalledOnce();
  const moved = onKeyboardCommit.mock.calls[0][0](current);
  expect(moved.layers[0].x).toBe(102);
  await act(async () => root.render(<Canvas lang="zh" project={moved} onSelectLayer={() => {}} updateLayer={() => {}} onKeyboardCommit={onKeyboardCommit} onCommit={() => {}} />));
  const rotate = { ...transform, dx: 0, rotation: 5 };
  await act(async () => {
    window.dispatchEvent(new CustomEvent(KEYBOARD_LAYER_TRANSFORM, { detail: rotate }));
    window.dispatchEvent(new CustomEvent(KEYBOARD_LAYER_TRANSFORM, { detail: rotate }));
  });
  expect(layer.style.transform).toContain('rotate(10deg)');
  expect(onKeyboardCommit).toHaveBeenCalledOnce();
  await act(async () => window.dispatchEvent(new Event('blur')));
  expect(onKeyboardCommit).toHaveBeenCalledTimes(2);
  expect(onKeyboardCommit.mock.calls[1][0](moved).layers[0].rotation).toBe(10);
});

it('commits a held keyboard movement before undo and records one history entry', async () => {
  const initial = syncProjectPages({ ...project('keyboard-history'), selectedLayerId: 'image', layers: [
    { id: 'image', name: 'Image', type: 'image', content: 'data:image/png;base64,AAAA', x: 100, y: 100, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }
  ] });
  let latest = initial;
  function Harness() {
    const [current, setCurrent] = useState<ProjectState | null>(initial);
    const history = useProjectHistory(current, update => setCurrent(previous => {
      const next = typeof update === 'function' ? update(previous) : update;
      return next ? syncProjectPages(next) : null;
    }));
    latest = current!;
    useEditorShortcuts({ view: 'editor', project: current, aiBusy: false, selectedLayerIds: ['image'],
      handleUndo: history.handleUndo, handleRedo: history.handleRedo, performAutoSave: () => {}, modifyProject: history.modifyProject,
      updateLayer: () => {}, handleDeleteLayers: () => {}, handleCloneLayers: () => {}, handleGroupLayers: () => {},
      addSvgLayerWithContent: () => {}, addImageLayerWithContent: () => {}, addTextLayerWithContent: () => {}, applyProjectFromJson: () => {} });
    return <Canvas lang="zh" project={current!} onSelectLayer={() => {}} updateLayer={() => {}} onKeyboardCommit={history.modifyProject} onCommit={history.saveHistorySnapshot} />;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, repeat: true }));
  });
  expect(latest.layers[0].x).toBe(100);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(latest.layers[0].x).toBe(100);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })));
  expect(latest.layers[0].x).toBe(102);
});

it('renders panel drafts locally without changing the committed project', async () => {
  const updateLayer = vi.fn();
  const current: ProjectState = { ...project('panel'), selectedLayerId: 'image', layers: [
    { id: 'image', name: 'Image', type: 'image', content: 'data:image/png;base64,AAAA', x: 100, y: 100, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }
  ] };
  await act(async () => root.render(<Canvas lang="zh" project={current} onSelectLayer={() => {}} updateLayer={updateLayer} onKeyboardCommit={() => {}} onCommit={() => {}} />));
  await act(async () => window.dispatchEvent(new CustomEvent(PANEL_LAYER_DRAFT, { detail: { pageKey: `${current.id}:${current.activePageId}`, layerId: 'image', updates: { x: 130, rotation: 45 } } })));
  const layer = host.querySelector<HTMLDivElement>('#export-target > .group')!;
  expect(layer.style.left).toBe('130px');
  expect(layer.style.transform).toContain('rotate(45deg)');
  expect(updateLayer).not.toHaveBeenCalled();
  expect(current.layers[0].x).toBe(100);
});