// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useChatScroll } from './useChatScroll.ts';

afterEach(() => { vi.unstubAllGlobals(); });

it('keeps following growing content but leaves upward scrolling alone until the actual bottom', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
      scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, height - 200)); } }
    });
    const scrollTo = async (value: number) => {
      await act(async () => { element.scrollTop = value; element.dispatchEvent(new Event('scroll')); });
    };
    observers[0].notify();
    expect(top).toBe(800);
    await scrollTo(780);
    height = 1100;
    await act(async () => { root.render(<Harness revision={1} />); });
    observers[0].notify();
    expect(top).toBe(780);
    await scrollTo(880);
    height = 1200;
    observers[0].notify();
    expect(top).toBe(880);
    await scrollTo(1000);
    height = 1300;
    observers[0].notify();
    expect(top).toBe(1100);
    height = 1200;
    await scrollTo(1000);
    height = 1300;
    observers[0].notify();
    expect(top).toBe(1100);
    await act(async () => { element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -20 })); });
    height = 1400;
    observers[0].notify();
    expect(top).toBe(1100);
    await scrollTo(500);
    await act(async () => { resetScroll(); });
    expect(top).toBe(1200);
    await scrollTo(600);
    await act(async () => { root.render(<Harness sessionId="second" />); });
    expect(top).toBe(1200);
    await act(async () => { root.render(<Harness visible={false} />); });
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    await act(async () => { root.render(<Harness />); });
    expect(observers).toHaveLength(2);
  } finally { await act(async () => root.unmount()); }
  expect(observers[1].disconnect).toHaveBeenCalledOnce();
});