// @vitest-environment jsdom
import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '../types.ts';
import RemoveBackgroundButton from './RemoveBackgroundButton.tsx';
import { removeBackground } from 'sang-ai-kit/background-removal/index.ts';
import { download } from 'sang-ai-kit/background-removal/resources.ts';
import { useResources } from 'sang-ai-kit/background-removal/useResources.ts';

vi.mock('sang-ai-kit/background-removal/index.ts', () => ({ removeBackground: vi.fn() }));
vi.mock('sang-ai-kit/background-removal/resources.ts', () => ({ download: vi.fn() }));
vi.mock('sang-ai-kit/background-removal/useResources.ts', () => ({ useResources: vi.fn() }));
vi.mock('sang-ai-kit/background-removal/ColorMattingEditor.tsx', () => ({
  default: ({ onApply, onClose }: { onApply: (blob: Blob, signal: AbortSignal) => Promise<void>; onClose: () => void }) => {
    const controller = useRef(new AbortController());
    useEffect(() => () => controller.current.abort(), []);
    return <><button type="button" onClick={() => { void onApply(new Blob(['edited']), controller.current.signal).catch(() => {}); }}>提交颜色抠图</button>
      <button type="button" onClick={onClose}>关闭颜色抠图</button></>;
  }
}));

const layer: Layer = {
  id: 'image-1', name: 'Image', type: 'image', content: 'data:image/png;base64,AA==',
  imageSource: 'upload', imageDescription: 'Original description',
  x: 10, y: 20, width: 100, height: 200, rotation: 30, zIndex: 1, visible: true, locked: false, opacity: 0.5
};
let root: Root;
let container: HTMLDivElement;
const installed = { blob: new Blob(['model']), name: 'model.onnx', importedAt: 1, provider: 'wasm' as const };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(useResources).mockReturnValue({ runtime: true, loading: false, error: '', models: { u2netp: installed }, settings: { modelId: 'u2netp', device: 'auto' } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(download).mockResolvedValue(new Blob(['image']));
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
  it('applies the shared editor result to the original layer and preserves the chosen policy', async () => {
    const apply = await render(layer);
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '颜色抠图')!.click());
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '提交颜色抠图')!.click());
    expect(apply).toHaveBeenCalledExactlyOnceWith({ layerId: layer.id, originalContent: layer.content,
      content: expect.any(Blob), keepOriginal: false }, expect.any(AbortSignal));
  });
  it('aborts a shared editor result if the selected image changes while it is registered', async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const committed = vi.fn();
    const apply = vi.fn(async (_result, signal: AbortSignal) => { await gate; signal.throwIfAborted(); committed(); });
    await render(layer, apply);
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '颜色抠图')!.click());
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '提交颜色抠图')!.click());
    await render({ ...layer, id: 'another-image' }, apply);
    await act(async () => finish());
    expect(committed).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('提交颜色抠图');
  });
  it('does not apply an editor result after closing during registration', async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const committed = vi.fn();
    const apply = vi.fn(async (_result, signal: AbortSignal) => { await gate; signal.throwIfAborted(); committed(); });
    await render(layer, apply);
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '颜色抠图')!.click());
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '提交颜色抠图')!.click());
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '关闭颜色抠图')!.click());
    await act(async () => finish());
    expect(committed).not.toHaveBeenCalled();
  });
  it('follows changed defaults and displays MODNet rather than hardcoding U2NetP', async () => {
    await render(layer);
    expect(container.querySelector('select')?.value).toBe('u2netp');
    vi.mocked(useResources).mockReturnValue({ ...useResources(), settings: { modelId: 'modnet', device: 'auto' }, models: { modnet: installed } });
    await render(layer);
    const select = container.querySelector('select')!;
    expect(select.value).toBe('modnet');
    expect(select.selectedOptions[0].textContent).toBe('MODNet');
    expect(select.title).toContain('MODNet');
    expect(select.title).toContain('CPU / WASM');
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
  it('allows uninstalled models and delegates automatic preparation to the shared entry', async () => {
    vi.mocked(useResources).mockReturnValue({ ...useResources(), settings: { modelId: 'modnet', device: 'auto' } });
    const complete = pendingInference();
    await render(layer);
    expect(container.querySelector<HTMLOptionElement>('option[value="modnet"]')?.disabled).toBe(false);
    expect(container.querySelector<HTMLOptionElement>('option[value="birefnet"]')?.disabled).toBe(false);
    expect(container.textContent).toContain('自动下载');
    await click();
    expect(removeBackground).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ modelId: 'modnet' }));
    await complete();
  });
  it('shows shared download progress and errors and permits a manual retry', async () => {
    vi.mocked(removeBackground).mockImplementationOnce(async (_image, options) => {
      options.onProgress?.({ stage: 'download', loaded: 5, total: 10 });
      throw new Error('抠图模型自动下载失败：HTTP 503');
    });
    const apply = await render(layer);
    await click();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('HTTP 503');
    expect(apply).not.toHaveBeenCalled();
    const complete = pendingInference();
    await click();
    await complete();
    expect(apply).toHaveBeenCalledOnce();
  });
  it('submits a successful result with the original preserved by default', async () => {
    const complete = pendingInference();
    const apply = await render(layer);
    await click();
    await complete();
    expect(apply).toHaveBeenCalledExactlyOnceWith({ layerId: layer.id, originalContent: layer.content,
      content: expect.any(Blob), keepOriginal: true }, expect.any(AbortSignal));
  });
  it('allows keeping the original to be unchecked', async () => {
    const complete = pendingInference();
    const apply = await render(layer);
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await click();
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
    await complete();
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ keepOriginal: false }), expect.any(AbortSignal));
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