import { useEffect, useRef, useState } from 'react';
import type { ProjectPage, ProjectState } from '../types.ts';
import { pageProject } from '../utils/projectPages.ts';
import { renderProjectImage } from '../utils/renderProjectImage.tsx';
import { projectPreviews, rememberProjectPreview } from '../storage/projectPreviews.ts';
import { waitForPreviewTask } from '../utils/previewIdle.ts';

export function useProjectPreviews(project: ProjectState | null, onPreview: (project: ProjectState, pageId: string, blob: Blob) => void) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const callback = useRef(onPreview);
  const cache = useRef(new Map<string, { layers: ProjectPage['layers']; pageInfo: ProjectPage['pageInfo']; url: string }>());
  callback.current = onPreview;

  useEffect(() => {
    setUrls({});
    return () => {
      for (const entry of cache.current.values()) URL.revokeObjectURL(entry.url);
      cache.current.clear();
    };
  }, [project?.id]);

  useEffect(() => {
    if (!project?.pages) return;
    const controller = new AbortController();
    const ids = new Set(project.pages.map(page => page.id));
    for (const [id, entry] of cache.current) {
      if (!ids.has(id)) { URL.revokeObjectURL(entry.url); cache.current.delete(id); }
    }
    const publish = () => setUrls(Object.fromEntries([...cache.current].map(([id, entry]) => [id, entry.url])));
    publish();
    const run = async () => {
      const cached = projectPreviews(project);
      const pages = [...project.pages!];
      pages.sort((left, right) => Number(right.id === project.activePageId) - Number(left.id === project.activePageId));
      for (const page of pages) {
        if (controller.signal.aborted) return;
        const previous = cache.current.get(page.id);
        if (previous?.layers === page.layers && previous.pageInfo === page.pageInfo) continue;
        try {
          const bytes = cached[page.id];
          let blob: Blob;
          if (bytes) blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' });
          else {
            try {
              blob = await renderProjectImage(pageProject(project, page), { maxEdge: 320, format: 'webp', quality: 0.75, background: true, signal: controller.signal });
            } catch (error) {
              if (controller.signal.aborted) return;
              await waitForPreviewTask(new Promise<void>(resolve => window.setTimeout(resolve, 1000)), controller.signal);
              blob = await renderProjectImage(pageProject(project, page), { maxEdge: 320, format: 'webp', quality: 0.75, background: true, signal: controller.signal });
            }
          }
          if (controller.signal.aborted) return;
          if (!bytes) {
            if (blob.type !== 'image/webp') throw new Error('WebP preview encoding is unavailable.');
            const data = new Uint8Array(await blob.arrayBuffer());
            if (controller.signal.aborted) return;
            rememberProjectPreview(project, page, data);
            callback.current(project, page.id, blob);
          } else if (page.id === project.pages![0].id) callback.current(project, page.id, blob);
          const url = URL.createObjectURL(blob);
          if (previous) URL.revokeObjectURL(previous.url);
          cache.current.set(page.id, { layers: page.layers, pageInfo: page.pageInfo, url });
          publish();
        } catch (error) {
          if (controller.signal.aborted) return;
          console.warn('[CoverFlow project preview]', page.id, error);
        }
      }
    };
    const timer = window.setTimeout(() => { void run(); }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [project?.id, project?.pages]);

  return urls;
}