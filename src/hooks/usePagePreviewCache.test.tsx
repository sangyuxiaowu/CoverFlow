// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectState } from '../types.ts';
import { readProject } from '../storage/projectCompatibility.ts';
import { serializePagePreview } from '../utils/pagePreviewCache.ts';
import { createPagePreviewWorker } from '../utils/pagePreviewWorker.ts';
import { renderProjectImage } from '../utils/renderProjectImage.tsx';
import { usePagePreviewCache } from './usePagePreviewCache.ts';

vi.mock('../utils/pagePreviewWorker.ts', () => ({ createPagePreviewWorker: vi.fn() }));
vi.mock('../utils/renderProjectImage.tsx', () => ({ renderProjectImage: vi.fn() }));

let root: Root;
let latest: string | undefined;
const key = vi.fn();
const dispose = vi.fn();
const createUrl = vi.fn();

const makeProject = (prefix: string, count = 3) => readProject({ id: prefix, version: '9.0.0', title: prefix, updatedAt: 1,
  pages: Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`, name: '', canvasConfig: { width: 900, height: 383, ratio: '2.35:1' },
    background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 },
    layers: [{ id: `text-${index}`, name: 'Title', type: 'text', content: `${prefix} ${index}`, x: 0, y: 0, width: 500, height: 200, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }]
  }))
});

function Harness({ project, index }: { project: ProjectState; index: number }) {
  latest = usePagePreviewCache(project, index);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal('Image', class {
    src = '';
    onload = null;
    onerror = null;
    async decode() {}
  });
  let sequence = 0;
  createUrl.mockReset().mockImplementation(() => `blob:preview-${sequence++}`);
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
  key.mockReset().mockImplementation(async page => serializePagePreview(page));
  dispose.mockReset();
  vi.mocked(createPagePreviewWorker).mockReset().mockReturnValue({ key, dispose, encode: vi.fn(async () => new Blob(['encoded'])) });
  vi.mocked(renderProjectImage).mockReset().mockResolvedValue(new Blob(['page']));
  latest = undefined;
  root = createRoot(document.createElement('div'));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('runs one render at a time and reprioritizes the active and following pages after navigation', async () => {
  const project = makeProject('priority', 5);
  let finishFirst!: (blob: Blob) => void;
  vi.mocked(renderProjectImage).mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
  await act(async () => root.render(<Harness project={project} index={0} />));
  expect(renderProjectImage).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(130));
  expect(renderProjectImage).toHaveBeenCalledOnce();
  await act(async () => root.render(<Harness project={project} index={3} />));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(renderProjectImage).toHaveBeenCalledOnce();
  await act(async () => finishFirst(new Blob(['first'])));
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(vi.mocked(renderProjectImage).mock.calls.map(([value]) => value.activePageId)).toEqual([
    'priority-0', 'priority-3', 'priority-4', 'priority-2', 'priority-1'
  ]);
  expect(renderProjectImage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxEdge: 2048, background: true, signal: expect.any(AbortSignal), encode: expect.any(Function) }));
  expect(latest).toBeDefined();
});

it('reuses completed content on reopening and after changing names and page identities', async () => {
  const project = makeProject('reuse');
  await act(async () => root.render(<Harness project={project} index={0} />));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  const firstUrl = latest;
  expect(renderProjectImage).toHaveBeenCalledTimes(3);
  await act(async () => root.render(null));
  expect(dispose).toHaveBeenCalledOnce();
  await act(async () => root.render(<Harness project={project} index={0} />));
  expect(latest).toBe(firstUrl);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(renderProjectImage).toHaveBeenCalledTimes(3);
  const renamed = { ...project, pages: project.pages!.map(page => ({ ...page, id: `${page.id}-copy`, name: 'New name' })) };
  await act(async () => root.render(<Harness project={renamed} index={0} />));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(latest).toBe(firstUrl);
  expect(renderProjectImage).toHaveBeenCalledTimes(3);
});

it('does not publish old content when a pending render is replaced or the preview closes', async () => {
  const project = makeProject('stale', 1);
  let finishOld!: (blob: Blob) => void;
  vi.mocked(renderProjectImage).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  await act(async () => root.render(<Harness project={project} index={0} />));
  await act(async () => vi.advanceTimersByTimeAsync(130));
  const changed = { ...project, pages: [{ ...project.pages![0], layers: [{ ...project.pages![0].layers[0], content: 'Updated content' }] }] };
  await act(async () => root.render(<Harness project={changed} index={0} />));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(createUrl).toHaveBeenCalledOnce();
  const newUrl = latest;
  await act(async () => finishOld(new Blob(['obsolete'])));
  expect(latest).toBe(newUrl);
  expect(createUrl).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(createUrl).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledTimes(2);
});