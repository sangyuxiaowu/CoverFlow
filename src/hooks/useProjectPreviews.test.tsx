// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Blob as NodeBlob } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { projectPagePreviewFingerprint, projectPreviews } from '../storage/projectPreviews.ts';
import { renderProjectImage } from '../utils/renderProjectImage.tsx';
import { useProjectPreviews } from './useProjectPreviews.ts';

vi.mock('../utils/renderProjectImage.tsx', () => ({ renderProjectImage: vi.fn() }));

it('retries failed renders and preserves unchanged previews across page updates', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:preview'), revokeObjectURL: vi.fn() });
  const project = syncProjectPages({ id: 'preview-hook', title: 'Preview', updatedAt: 1, selectedLayerId: null, layers: [], pageInfo: { width: 100, height: 100, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } } });
  const preview = new NodeBlob(['webp'], { type: 'image/webp' }) as unknown as Blob;
  vi.mocked(renderProjectImage).mockReset().mockRejectedValueOnce(new Error('failed')).mockResolvedValue(preview);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const onPreview = vi.fn();
  let urls: Record<string, string> = {};
  function Harness({ value }: { value: typeof project }) { urls = useProjectPreviews(value, onPreview); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness value={project} />));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(projectPreviews(project)).toEqual({});
    expect(urls).toEqual({});
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(urls[project.pages![0].id]).toBe('blob:preview');
    expect(onPreview).toHaveBeenCalledOnce();
    expect(projectPreviews(project)[project.pages![0].id]).toBeDefined();
    await act(async () => root.render(<Harness value={{ ...project, pages: [...project.pages!] }} />));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(urls[project.pages![0].id]).toBe('blob:preview');
    expect(renderProjectImage).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    warn.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it('regenerates dynamic previews when page order or count changes', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:preview'), revokeObjectURL: vi.fn() });
  const layer = { id: 'text', type: 'text' as const, name: '', content: '{{PAGE_INDEX}}/{{TOTAL_PAGES}}', x: 0, y: 0, width: 100, height: 20, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 };
  const project = syncProjectPages({ id: 'dynamic-preview', title: '', updatedAt: 1, selectedLayerId: null, layers: [layer], pageInfo: { width: 100, height: 100, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } } });
  const first = project.pages![0];
  const second = { ...first, id: 'second', layers: [] };
  const twoPages = { ...project, pages: [first, second] };
  const preview = new NodeBlob(['webp'], { type: 'image/webp' }) as unknown as Blob;
  vi.mocked(renderProjectImage).mockReset().mockResolvedValue(preview);
  expect(projectPagePreviewFingerprint(twoPages, first)).not.toBe(projectPagePreviewFingerprint(project, first));
  function Harness({ value }: { value: typeof project }) { useProjectPreviews(value, () => {}); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness value={twoPages} />));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(vi.mocked(renderProjectImage)).toHaveBeenCalledTimes(2);
    const reordered = { ...twoPages, pages: [second, first] };
    expect(projectPreviews(reordered)[first.id]).toBeUndefined();
    await act(async () => root.render(<Harness value={reordered} />));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(vi.mocked(renderProjectImage)).toHaveBeenCalledTimes(3);
    const single = { ...project, pages: [first] };
    await act(async () => root.render(<Harness value={single} />));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(vi.mocked(renderProjectImage)).toHaveBeenCalledTimes(4);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});