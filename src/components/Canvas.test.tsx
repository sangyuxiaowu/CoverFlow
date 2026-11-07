// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Canvas from './Canvas.tsx';
import type { ProjectState } from '../types.ts';

let host: HTMLDivElement;
let root: Root;

const project = (pageId: string, width = 1600, height = 800): ProjectState => ({
  id: 'canvas-project', activePageId: pageId, title: 'Canvas', layers: [], selectedLayerId: null,
  updatedAt: 1, canvasConfig: { width, height, ratio: `${width}:${height}` },
  background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 }
});

const renderCanvas = async (current: ProjectState, onCommit: () => void = () => {}) => {
  await act(async () => root.render(<Canvas lang="zh" project={current} onSelectLayer={() => {}} updateLayer={() => {}} onCommit={onCommit} />));
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