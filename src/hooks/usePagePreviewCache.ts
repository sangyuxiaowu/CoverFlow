import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ProjectPage, ProjectState } from '../types.ts';
import { pageProject } from '../utils/projectPages.ts';
import { PagePreviewCache, PAGE_PREVIEW_EDGE } from '../utils/pagePreviewCache.ts';
import { createPagePreviewWorker } from '../utils/pagePreviewWorker.ts';
import { waitForPreviewIdle } from '../utils/previewIdle.ts';
import { renderProjectImage } from '../utils/renderProjectImage.tsx';

const cache = new PagePreviewCache();
const keys = new WeakMap<ProjectPage, string>();
const ready = new Set<string>();

function prepareImage(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    const abort = () => { finish(signal.reason); image.src = ''; };
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', abort, { once: true });
    image.onload = () => { if (!image.decode) finish(); };
    image.onerror = () => finish(new Error('Cached preview could not be decoded.'));
    image.src = url;
    if (image.decode) void image.decode().then(() => finish(), error => finish(error));
  });
}

export function usePagePreviewCache(project: ProjectState, index: number): string | undefined {
  const active = useRef(index);
  const [, publish] = useState(0);
  const pages = project.pages!;
  const key = keys.get(pages[index]);

  useLayoutEffect(() => {
    active.current = index;
    const currentKey = keys.get(pages[index]);
    if (currentKey) cache.get(currentKey);
  }, [pages, index]);

  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    const controller = new AbortController();
    const signal = controller.signal;
    let worker: ReturnType<typeof createPagePreviewWorker>;
    try { worker = createPagePreviewWorker(); }
    catch (error) { console.warn('[CoverFlow preview cache]', error); return; }
    const completed = new Set<number>();
    const run = async () => {
      while (completed.size < pages.length && !signal.aborted) {
        await waitForPreviewIdle(signal);
        const current = active.current;
        const order = [current, current + 1, current + 2, current - 1, ...pages.map((_, position) => position)];
        const position = order.find(candidate => candidate >= 0 && candidate < pages.length && !completed.has(candidate));
        if (position === undefined) return;
        const page = pages[position];
        let contentKey: string | undefined;
        try {
          contentKey = keys.get(page) ?? await worker.key(page);
          signal.throwIfAborted();
          keys.set(page, contentKey);
          const visibleKey = keys.get(pages[active.current]);
          if (visibleKey) cache.get(visibleKey);
          let url = cache.get(contentKey);
          if (!url) {
            const blob = await renderProjectImage(pageProject(project, page), {
              maxEdge: PAGE_PREVIEW_EDGE, format: 'webp', quality: 0.9,
              background: true, signal, encode: worker.encode
            });
            signal.throwIfAborted();
            const latestVisibleKey = keys.get(pages[active.current]);
            if (latestVisibleKey) cache.get(latestVisibleKey);
            url = cache.put(contentKey, blob);
            for (const existing of ready) if (!cache.peek(existing)) ready.delete(existing);
          }
          if (!ready.has(contentKey)) await prepareImage(url, signal);
          signal.throwIfAborted();
          ready.add(contentKey);
          completed.add(position);
          publish(revision => revision + 1);
        } catch (error) {
          if (signal.aborted) return;
          if (contentKey) { cache.delete(contentKey); ready.delete(contentKey); }
          completed.add(position);
          console.warn('[CoverFlow preview cache]', page.id, error);
        }
      }
    };
    void run().catch(error => { if (!signal.aborted) console.warn('[CoverFlow preview cache]', error); });
    return () => { controller.abort(); worker.dispose(); };
  }, [project.id, pages]);

  return key && ready.has(key) ? cache.peek(key) : undefined;
}