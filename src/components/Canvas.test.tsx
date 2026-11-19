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