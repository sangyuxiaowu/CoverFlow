// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProjectPreview from './ProjectPreview.tsx';
import type { ProjectState } from '../types.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { insertProjectPage, pageProject } from '../utils/projectPages.ts';

vi.mock('./LivePreview.tsx', () => ({ default: ({ project }: { project: ProjectState }) => (
  <div data-preview-page={project.activePageId} data-width={project.canvasConfig.width} data-height={project.canvasConfig.height} />
) }));

let host: HTMLDivElement;
let root: Root;
let fullscreen: Element | null;
const request = vi.fn<() => Promise<void>>();
const exit = vi.fn<() => Promise<void>>();
const originalRequest = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestFullscreen');
const originalExit = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
const originalFullscreen = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fullscreen = null;
  request.mockReset().mockRejectedValue(new Error('Fullscreen unavailable'));
  exit.mockReset().mockImplementation(async () => { fullscreen = null; });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  for (const [target, key, descriptor] of [
    [HTMLElement.prototype, 'requestFullscreen', originalRequest],
    [document, 'exitFullscreen', originalExit],
    [document, 'fullscreenElement', originalFullscreen]
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
  vi.unstubAllGlobals();
});

const makeProject = () => {
  const first = syncProjectPages({ id: 'presentation', title: 'Demo', layers: [], selectedLayerId: null, updatedAt: 1,
    canvasConfig: { width: 900, height: 383, ratio: '2.35:1' },
    background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } });
  const second = insertProjectPage(first, 'Portrait', { width: 400, height: 800, ratio: '1:2' });
  return insertProjectPage(second, 'Last', { width: 600, height: 600, ratio: '1:1' });
};
const button = (label: string) => document.querySelector<HTMLButtonElement>(`[role="dialog"] button[aria-label="${label}"]`)!;
const counter = () => document.querySelector('[role="dialog"] [aria-live="polite"]')!.textContent;
const press = async (key: string, shiftKey = false) => act(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
});

it('starts on the active page, navigates in order and never changes the editing project', async () => {
  const project = makeProject();
  const before = JSON.stringify(project);
  await act(async () => root.render(<ProjectPreview lang="zh" project={project} onClose={() => {}} />));
  expect(request).toHaveBeenCalledOnce();
  expect(counter()).toBe('3/3');
  expect(button('下一页').disabled).toBe(true);
  await act(async () => button('上一页').click());
  expect(counter()).toBe('2/3');
  expect(document.querySelector('[data-preview-page]')?.getAttribute('data-preview-page')).toBe(project.pages![1].id);
  expect(document.querySelector('[data-preview-page]')?.getAttribute('data-width')).toBe('400');
  expect(document.querySelector('[data-preview-page]')?.getAttribute('data-height')).toBe('800');
  await press('Home');
  expect(counter()).toBe('1/3');
  expect(button('上一页').disabled).toBe(true);
  await press(' ', true);
  expect(counter()).toBe('1/3');
  await press('ArrowDown');
  expect(counter()).toBe('2/3');
  await press('PageDown');
  await press('ArrowRight');
  expect(counter()).toBe('3/3');
  await press('ArrowUp');
  await press('PageUp');
  expect(counter()).toBe('1/3');
  await press('End');
  expect(counter()).toBe('3/3');
  expect(JSON.stringify(project)).toBe(before);
});

it('keeps single-page preview usable without fullscreen and isolates keyboard, paste and focus', async () => {
  const project = makeProject();
  const single = { ...project, pages: [project.pages![2]] };
  const close = vi.fn();
  const editorKey = vi.fn();
  const editorPaste = vi.fn();
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  document.body.style.overflow = 'scroll';
  window.addEventListener('keydown', editorKey);
  window.addEventListener('paste', editorPaste);
  try {
    await act(async () => root.render(<ProjectPreview lang="en" project={single} onClose={close} />));
    expect(counter()).toBe('1/1');
    expect(button('Previous page').disabled).toBe(true);
    expect(button('Next page').disabled).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    await press('Delete');
    await press(' ');
    await press(' ', true);
    expect(counter()).toBe('1/1');
    window.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
    expect(editorKey).not.toHaveBeenCalled();
    expect(editorPaste).not.toHaveBeenCalled();
    button('Exit preview').focus();
    await press('Tab');
    expect(document.activeElement).toBe(button('Enter full screen'));
    await press('Tab', true);
    expect(document.activeElement).toBe(button('Exit preview'));
    await press('Escape');
    expect(close).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(document.body.style.overflow).toBe('scroll');
    expect(document.activeElement).toBe(trigger);
    expect(exit).not.toHaveBeenCalled();
    await press('Delete');
    expect(editorKey).toHaveBeenCalledOnce();
  } finally {
    trigger.remove();
    document.body.style.overflow = '';
    window.removeEventListener('keydown', editorKey);
    window.removeEventListener('paste', editorPaste);
  }
});

it('handles native fullscreen exit and releases only the fullscreen it owns', async () => {
  request.mockImplementation(async function(this: HTMLElement) {
    fullscreen = this;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  const close = vi.fn();
  await act(async () => root.render(<ProjectPreview lang="zh" project={makeProject()} onClose={close} />));
  expect(fullscreen).toBe(document.querySelector('[role="dialog"]'));
  fullscreen = null;
  await act(async () => document.dispatchEvent(new Event('fullscreenchange')));
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(exit).not.toHaveBeenCalled();
  await act(async () => root.render(<ProjectPreview lang="zh" project={makeProject()} onClose={close} />));
  await act(async () => root.render(null));
  expect(exit).toHaveBeenCalledOnce();
});

it('supports touch swipes and ignores small or cancelled gestures', async () => {
  await act(async () => root.render(<ProjectPreview lang="zh" project={makeProject()} onClose={() => {}} />));
  const stage = document.querySelector('[data-preview-page]')!.parentElement!;
  const touch = async (type: string, x: number, y: number) => act(async () => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    stage.dispatchEvent(event);
  });
  await touch('pointerdown', 20, 20);
  await touch('pointerup', 100, 20);
  expect(counter()).toBe('2/3');
  await touch('pointerdown', 20, 100);
  await touch('pointerup', 20, 20);
  expect(counter()).toBe('3/3');
  await touch('pointerdown', 20, 20);
  await touch('pointerup', 40, 20);
  expect(counter()).toBe('3/3');
  await touch('pointerdown', 20, 20);
  await touch('pointercancel', 20, 20);
  await touch('pointerup', 100, 20);
  expect(counter()).toBe('3/3');
});

it('reuses viewport measurement across page changes and only remeasures on resize', async () => {
  const { default: LivePreview } = await vi.importActual<typeof import('./LivePreview.tsx')>('./LivePreview.tsx');
  const created = vi.fn();
  const observe = vi.fn();
  const disconnect = vi.fn();
  let resize = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { created(); resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 700));
  const project = makeProject();
  try {
    await act(async () => root.render(<LivePreview project={pageProject(project, project.pages![0])} />));
    expect(measure).toHaveBeenCalledOnce();
    expect(created).toHaveBeenCalledOnce();
    await act(async () => root.render(<LivePreview project={pageProject(project, project.pages![1])} />));
    expect(measure).toHaveBeenCalledOnce();
    expect(created).toHaveBeenCalledOnce();
    const canvas = () => Array.from(host.querySelectorAll('div')).find(element => element.style.width === '400px')!;
    expect(canvas().style.transform).toBe('scale(0.825)');
    measure.mockReturnValue(new DOMRect(0, 0, 390, 844));
    await act(async () => resize());
    expect(canvas().style.transform).toBe('scale(0.875)');
    expect(created).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(disconnect).toHaveBeenCalledOnce();
  } finally {
    measure.mockRestore();
  }
});