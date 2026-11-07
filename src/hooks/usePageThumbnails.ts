import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ProjectPage, ProjectState } from '../types.ts';
import { pageProject } from '../utils/projectPages.ts';
import { renderProjectImage } from '../utils/renderProjectImage.tsx';
import { PagePreviewCache, PAGE_PREVIEW_EDGE, pagePreviewKey } from '../utils/pagePreviewCache.ts';
import { createPagePreviewWorker } from '../utils/pagePreviewWorker.ts';
import { waitForPreviewIdle } from '../utils/previewIdle.ts';

const persisted = new PagePreviewCache();

interface CachedThumbnail {
  layers: ProjectPage['layers'];
  background: ProjectPage['background'];
  canvasConfig: ProjectPage['canvasConfig'];
  url: string;
}

export function usePageThumbnails(project: ProjectState | null) {
  const cache = useRef(new Map<string, CachedThumbnail>());
  const [urls, setUrls] = useState<Record<string, string>>({});
  const active = useRef(project?.activePageId);
  useLayoutEffect(() => { active.current = project?.activePageId; }, [project?.activePageId]);

  useEffect(() => {
    setUrls({});
    return () => {
      for (const entry of cache.current.values()) if (entry.url) URL.revokeObjectURL(entry.url);
      cache.current.clear();
    };
  }, [project?.id]);

  useEffect(() => {
    if (!project?.pages) return;
    const controller = new AbortController();
    let cancelled = false;
    let worker: ReturnType<typeof createPagePreviewWorker> | undefined;
    try { if (typeof Worker !== 'undefined') worker = createPagePreviewWorker(); }
    catch (error) { console.warn('[CoverFlow thumbnail worker]', error); }
    const pages = project.pages;
    const ids = new Set(pages.map(page => page.id));
    for (const [id, entry] of cache.current) {
      if (!ids.has(id)) {
        if (entry.url) URL.revokeObjectURL(entry.url);
        cache.current.delete(id);
      }
    }
    const publish = () => setUrls(Object.fromEntries(Array.from(cache.current, ([id, entry]) => [id, entry.url])));
    publish();
    const timer = window.setTimeout(async () => {
      const completed = new Set<number>();
      while (completed.size < pages.length) {
        if (cancelled) return;
        const current = Math.max(0, pages.findIndex(page => page.id === active.current));
        const order = [current, current + 1, current + 2, current - 1, ...pages.map((_, position) => position)];
        const position = order.find(candidate => candidate >= 0 && candidate < pages.length && !completed.has(candidate))!;
        completed.add(position);
        const page = pages[position];
        const previous = cache.current.get(page.id);
        if (previous?.layers === page.layers && previous.background === page.background && previous.canvasConfig === page.canvasConfig) continue;
        let url = '';
        try {
          await waitForPreviewIdle(controller.signal);
          let key: string;
          try { key = worker ? await worker.key(page) : await pagePreviewKey(page); }
          catch (error) {
            if (cancelled) return;
            if (!worker) throw error;
            console.warn('[CoverFlow thumbnail worker]', error);
            worker.dispose();
            worker = undefined;
            key = await pagePreviewKey(page);
          }
          if (cancelled) return;
          let blob: Blob | undefined;
          try { blob = await persisted.get(key); }
          catch (error) { console.warn('[CoverFlow thumbnail cache read]', error); }
          if (cancelled) return;
          if (!blob) {
            blob = await renderProjectImage(pageProject(project, page), {
              maxEdge: PAGE_PREVIEW_EDGE, format: 'webp', quality: 0.65, background: true,
              signal: controller.signal, encode: worker?.encode
            });
            if (cancelled) return;
            try { await persisted.put(key, blob, controller.signal); }
            catch (error) {
              if (cancelled) return;
              console.warn('[CoverFlow thumbnail cache write]', error);
            }
          }
          if (cancelled) return;
          url = URL.createObjectURL(blob);
        } catch (error) {
          if (cancelled) return;
          console.warn('[CoverFlow thumbnail]', page.id, error);
        }
        if (previous?.url) URL.revokeObjectURL(previous.url);
        cache.current.set(page.id, { layers: page.layers, background: page.background, canvasConfig: page.canvasConfig, url });
        publish();
      }
    }, 350);
    return () => { cancelled = true; controller.abort(); worker?.dispose(); window.clearTimeout(timer); };
  }, [project?.id, project?.pages]);

  return urls;
}