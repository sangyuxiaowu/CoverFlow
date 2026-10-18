// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import ChatScrollbar from './ChatScrollbar.tsx';

afterEach(() => vi.unstubAllGlobals());

it('drags to the actual bottom after content growth and supports keyboard scrolling', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const observers: (() => void)[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(notify: () => void) { observers.push(notify); }
    observe() {}
    disconnect = disconnect;
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  const element = document.createElement('div');
  const content = document.createElement('div');
  let height = 1600;
  let top = 126;
  Object.defineProperties(element, {
    scrollHeight: { get: () => height }, clientHeight: { value: 200 }, scrollTop: { get: () => top }
  });
  const scrollTo = vi.fn((value: number) => { top = Math.max(0, Math.min(height - 200, value)); });
  try {
    await act(async () => { root.render(<ChatScrollbar scrollRef={{ current: element }} contentRef={{ current: content }} scrollTo={scrollTo} english={false} />); });
    const track = container.firstElementChild as HTMLDivElement;
    Object.defineProperty(track, 'clientHeight', { value: 200 });
    track.setPointerCapture = vi.fn();
    track.hasPointerCapture = () => true;
    track.releasePointerCapture = vi.fn();
    await act(async () => { observers[0](); });
    expect(track.getAttribute('aria-controls')).toBe(element.id);
    expect(track.getAttribute('aria-valuemax')).toBe('1400');
    const pointer = async (type: string, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      await act(async () => { track.dispatchEvent(event); });
    };
    await pointer('pointerdown', 28);
    await pointer('pointermove', 200);
    expect(top).toBe(1400);
    height = 3000;
    await pointer('pointermove', 200);
    expect(top).toBe(2800);
    await pointer('pointerup', 200);
    expect(track.releasePointerCapture).toHaveBeenCalledWith(1);
    await pointer('pointermove', 0);
    expect(top).toBe(2800);
    const key = async (value: string) => {
      await act(async () => { track.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); });
    };
    await key('Home');
    expect(top).toBe(0);
    await key('End');
    expect(top).toBe(2800);
    await key('ArrowUp');
    expect(top).toBe(2760);
    await key('PageUp');
    expect(top).toBe(2580);
    height = 200;
    top = 0;
    await act(async () => { observers[0](); });
    expect(track.getAttribute('aria-disabled')).toBe('true');
    expect(track.style.visibility).toBe('hidden');
  } finally { await act(async () => root.unmount()); }
  expect(disconnect).toHaveBeenCalledOnce();
  expect(element.id).toBe('');
});