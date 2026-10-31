// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ExportModal, { type ExportRange, type ExportSettings } from './ExportModal.tsx';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { insertProjectPage, selectProjectPage } from '../utils/projectPages.ts';
import type { ProjectState } from '../types.ts';

vi.mock('./LivePreview.tsx', () => ({ default: ({ project }: { project: ProjectState }) => <div data-testid="live-preview" data-preview-page={project.activePageId} /> }));

it('defaults to the current page and uses cached thumbnails for multi-select exports', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const project = insertProjectPage(syncProjectPages({ id: 'modal', title: 'Test', layers: [], selectedLayerId: null, updatedAt: 1, canvasConfig: { width: 900, height: 383, ratio: '2.35:1' }, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } }), 'Detail');
  const thumbnails = Object.fromEntries(project.pages!.map(page => [page.id, `blob:${page.id}`]));
  const copy = vi.fn();
  const container = document.createElement('div');
  const root = createRoot(container);
  function Harness() {
    const [currentProject, setCurrentProject] = useState(project);
    const [range, setRange] = useState<ExportRange>('current');
    const [ids, setIds] = useState([project.activePageId!]);
    const [settings, setSettings] = useState<ExportSettings>({ format: 'png', pixelRatio: 1, compression: 'lossless' });
    return <ExportModal isOpen lang="zh" project={currentProject} settings={settings} estimatedSize={null} estimating={false} onChange={updates => setSettings(current => ({ ...current, ...updates }))} onClose={() => {}} onConfirm={() => {}} onCopyBase64={copy} onCopyImage={copy} range={range} onRangeChange={setRange} selectedPageIds={ids} onSelectedPagesChange={setIds} onPageChange={id => setCurrentProject(current => selectProjectPage(current, id))} thumbnails={thumbnails} />;
  }
  const button = (label: string) => Array.from(container.querySelectorAll('button')).find(element => element.textContent === label)!;
  const navigation = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  try {
    await act(async () => root.render(<Harness />));
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(button('复制 Base64')).toBeDefined();
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('2/2');
    expect(navigation('下一页').disabled).toBe(true);
    await act(async () => navigation('上一页').click());
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('1/2');
    expect(navigation('上一页').disabled).toBe(true);
    expect(container.querySelector('[data-preview-page]')?.getAttribute('data-preview-page')).toBe(project.pages![0].id);
    await act(async () => navigation('下一页').click());
    expect(container.querySelector('[data-preview-page]')?.getAttribute('data-preview-page')).toBe(project.pages![1].id);
    await act(async () => button('多选').click());
    expect(navigation('上一页')).toBeNull();
    expect(container.textContent).not.toContain('预计大小');
    expect(container.textContent).not.toContain('900 × 383');
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('1/2');
    expect(Array.from(container.querySelectorAll('button')).filter(element => element.textContent === '全选')).toHaveLength(1);
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.style.opacity).toBe('0');
    expect(button('复制 Base64')).toBeUndefined();
    expect(button('复制图片到剪贴板')).toBeUndefined();
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1);
    expect(Array.from(container.querySelectorAll('[data-page-id] img')).map(image => image.getAttribute('src'))).toEqual(Object.values(thumbnails));
    expect(container.querySelector('[data-testid="live-preview"]')).toBeNull();
    await act(async () => button('全选').click());
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
    await act(async () => button('反选').click());
    expect(button('导出图片').disabled).toBe(true);
    await act(async () => button('全部').click());
    expect(button('全部').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
    expect(button('导出图片').disabled).toBe(false);
    await act(async () => (container.querySelector('[data-page-id]') as HTMLLabelElement).click());
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1);
    expect(button('多选').getAttribute('aria-pressed')).toBe('true');
    await act(async () => button('PPT').click());
    expect(button('无损').disabled).toBe(true);
    expect(button('导出 PPT')).toBeDefined();
    expect(button('导出图片')).toBeUndefined();
    await act(async () => button('本页').click());
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('2/2');
    expect(container.textContent).toContain('900 × 383');
    expect(container.textContent).not.toContain('预计大小');
    expect(button('复制图片到剪贴板')).toBeDefined();
    await act(async () => button('复制 Base64').click());
    expect(copy).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('previews only selected pages in project order and shows the current page estimate', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const first = syncProjectPages({ id: 'selection', title: 'Test', layers: [], selectedLayerId: null, updatedAt: 1, canvasConfig: { width: 900, height: 383, ratio: '2.35:1' }, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } });
  const middle = insertProjectPage(first, 'Unselected');
  const last = insertProjectPage(middle, 'Selected', { width: 600, height: 900, ratio: '2:3' });
  const selected = [last.activePageId!, first.activePageId!];
  const confirm = vi.fn();
  const container = document.createElement('div');
  const root = createRoot(container);
  function Harness() {
    const [project, setProject] = useState(selectProjectPage(last, middle.activePageId!));
    const [range, setRange] = useState<ExportRange>('multiple');
    const [ids, setIds] = useState(selected);
    return <ExportModal isOpen lang="zh" project={project} settings={{ format: 'png', pixelRatio: 1, compression: 'lossless' }} estimatedSize={project.activePageId === first.activePageId ? 1024 : 4096} estimating={false} onChange={() => {}} onClose={() => {}} onConfirm={() => confirm(ids)} onCopyBase64={() => {}} onCopyImage={() => {}} range={range} onRangeChange={setRange} selectedPageIds={ids} onSelectedPagesChange={setIds} onPageChange={id => setProject(current => selectProjectPage(current, id))} thumbnails={{}} />;
  }
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  try {
    await act(async () => root.render(<Harness />));
    expect(container.textContent).not.toContain('预计大小');
    await act(async () => button('预览').click());
    expect(container.querySelector('[data-preview-page]')?.getAttribute('data-preview-page')).toBe(first.activePageId);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('1/2');
    expect(container.textContent).toContain('1.0 KB');
    expect(button('上一页').disabled).toBe(true);
    await act(async () => button('下一页').click());
    expect(container.querySelector('[data-preview-page]')?.getAttribute('data-preview-page')).toBe(last.activePageId);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('2/2');
    expect(container.textContent).toContain('600 × 900');
    expect(container.textContent).toContain('4.0 KB');
    expect(button('下一页').disabled).toBe(true);
    await act(async () => Array.from(container.querySelectorAll('button')).find(element => element.textContent === '导出图片')!.click());
    expect(confirm).toHaveBeenCalledWith(selected);
    await act(async () => button('页面').click());
    expect(container.textContent).not.toContain('预计大小');
    await act(async () => Array.from(container.querySelectorAll('button')).find(element => element.textContent === '反选')!.click());
    await act(async () => button('预览').click());
    expect(container.querySelector('[data-preview-page]')?.getAttribute('data-preview-page')).toBe(middle.activePageId);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('1/1');
    await act(async () => button('页面').click());
    await act(async () => (container.querySelector(`label[data-page-id="${middle.activePageId}"]`) as HTMLLabelElement).click());
    expect(button('预览').disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});