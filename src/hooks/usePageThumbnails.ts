import { useEffect, useRef, useState } from 'react';
import type { ProjectPage, ProjectState } from '../types.ts';
import { pageProject } from '../utils/projectPages.ts';
import { renderProjectImage } from '../utils/renderProjectImage.tsx';

interface CachedThumbnail {
  layers: ProjectPage['layers'];
  background: ProjectPage['background'];
  canvasConfig: ProjectPage['canvasConfig'];
  url: string;
}

export function usePageThumbnails(project: ProjectState | null) {
  const cache = useRef(new Map<string, CachedThumbnail>());
  const [urls, setUrls] = useState<Record<string, string>>({});

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
      for (const page of pages) {
        if (cancelled) return;
        const previous = cache.current.get(page.id);
        if (previous?.layers === page.layers && previous.background === page.background && previous.canvasConfig === page.canvasConfig) continue;
        let url = '';
        try {
          const blob = await renderProjectImage(pageProject(project, page), { maxEdge: 160, format: 'webp', quality: 0.65, background: true, signal: controller.signal });
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
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [project?.id, project?.pages]);

  return urls;
}