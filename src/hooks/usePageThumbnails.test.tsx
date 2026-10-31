// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { ProjectState } from '../types.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { insertProjectPage, moveProjectPage, renameProjectPage } from '../utils/projectPages.ts';
import { renderProjectImage } from '../utils/renderProjectImage.tsx';
import { usePageThumbnails } from './usePageThumbnails.ts';
import { serializePagePreview } from '../utils/pagePreviewCache.ts';

vi.mock('../utils/renderProjectImage.tsx', () => ({ renderProjectImage: vi.fn(async () => new Blob(['thumbnail'])) }));
vi.mock('../utils/pagePreviewWorker.ts', () => ({ createPagePreviewWorker: () => ({ key: async (page: Parameters<typeof serializePagePreview>[0]) => serializePagePreview(page), encode: vi.fn(), dispose: vi.fn() }) }));

it('reuses tiny previews across naming, reordering and selection, and releases deleted URLs', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('Worker', vi.fn());
  const revoke = vi.fn();
  const create = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  const first = syncProjectPages({ id: 'test', title: 'Test', updatedAt: 1, selectedLayerId: null, layers: [], canvasConfig: { width: 900, height: 383, ratio: '2.35:1' }, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } });
  const project = insertProjectPage(first, '');
  let urls: Record<string, string> = {};
  function Harness({ value }: { value: ProjectState | null }) { urls = usePageThumbnails(value); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness value={project} />));
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(renderProjectImage).toHaveBeenCalledTimes(1);
    expect(renderProjectImage).toHaveBeenCalledWith(expect.anything(), { maxEdge: 160, format: 'webp', quality: 0.65, background: true, signal: expect.any(AbortSignal), encode: expect.any(Function) });
    expect(Object.keys(urls)).toHaveLength(2);
    const deletedUrl = urls[project.activePageId!];
    const changed = moveProjectPage(renameProjectPage(project, project.activePageId!, 'New name'), project.activePageId!, project.pages![0].id);
    await act(async () => root.render(<Harness value={{ ...changed, selectedLayerId: 'selection-only' }} />));
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(renderProjectImage).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Harness value={first} />));
    expect(revoke).toHaveBeenCalledWith(deletedUrl);
    await act(async () => root.render(<Harness value={null} />));
    create.mockReturnValueOnce('blob:reopened');
    await act(async () => root.render(<Harness value={structuredClone(first)} />));
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(renderProjectImage).toHaveBeenCalledTimes(1);
    expect(urls[first.pages![0].id]).toBe('blob:reopened');
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});