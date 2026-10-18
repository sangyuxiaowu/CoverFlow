import { useId, useLayoutEffect, useRef, useState, type RefObject, type KeyboardEvent, type PointerEvent } from 'react';

interface Props {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  scrollTo: (top: number) => void;
  english: boolean;
}

export default function ChatScrollbar({ scrollRef, contentRef, scrollTo, english }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<number | null>(null);
  const logId = useId();
  const [metrics, setMetrics] = useState({ top: 0, height: 24, max: 0, value: 0 });

  const measure = () => {
    const element = scrollRef.current;
    const track = trackRef.current;
    if (!element || !track) return { top: 0, height: 24, max: 0, value: 0 };
    const max = Math.max(0, element.scrollHeight - element.clientHeight);
    const value = Math.max(0, Math.min(max, element.scrollTop));
    const height = Math.min(track.clientHeight, Math.max(24, track.clientHeight * element.clientHeight / Math.max(1, element.scrollHeight)));
    return { top: max ? value / max * (track.clientHeight - height) : 0, height, max, value };
  };

  const update = () => {
    const next = measure();
    setMetrics(previous => previous.top === next.top && previous.height === next.height && previous.max === next.max && previous.value === next.value ? previous : next);
  };

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    const track = trackRef.current;
    if (!element || !content || !track) return;
    element.id = logId;
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(content);
    observer.observe(track);
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
      if (element.id === logId) element.removeAttribute('id');
    };
  }, [scrollRef, contentRef, logId]);

  const moveTo = (clientY: number) => {
    const track = trackRef.current;
    if (!track || dragOffset.current === null) return;
    const current = measure();
    const travel = track.clientHeight - current.height;
    if (travel <= 0) return;
    scrollTo((clientY - track.getBoundingClientRect().top - dragOffset.current) / travel * current.max);
    update();
  };

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const current = measure();
    if (!current.max) return;
    event.preventDefault();
    const position = event.clientY - event.currentTarget.getBoundingClientRect().top;
    dragOffset.current = position >= current.top && position <= current.top + current.height ? position - current.top : current.height / 2;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveTo(event.clientY);
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    dragOffset.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    if (!element) return;
    const current = measure();
    const positions: Record<string, number> = {
      ArrowUp: current.value - 40,
      ArrowDown: current.value + 40,
      PageUp: current.value - element.clientHeight * 0.9,
      PageDown: current.value + element.clientHeight * 0.9,
      Home: 0,
      End: current.max
    };
    if (!Object.hasOwn(positions, event.key)) return;
    event.preventDefault();
    scrollTo(positions[event.key]);
    update();
  };

  return <div
    ref={trackRef}
    className="cf-ai-scrollbar"
    role="scrollbar"
    aria-label={english ? 'Scroll conversation' : '滚动对话'}
    aria-controls={logId}
    aria-orientation="vertical"
    aria-valuemin={0}
    aria-valuemax={Math.round(metrics.max)}
    aria-valuenow={Math.round(metrics.value)}
    aria-disabled={metrics.max <= 1}
    tabIndex={metrics.max > 1 ? 0 : -1}
    style={{ visibility: metrics.max > 1 ? 'visible' : 'hidden' }}
    onPointerDown={start}
    onPointerMove={event => moveTo(event.clientY)}
    onPointerUp={finish}
    onPointerCancel={finish}
    onLostPointerCapture={() => { dragOffset.current = null; }}
    onKeyDown={onKeyDown}
  >
    <span className="cf-ai-scrollbar-thumb" style={{ height: metrics.height, transform: `translateY(${metrics.top}px)` }} />
  </div>;
}