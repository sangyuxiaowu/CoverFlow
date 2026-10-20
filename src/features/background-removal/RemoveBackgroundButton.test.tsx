// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../types.ts';
import RemoveBackgroundButton from './RemoveBackgroundButton.tsx';
import { blobDataUrl, removeBackground } from './index.ts';
import { download, installRuntime } from './resources.ts';
import { readRuntime } from './storage.ts';
import { useResources } from './useResources.ts';

vi.mock('./index.ts', () => ({ removeBackground: vi.fn(), blobDataUrl: vi.fn() }));
vi.mock('./resources.ts', () => ({ download: vi.fn(), installRuntime: vi.fn() }));
vi.mock('./storage.ts', () => ({ readRuntime: vi.fn() }));
vi.mock('./useResources.ts', () => ({ useResources: vi.fn() }));

const layer: Layer = {
  id: 'image-1', name: 'Image', type: 'image', content: 'data:image/png;base64,AA==',
  imageSource: 'upload', imageDescription: 'Original description',
  x: 10, y: 20, width: 100, height: 200, rotation: 30, zIndex: 1, visible: true, locked: false, opacity: 0.5
};
let root: Root;
let container: HTMLDivElement;
const runtime = { script: new Blob(['js']), loader: new Blob(['loader']), wasm: new Blob(['wasm']) };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(useResources).mockReturnValue({ runtime: true, loading: false, error: '', models: {}, settings: { modelId: 'u2netp', device: 'auto' } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(download).mockResolvedValue(new Blob(['image']));
  vi.mocked(blobDataUrl).mockResolvedValue('data:image/png;base64,RESULT');
  vi.mocked(readRuntime).mockResolvedValue(runtime);
  vi.mocked(installRuntime).mockResolvedValue();
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

async function selectModel(modelId: string) {
  const select = container.querySelector('select')!;
  await act(async () => { select.value = modelId; select.dispatchEvent(new Event('change', { bubbles: true })); });
}

describe('image layer removal action', () => {
  const installed = { blob: new Blob(['model']), name: 'model.onnx', importedAt: 1, provider: 'wasm' as const };
  it('follows changed defaults and displays MODNet rather than hardcoding U2NetP', async () => {
    await render(layer);
    expect(container.querySelector('select')?.value).toBe('u2netp');
    vi.mocked(useResources).mockReturnValue({ ...useResources(), settings: { modelId: 'modnet', device: 'auto' }, models: { modnet: installed } });
    await render(layer);
    const select = container.querySelector('select')!;
    expect(select.value).toBe('modnet');
    expect(select.selectedOptions[0].textContent).toBe('MODNet');
    expect(select.title).toContain('MODNet');
  });
  it('passes the temporary model to inference without changing default settings', async () => {
    const state = { ...useResources(), models: { modnet: installed, birefnet: installed } };
    vi.mocked(useResources).mockReturnValue(state);
    const complete = pendingInference();
    await render(layer);
    await selectModel('modnet');
    await click();
    expect(removeBackground).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ modelId: 'modnet', device: 'auto' }));
    expect(container.querySelector('select')?.disabled).toBe(true);
    expect(state.settings.modelId).toBe('u2netp');
    await complete();
  });
  it('resets the temporary choice when the default model or selected image changes', async () => {
    vi.mocked(useResources).mockReturnValue({ ...useResources(), models: { modnet: installed, birefnet: installed } });
    await render(layer);
    await selectModel('birefnet');
    vi.mocked(useResources).mockReturnValue({ ...useResources(), settings: { modelId: 'modnet', device: 'auto' } });
    await render(layer);
    expect(container.querySelector('select')?.value).toBe('modnet');
    await selectModel('birefnet');
    await render({ ...layer, id: 'image-2' });
    expect(container.querySelector('select')?.value).toBe('modnet');
    await selectModel('birefnet');
    await render({ ...layer, id: 'image-2', content: 'replacement' });
    expect(container.querySelector('select')?.value).toBe('modnet');
  });
  it('disables uninstalled models and blocks a missing MODNet default', async () => {
    vi.mocked(useResources).mockReturnValue({ ...useResources(), settings: { modelId: 'modnet', device: 'auto' } });
    await render(layer);
    expect(container.querySelector<HTMLOptionElement>('option[value="modnet"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLOptionElement>('option[value="birefnet"]')?.disabled).toBe(true);
    expect(container.querySelector('.cf-removal-hint')?.textContent).toContain('所选模型未安装');
    await click();
    expect(removeBackground).not.toHaveBeenCalled();
    await selectModel('u2netp');
    expect(container.querySelector('.cf-removal-hint')).toBeNull();
  });
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
  it('automatically installs a missing runtime with progress before processing the image', async () => {
    vi.mocked(useResources).mockReturnValue({ runtime: false, loading: false, error: '', models: {}, settings: { modelId: 'u2netp', device: 'auto' } });
    vi.mocked(readRuntime).mockResolvedValueOnce(undefined);
    vi.mocked(installRuntime).mockImplementation(async (_signal, report) => {
      report?.({ stage: 'ort-wasm-simd-threaded.asyncify.wasm', loaded: 5, total: 10 });
    });
    const complete = pendingInference();
    const apply = await render(layer);
    expect(container.querySelector('button')?.disabled).toBe(false);
    expect(container.querySelector('.cf-removal-hint')).toBeNull();
    await click();
    expect(installRuntime).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('下载运行时');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('50%');
    expect(removeBackground).toHaveBeenCalledOnce();
    await complete();
    expect(apply).toHaveBeenCalledOnce();
  });
  it('uses an already cached runtime even when the resource indicator has not refreshed', async () => {
    vi.mocked(useResources).mockReturnValue({ ...useResources(), runtime: false });
    const complete = pendingInference();
    await render(layer);
    await click();
    expect(installRuntime).not.toHaveBeenCalled();
    await complete();
  });
  it('reports a runtime download failure and allows retry without altering the image', async () => {
    vi.mocked(readRuntime).mockResolvedValue(undefined);
    vi.mocked(installRuntime).mockRejectedValueOnce(new Error('Download HTTP 503'));
    const complete = pendingInference();
    const apply = await render(layer);
    await click();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('运行时下载失败');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('503');
    expect(container.querySelector('button')?.disabled).toBe(false);
    expect(download).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    vi.mocked(installRuntime).mockImplementationOnce(async () => { vi.mocked(readRuntime).mockResolvedValue(runtime); });
    await click();
    await complete();
    expect(installRuntime).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledOnce();
  });
  it('cancels runtime installation without starting inference or changing the image', async () => {
    vi.mocked(readRuntime).mockResolvedValue(undefined);
    vi.mocked(installRuntime).mockImplementation(async signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const apply = await render(layer);
    await click();
    await act(async () => (container.querySelector('[aria-label="取消抠图"]') as HTMLButtonElement).click());
    expect(vi.mocked(installRuntime).mock.calls[0][0].aborted).toBe(true);
    expect(removeBackground).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it('does not continue if installation completed without usable cached files', async () => {
    vi.mocked(readRuntime).mockResolvedValue(undefined);
    await render(layer);
    await click();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('缓存不可用');
    expect(download).not.toHaveBeenCalled();
    expect(removeBackground).not.toHaveBeenCalled();
  });
  it('rechecks the selected image after a long runtime download', async () => {
    vi.mocked(readRuntime).mockResolvedValueOnce(undefined);
    let finish!: () => void;
    vi.mocked(installRuntime).mockImplementation(async () => new Promise<void>(resolve => { finish = resolve; }));
    const apply = await render(layer);
    await click();
    await render({ ...layer, content: 'replacement' }, apply);
    await act(async () => finish());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('原图已更改');
    expect(download).not.toHaveBeenCalled();
    expect(removeBackground).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
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