// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../types.ts';
import RemoveBackgroundButton from './RemoveBackgroundButton.tsx';
import { blobDataUrl, removeBackground } from './index.ts';
import { download } from './resources.ts';
import { useResources } from './useResources.ts';

vi.mock('./index.ts', () => ({ removeBackground: vi.fn(), blobDataUrl: vi.fn() }));
vi.mock('./resources.ts', () => ({ download: vi.fn() }));
vi.mock('./useResources.ts', () => ({ useResources: vi.fn() }));

const layer: Layer = {
  id: 'image-1', name: 'Image', type: 'image', content: 'data:image/png;base64,AA==',
  imageSource: 'upload', imageDescription: 'Original description',
  x: 10, y: 20, width: 100, height: 200, rotation: 30, zIndex: 1, visible: true, locked: false, opacity: 0.5
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(useResources).mockReturnValue({ runtime: true, loading: false, error: '', models: {}, settings: { modelId: 'u2netp', device: 'auto' } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(download).mockResolvedValue(new Blob(['image']));
  vi.mocked(blobDataUrl).mockResolvedValue('data:image/png;base64,RESULT');
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function pendingInference() {
  let resolve: (value: { blob: Blob; provider: 'wasm'; modelId: 'u2netp' }) => void;
  vi.mocked(removeBackground).mockImplementation(async (_image, options) => new Promise((done, reject) => {
    resolve = done;
    options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }));
  return async () => { await act(async () => { resolve({ blob: new Blob(['png']), provider: 'wasm', modelId: 'u2netp' }); }); };
}

async function render(target: Layer, apply = vi.fn()) {
  await act(async () => root.render(<RemoveBackgroundButton layer={target} english={false} onApply={apply} />));
  return apply;
}

async function click() {
  await act(async () => container.querySelector('button')!.click());
}

describe('image layer removal action', () => {
  it('submits a successful result with the original preserved by default', async () => {
    const complete = pendingInference();
    const apply = await render(layer);
    await click();
    await complete();
    expect(apply).toHaveBeenCalledExactlyOnceWith({ layerId: layer.id, originalContent: layer.content,
      content: 'data:image/png;base64,RESULT', keepOriginal: true });
  });
  it('allows keeping the original to be unchecked', async () => {
    const complete = pendingInference();
    const apply = await render(layer);
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await click();
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
    await complete();
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ keepOriginal: false }));
  });
  it('explains missing runtime without relying on a disabled button tooltip', async () => {
    vi.mocked(useResources).mockReturnValue({ runtime: false, loading: false, error: '', models: {}, settings: { modelId: 'u2netp', device: 'auto' } });
    await render(layer);
    await click();
    expect(container.querySelector('.cf-removal-hint')?.textContent).toContain('配置中心 > 抠图');
    expect(container.querySelector('button')?.getAttribute('aria-describedby')).toBe(container.querySelector('.cf-removal-hint')?.id);
    expect(download).not.toHaveBeenCalled();
  });
  it('blocks images marked as already processed and displays a visible reason', async () => {
    await render({ ...layer, backgroundRemoved: true });
    await click();
    expect(container.textContent).toContain('不可重复处理');
    expect(download).not.toHaveBeenCalled();
  });
  it.each(['content', 'locked'] as const)('rejects stale results after %s changes', async property => {
    const complete = pendingInference();
    const apply = await render(layer);
    await click();
    await render({ ...layer, [property]: property === 'locked' ? true : 'replacement' }, apply);
    await complete();
    expect(apply).not.toHaveBeenCalled();
    expect(container.textContent).toContain('原图已更改');
  });
  it('cancels inference without replacing the original', async () => {
    pendingInference();
    const apply = await render(layer);
    await click();
    await act(async () => (container.querySelector('[aria-label="取消抠图"]') as HTMLButtonElement).click());
    expect(vi.mocked(removeBackground).mock.calls[0][1].signal.aborted).toBe(true);
    expect(apply).not.toHaveBeenCalled();
  });
  it('does not start for locked images', async () => {
    await render({ ...layer, locked: true });
    await click();
    expect(download).not.toHaveBeenCalled();
  });
});