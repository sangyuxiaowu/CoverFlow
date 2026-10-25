// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useChatScroll } from './useChatScroll.ts';

afterEach(() => { vi.unstubAllGlobals(); });

it('keeps following growing content but leaves upward scrolling alone until the actual bottom', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  };
  const observers: { notify: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn();
    observe = vi.fn();
    constructor(notify: () => void) { observers.push({ notify, disconnect: this.disconnect }); }
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  let height = 1000;
  let top = 0;
  const writes = vi.fn((value: number) => { top = Math.max(0, Math.min(value, height - 200)); });
  let resetScroll: () => void = () => {};
  function Harness({ sessionId = 'first', visible = true, revision = 0 }) {
    const scroll = useChatScroll(sessionId, visible);
    resetScroll = scroll.resetScroll;
    return visible ? <div ref={scroll.scrollRef} onScroll={scroll.onScroll} onWheel={scroll.onWheel}>
      <div ref={scroll.contentRef}>{revision}</div>
    </div> : null;
  }
  try {
    await act(async () => { root.render(<Harness />); });
    const element = container.firstElementChild as HTMLDivElement;
    Object.defineProperties(element, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 200 },
      scrollTop: { get: () => top, set: writes }
    });
    const scrollTo = async (value: number) => {
      await act(async () => { element.scrollTop = value; element.dispatchEvent(new Event('scroll')); });
    };
    observers[0].notify();
    expect(top).toBe(0);
    expect(frames.size).toBe(1);
    observers[0].notify();
    expect(frames.size).toBe(1);
    flushFrames();
    expect(top).toBe(800);
    writes.mockClear();
    observers[0].notify();
    flushFrames();
    expect(writes).not.toHaveBeenCalled();
    await act(async () => { root.render(<Harness revision={1} />); });
    expect(frames.size).toBe(0);
    await scrollTo(780);
    height = 1100;
    await act(async () => { root.render(<Harness revision={1} />); });
    observers[0].notify();
    flushFrames();
    expect(top).toBe(780);
    await scrollTo(880);
    height = 1200;
    observers[0].notify();
    flushFrames();
    expect(top).toBe(880);
    await scrollTo(1000);
    height = 1300;
    observers[0].notify();
    flushFrames();
    expect(top).toBe(1100);
    height = 1200;
    await scrollTo(1000);
    height = 1300;
    observers[0].notify();
    flushFrames();
    expect(top).toBe(1100);
    height = 1400;
    observers[0].notify();
    expect(frames.size).toBe(1);
    await act(async () => { element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -20 })); });
    expect(frames.size).toBe(0);
    observers[0].notify();
    flushFrames();
    expect(top).toBe(1100);
    await scrollTo(500);
    await act(async () => { resetScroll(); });
    flushFrames();
    expect(top).toBe(1200);
    await scrollTo(600);
    await act(async () => { root.render(<Harness sessionId="second" />); });
    flushFrames();
    expect(top).toBe(1200);
    await act(async () => { root.render(<Harness visible={false} />); });
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    await act(async () => { root.render(<Harness />); });
    expect(observers).toHaveLength(2);
  } finally { await act(async () => root.unmount()); }
  expect(observers[1].disconnect).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
});

it('uses current DOM bounds for wheel input even when native scrolling is stuck', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const container = document.createElement('div');
  container.className = 'cf-ai-messages-region';
  const root = createRoot(container);
  function Harness() {
    const scroll = useChatScroll('wheel', true);
    return <div ref={scroll.scrollRef} onScroll={scroll.onScroll} onWheel={scroll.onWheel}>
      <div ref={scroll.contentRef}><pre style={{ overflowY: 'auto' }}>code</pre></div>
    </div>;
  }
  try {
    await act(async () => { root.render(<Harness />); });
    const element = container.firstElementChild as HTMLDivElement;
    let height = 1000;
    let top = 126;
    Object.defineProperties(element, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 200 },
      scrollTop: { get: () => top, set: (value: number) => { top = value; } }
    });
    const wheel = (target: Element, deltaY: number, options: WheelEventInit = {}) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, ...options });
      target.dispatchEvent(event);
      return event;
    };
    expect(wheel(element, 1000).defaultPrevented).toBe(true);
    expect(top).toBe(800);
    height = 1600;
    wheel(element, 1000);
    expect(top).toBe(1400);
    wheel(element, -10, { deltaMode: 1 });
    expect(top).toBe(1240);
    wheel(element, -1, { deltaMode: 2 });
    expect(top).toBe(1040);
    expect(wheel(element, 100, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(element, 100, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(wheel(element, 100, { deltaX: 200 }).defaultPrevented).toBe(false);
    expect(top).toBe(1040);
    const nested = element.querySelector('pre')!;
    Object.defineProperties(nested, {
      scrollHeight: { value: 500 }, clientHeight: { value: 100 }, scrollTop: { value: 50, writable: true }
    });
    expect(wheel(nested, 100).defaultPrevented).toBe(false);
    expect(top).toBe(1040);
    nested.scrollTop = 400;
    expect(wheel(nested, 100).defaultPrevented).toBe(true);
    expect(top).toBe(1140);
    const track = document.createElement('div');
    container.append(track);
    expect(wheel(track, 1000).defaultPrevented).toBe(true);
    expect(top).toBe(1400);
    track.remove();
    await act(async () => { root.unmount(); });
    expect(wheel(element, 100).defaultPrevented).toBe(false);
    expect(top).toBe(1400);
  } finally { if (container.firstChild) await act(async () => root.unmount()); }
});

it.each([
  { name: 'Ctrl zoom', height: 1000, flushInitial: true, options: { ctrlKey: true } },
  { name: 'Shift horizontal scroll', height: 1000, flushInitial: true, options: { shiftKey: true } },
  { name: 'horizontal gesture', height: 1000, flushInitial: true, options: { deltaX: 200 } },
  { name: 'content that fits', height: 100, flushInitial: true, options: {} },
  { name: 'upward input already at the top', height: 1000, flushInitial: false, options: {} },
  { name: 'already handled input', height: 1000, flushInitial: true, options: {}, prevented: true }
])('keeps following after $name without upward movement', async ({ height: initialHeight, flushInitial, options, prevented }) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  };
  let notify = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notify = callback; }
    observe() {}
    disconnect() {}
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  let height = initialHeight;
  let top = 0;
  function Harness() {
    const scroll = useChatScroll('intent', true);
    return <div ref={scroll.scrollRef} onScroll={scroll.onScroll} onWheel={scroll.onWheel}>
      <div ref={scroll.contentRef} />
    </div>;
  }
  try {
    await act(async () => { root.render(<Harness />); });
    const element = container.firstElementChild as HTMLDivElement;
    Object.defineProperties(element, {
      scrollHeight: { get: () => height },
      clientHeight: { value: 200 },
      scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, Math.max(0, height - 200))); } }
    });
    if (flushInitial) flushFrames();
    const before = top;
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ...options });
    if (prevented) event.preventDefault();
    await act(async () => { element.dispatchEvent(event); });
    expect(top).toBe(before);
    height = 1200;
    notify();
    flushFrames();
    expect(top).toBe(1000);
  } finally { await act(async () => root.unmount()); }
});

it('keeps manual scrolling active in history without following it or changing the chat follow preference', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  };
  let notify = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notify = callback; }
    observe() {}
    disconnect() {}
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  let height = 1000;
  let top = 0;
  function Harness({ history = false }) {
    const scroll = useChatScroll('history', true, !history);
    return <div ref={scroll.scrollRef} onScroll={scroll.onScroll} onWheel={scroll.onWheel}>
      <div ref={scroll.contentRef} />
    </div>;
  }
  try {
    await act(async () => { root.render(<Harness />); });
    const element = container.firstElementChild as HTMLDivElement;
    Object.defineProperties(element, {
      scrollHeight: { get: () => height }, clientHeight: { value: 200 },
      scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, height - 200)); } }
    });
    flushFrames();
    expect(top).toBe(800);
    notify();
    expect(frames.size).toBe(1);
    await act(async () => { root.render(<Harness history />); });
    expect(frames.size).toBe(0);
    expect(top).toBe(0);
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 300 });
    await act(async () => { element.dispatchEvent(wheel); element.dispatchEvent(new Event('scroll')); });
    expect(wheel.defaultPrevented).toBe(true);
    expect(top).toBe(300);
    height = 1400;
    notify();
    flushFrames();
    expect(top).toBe(300);
    await act(async () => { root.render(<Harness />); });
    flushFrames();
    expect(top).toBe(1200);
    await act(async () => {
      element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -200 }));
      element.dispatchEvent(new Event('scroll'));
    });
    expect(top).toBe(1000);
    await act(async () => { root.render(<Harness history />); });
    expect(top).toBe(0);
    await act(async () => {
      element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 1000 }));
      element.dispatchEvent(new Event('scroll'));
    });
    height = 1600;
    await act(async () => { root.render(<Harness />); });
    notify();
    flushFrames();
    expect(top).toBe(1000);
  } finally { await act(async () => root.unmount()); }
});