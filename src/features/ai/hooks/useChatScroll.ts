import { useLayoutEffect, useRef, type UIEvent, type WheelEvent } from 'react';

export function useChatScroll(sessionId: string | null, visible: boolean, autoFollow = true) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousTop = useRef(0);
  const pendingFrame = useRef<number | null>(null);

  const scrollToBottom = () => {
    const element = scrollRef.current;
    if (!element || !following.current) return;
    const bottom = Math.max(0, element.scrollHeight - element.clientHeight);
    if (Math.abs(element.scrollTop - bottom) > 1) element.scrollTop = bottom;
    previousTop.current = element.scrollTop;
  };

  const cancelScroll = () => {
    if (pendingFrame.current === null) return;
    cancelAnimationFrame(pendingFrame.current);
    pendingFrame.current = null;
  };

  const scheduleScroll = () => {
    if (!visible || !autoFollow || !following.current || pendingFrame.current !== null) return;
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = null;
      scrollToBottom();
    });
  };

  const resetScroll = () => {
    following.current = true;
    scheduleScroll();
  };

  const scrollManually = (top: number) => {
    const element = scrollRef.current;
    if (!element) return;
    cancelScroll();
    const bottom = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = Math.max(0, Math.min(bottom, top));
    previousTop.current = element.scrollTop;
    if (autoFollow) following.current = bottom - element.scrollTop <= 1;
  };

  useLayoutEffect(resetScroll, [sessionId]);
  useLayoutEffect(() => {
    if (visible && autoFollow) scheduleScroll();
    else {
      cancelScroll();
      if (visible) scrollManually(0);
    }
  }, [visible, autoFollow]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!visible || !element || !content) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      if (!event.cancelable || event.defaultPrevented || event.ctrlKey || event.shiftKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const delta = event.deltaY * unit;
      let target = event.target instanceof Element && element.contains(event.target) ? event.target : null;
      while (target && target !== element) {
        const overflow = getComputedStyle(target).overflowY;
        if (/^(auto|scroll)$/.test(overflow) && target.scrollHeight > target.clientHeight && (delta < 0 ? target.scrollTop > 0 : target.scrollTop + target.clientHeight < target.scrollHeight - 1)) return;
        target = target.parentElement;
      }
      event.preventDefault();
      const bottom = Math.max(0, element.scrollHeight - element.clientHeight);
      const nextTop = Math.max(0, Math.min(bottom, element.scrollTop + delta));
      if (nextTop !== element.scrollTop) scrollManually(nextTop);
    };
    const wheelTarget = element.closest('.cf-ai-messages-region') || element;
    wheelTarget.addEventListener('wheel', handleWheel as EventListener, { passive: false });
    const observer = new ResizeObserver(scheduleScroll);
    observer.observe(element);
    observer.observe(content);
    return () => {
      observer.disconnect();
      wheelTarget.removeEventListener('wheel', handleWheel as EventListener);
      cancelScroll();
    };
  }, [visible, autoFollow]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const top = element.scrollTop;
    if (!autoFollow) {
      previousTop.current = top;
      return;
    }
    if (element.scrollHeight - top - element.clientHeight <= 1) {
      following.current = true;
    } else if (top < previousTop.current) {
      following.current = false;
      cancelScroll();
    }
    previousTop.current = top;
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!autoFollow || event.defaultPrevented || event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const element = event.currentTarget;
    if (event.deltaY < 0 && element.scrollTop > 0 && element.scrollHeight > element.clientHeight + 1) {
      following.current = false;
      cancelScroll();
    }
  };

  return { scrollRef, contentRef, onScroll, onWheel, resetScroll, scrollManually };
}