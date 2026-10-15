import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clampFloatingRect, type FloatingRect } from '../domain/floatingGeometry.ts';
import type { ChatStore } from '../services/chatStore.ts';

export function useFloatingPanel(store: ChatStore) {
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [rect, setRect] = useState<FloatingRect>(() => {
    return { x: Math.max(10, window.innerWidth - 544), y: Math.max(10, window.innerHeight - 664), width: 520, height: 640 };
  });
  const [loadedStore, setLoadedStore] = useState<ChatStore | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; start: FloatingRect; resizing: boolean } | null>(null);
  const displayed = maximized ? { x: 10, y: 10, width: Math.max(1, viewport.width - 20), height: Math.max(1, viewport.height - 20) } : clampFloatingRect(rect, viewport, minimized);
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    let active = true;
    setLoadedStore(null);
    void store.loadUiState().then(state => {
      if (!active) return;
      if (state.floatingRect && ['x', 'y', 'width', 'height'].every(field => Number.isFinite(state.floatingRect![field as keyof FloatingRect]))) setRect(state.floatingRect);
      setLoadedStore(store);
    }).catch(() => {});
    return () => { active = false; };
  }, [store]);
  useEffect(() => {
    if (loadedStore !== store) return;
    const timer = window.setTimeout(() => { void store.saveUiState({ floatingRect: rect }).catch(() => {}); }, 200);
    return () => window.clearTimeout(timer);
  }, [rect, loadedStore, store]);
  const start = (event: PointerEvent<HTMLElement>, resizing = false) => {
    if (maximized || event.button !== 0 || (!resizing && (event.target as HTMLElement).closest('button, input, select, textarea'))) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, start: displayed, resizing };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - active.clientX;
    const deltaY = event.clientY - active.clientY;
    const next = active.resizing ? { ...active.start, width: active.start.width + deltaX, height: active.start.height + deltaY } : { ...active.start, x: active.start.x + deltaX, y: active.start.y + deltaY };
    setRect(clampFloatingRect(next, viewport, minimized));
  };
  const finish = () => { drag.current = null; };
  const toggleMaximized = () => { setMinimized(false); setMaximized(previous => !previous); };
  return {
    minimized, maximized, setMinimized, toggleMaximized,
    style: { left: displayed.x, top: displayed.y, width: displayed.width, height: minimized ? Math.min(64, displayed.height) : displayed.height },
    headerEvents: { onPointerDown: (event: PointerEvent<HTMLElement>) => start(event), onPointerMove: move, onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish },
    resizeEvents: { onPointerDown: (event: PointerEvent<HTMLElement>) => start(event, true), onPointerMove: move, onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish },
    resizeByKeyboard: (key: string, large: boolean) => {
      const step = large ? 40 : 10;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
      setRect(clampFloatingRect({ ...displayed, width: displayed.width + (key === 'ArrowRight' ? step : key === 'ArrowLeft' ? -step : 0), height: displayed.height + (key === 'ArrowDown' ? step : key === 'ArrowUp' ? -step : 0) }, viewport));
    }
  };
}