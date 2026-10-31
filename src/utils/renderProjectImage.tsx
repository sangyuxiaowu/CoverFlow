import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import * as htmlToImage from 'html-to-image';
import LivePreview from '../components/LivePreview.tsx';
import type { ProjectState } from '../types.ts';
import { ensureProjectFonts } from '../features/ai/services/fontLoading.ts';
import { waitForPreviewIdle, waitForPreviewTask } from './previewIdle.ts';

export interface RenderImageOptions {
  format?: 'png' | 'jpeg' | 'webp';
  pixelRatio?: number;
  maxEdge?: number;
  quality?: number;
  signal?: AbortSignal;
  background?: boolean;
  encode?: (bitmap: ImageBitmap, format: string, quality: number) => Promise<Blob>;
}

let backgroundTail: Promise<void> = Promise.resolve();

export async function renderProjectImage(project: ProjectState, options: RenderImageOptions = {}): Promise<Blob> {
  if (!options.background) return renderImage(project, options);
  const previous = backgroundTail;
  let release!: () => void;
  backgroundTail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    options.signal?.throwIfAborted();
    return await renderImage(project, options);
  } finally { release(); }
}

async function renderImage(project: ProjectState, options: RenderImageOptions): Promise<Blob> {
  const signal = options.signal ?? new AbortController().signal;
  const wait = <T,>(task: Promise<T>) => options.background ? waitForPreviewTask(task, signal) : task;
  const yieldForInput = async () => {
    signal.throwIfAborted();
    if (options.background) await waitForPreviewIdle(signal);
    signal.throwIfAborted();
  };
  await wait(ensureProjectFonts(project));
  await yieldForInput();
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
    await wait(Promise.all(Array.from(node.querySelectorAll('img')).map(image => image.decode())));
    await yieldForInput();
    const scale = options.maxEdge ? Math.min(1, options.maxEdge / Math.max(width, height)) : options.pixelRatio ?? 1;
    const canvas = await wait(htmlToImage.toCanvas(node, {
      width, height, pixelRatio: 1,
      canvasWidth: Math.max(1, Math.round(width * scale)), canvasHeight: Math.max(1, Math.round(height * scale)),
      style: { transform: 'none', transformOrigin: 'top left', opacity: '1', transition: 'none', boxShadow: 'none', width: `${width}px`, height: `${height}px` }
    }));
    await yieldForInput();
    if (options.encode && typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
      const bitmap = await createImageBitmap(canvas);
      try { return await wait(options.encode(bitmap, `image/${options.format ?? 'png'}`, options.quality ?? 0.9)); }
      finally { bitmap.close(); }
    }
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Page rendering failed.')), `image/${options.format ?? 'png'}`, options.quality));
  } finally {
    root.unmount();
    host.remove();
  }
}