// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ExportModal, { type ExportRange, type ExportSettings } from './ExportModal.tsx';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { insertProjectPage } from '../utils/projectPages.ts';

vi.mock('./LivePreview.tsx', () => ({ default: () => <div data-testid="live-preview" /> }));

it('defaults to the current page and uses cached thumbnails for multi-select exports', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const project = insertProjectPage(syncProjectPages({ id: 'modal', title: 'Test', layers: [], selectedLayerId: null, updatedAt: 1, canvasConfig: { width: 900, height: 383, ratio: '2.35:1' }, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } }), 'Detail');
  const thumbnails = Object.fromEntries(project.pages!.map(page => [page.id, `blob:${page.id}`]));
  const copy = vi.fn();
  const container = document.createElement('div');
  const root = createRoot(container);
  function Harness() {
    const [range, setRange] = useState<ExportRange>('current');
    const [ids, setIds] = useState([project.activePageId!]);
    const [settings, setSettings] = useState<ExportSettings>({ format: 'png', pixelRatio: 1, compression: 'lossless' });
    return <ExportModal isOpen lang="zh" project={project} settings={settings} estimatedSize={null} estimating={false} onChange={updates => setSettings(current => ({ ...current, ...updates }))} onClose={() => {}} onConfirm={() => {}} onCopyBase64={copy} onCopyImage={copy} range={range} onRangeChange={setRange} selectedPageIds={ids} onSelectedPagesChange={setIds} thumbnails={thumbnails} />;
  }
  const button = (label: string) => Array.from(container.querySelectorAll('button')).find(element => element.textContent === label)!;
  try {
    await act(async () => root.render(<Harness />));
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(button('复制 Base64')).toBeDefined();
    await act(async () => button('多选').click());
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
    expect(button('复制图片到剪贴板')).toBeDefined();
    await act(async () => button('复制 Base64').click());
    expect(copy).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});