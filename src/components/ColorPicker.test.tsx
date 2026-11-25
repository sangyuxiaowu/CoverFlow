// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ColorPicker from './ColorPicker.tsx';
import * as sampler from '../utils/pageColorSampler.ts';

vi.mock('../utils/pageColorSampler.ts', () => ({ capturePageColorSnapshot: vi.fn(), samplePageColor: vi.fn() }));
vi.mock('../utils/tauriRuntime.ts', () => ({ isTauriRuntime: () => true }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const change = vi.fn<(value: string) => void>();
const elementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => host });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.mocked(sampler.capturePageColorSnapshot).mockResolvedValue({ canvas: document.createElement('canvas'), rect: new DOMRect(0, 0, 100, 100) });
  vi.mocked(sampler.samplePageColor).mockReturnValue([59, 130, 246, 255]);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (elementFromPointDescriptor) Object.defineProperty(document, 'elementFromPoint', elementFromPointDescriptor);
  else Reflect.deleteProperty(document, 'elementFromPoint');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function openPicker() {
  function Harness() {
    const [value, setValue] = useState('rgba(255, 0, 0, 0.5)');
    return <ColorPicker lang="zh" name="Test" value={value} onChange={next => { change(next); setValue(next); }} />;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => host.querySelector<HTMLButtonElement>('.cf-color-swatch')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="页面内取色"]')!.click());
}

it('picks a page color without activating the underlying control and preserves format and alpha', async () => {
  const underlying = vi.fn();
  host.addEventListener('click', underlying);
  await openPicker();
  underlying.mockClear();
  expect(document.querySelector('.cf-eyedropper-status')?.textContent).toContain('点击取色');
  await act(async () => host.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 })));
  expect(underlying).not.toHaveBeenCalled();
  expect(change).toHaveBeenCalledWith('rgba(59, 130, 246, 0.5)');
  expect(document.body.classList.contains('cf-eyedropper-active')).toBe(false);
  expect(document.querySelector('.cf-eyedropper-status')).toBeNull();
});

it('cancels with Escape without changing color or closing the picker', async () => {
  await openPicker();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(change).not.toHaveBeenCalled();
  expect(document.querySelector('.cf-color-popover')).not.toBeNull();
  expect(document.body.classList.contains('cf-eyedropper-active')).toBe(false);
});

it('reports snapshot failures and restores the picker', async () => {
  vi.mocked(sampler.capturePageColorSnapshot).mockRejectedValue(new Error('capture failed'));
  await openPicker();
  expect(document.querySelector('.cf-color-error')?.textContent).toContain('页面取色失败');
  expect(document.body.classList.contains('cf-eyedropper-active')).toBe(false);
});

it('samples the visible content of a scrolled panel from its own snapshot', async () => {
  const panel = document.createElement('div');
  const content = document.createElement('div');
  const target = document.createElement('button');
  content.appendChild(target);
  panel.appendChild(content);
  document.body.appendChild(panel);
  panel.scrollTop = 30;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  const canvas = document.createElement('canvas');
  vi.mocked(sampler.capturePageColorSnapshot).mockImplementation(async element => ({ canvas: element === content ? canvas : document.createElement('canvas'), rect: new DOMRect(0, 0, 100, 100) }));
  try {
    await openPicker();
    await act(async () => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 })));
    expect(sampler.capturePageColorSnapshot).toHaveBeenCalledWith(content);
    expect(sampler.samplePageColor).toHaveBeenCalledWith(expect.objectContaining({ canvas }), 20, 30);
  } finally {
    panel.remove();
  }
});