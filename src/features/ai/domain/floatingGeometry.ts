export interface FloatingRect { x: number; y: number; width: number; height: number }
export interface Viewport { width: number; height: number }

export function clampFloatingRect(rect: FloatingRect, viewport: Viewport, minimized = false): FloatingRect {
  const maxWidth = Math.max(1, viewport.width - 20);
  const maxHeight = Math.max(1, viewport.height - 20);
  const minWidth = Math.min(360, maxWidth);
  const width = minimized ? minWidth : Math.max(minWidth, Math.min(Number.isFinite(rect.width) ? rect.width : 520, maxWidth));
  const height = Math.max(Math.min(360, maxHeight), Math.min(Number.isFinite(rect.height) ? rect.height : 640, maxHeight));
  const marginX = Math.min(10, viewport.width / 2);
  const marginTop = Math.min(16, viewport.height / 2);
  const marginBottom = Math.min(10, viewport.height / 2);
  const x = Math.max(marginX, Math.min(Number.isFinite(rect.x) ? rect.x : marginX, viewport.width - width - marginX));
  const y = Math.max(marginTop, Math.min(Number.isFinite(rect.y) ? rect.y : marginTop, viewport.height - (minimized ? Math.min(52, height) : height) - marginBottom));
  return { x, y, width, height };
}