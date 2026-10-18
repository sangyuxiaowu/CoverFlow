import { useLayoutEffect, useRef, type UIEvent, type WheelEvent } from 'react';

export function useChatScroll(sessionId: string | null, visible: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousTop = useRef(0);

  const scrollToBottom = () => {
    const element = scrollRef.current;
    if (!element || !following.current) return;
    element.scrollTop = element.scrollHeight;
    previousTop.current = element.scrollTop;
  };

  const resetScroll = () => {
    following.current = true;
    scrollToBottom();
  };

  useLayoutEffect(resetScroll, [sessionId]);
  useLayoutEffect(() => { if (visible) scrollToBottom(); });

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!visible || !element || !content) return;
    const observer = new ResizeObserver(scrollToBottom);
    observer.observe(element);
    observer.observe(content);
    return () => observer.disconnect();
  }, [visible]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const top = element.scrollTop;
    if (element.scrollHeight - top - element.clientHeight <= 1) {
      following.current = true;
    } else if (top < previousTop.current) {
      following.current = false;
    }
    previousTop.current = top;
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) following.current = false;
  };

  return { scrollRef, contentRef, onScroll, onWheel, resetScroll };
}