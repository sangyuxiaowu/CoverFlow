import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import * as htmlToImage from 'html-to-image';
import LivePreview from '../components/LivePreview.tsx';
import type { ProjectState } from '../types.ts';
import { ensureProjectFonts } from '../features/ai/services/fontLoading.ts';

export interface RenderImageOptions {
  format?: 'png' | 'jpeg' | 'webp';
  pixelRatio?: number;
  maxEdge?: number;
  quality?: number;
}

export async function renderProjectImage(project: ProjectState, options: RenderImageOptions = {}): Promise<Blob> {
  await ensureProjectFonts(project);
  const { width, height } = project.canvasConfig;
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', width: `${width}px`, height: `${height}px`, pointerEvents: 'none' });
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previewRef = { current: null as HTMLDivElement | null };
  try {
    flushSync(() => root.render(<LivePreview project={project} previewRef={previewRef} />));
    const node = previewRef.current;
    if (!node) throw new Error('Page renderer is unavailable.');
    await Promise.all(Array.from(node.querySelectorAll('img')).map(image => image.decode()));
    const scale = options.maxEdge ? Math.min(1, options.maxEdge / Math.max(width, height)) : options.pixelRatio ?? 1;
    const canvas = await htmlToImage.toCanvas(node, {
      width, height, pixelRatio: 1,
      canvasWidth: Math.max(1, Math.round(width * scale)), canvasHeight: Math.max(1, Math.round(height * scale)),
      style: { transform: 'none', transformOrigin: 'top left', opacity: '1', transition: 'none', boxShadow: 'none', width: `${width}px`, height: `${height}px` }
    });
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Page rendering failed.')), `image/${options.format ?? 'png'}`, options.quality));
  } finally {
    root.unmount();
    host.remove();
  }
}