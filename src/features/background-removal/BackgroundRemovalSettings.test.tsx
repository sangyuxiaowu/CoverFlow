// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BackgroundRemovalSettings from './BackgroundRemovalSettings.tsx';
import { installModel } from './index.ts';
import { saveSettings } from './storage.ts';
import { downloadModel } from './resources.ts';
import { useResources } from './useResources.ts';
import type { ModelId } from './models.ts';
import type { StoredModel } from './types.ts';

vi.mock('./index.ts', () => ({ installModel: vi.fn(), verifyModel: vi.fn() }));
vi.mock('./storage.ts', () => ({
  RUNTIME_VERSION: '1.23.2', readSettings: vi.fn(async () => ({ modelId: 'u2netp', device: 'wasm' })),
  saveSettings: vi.fn(async () => {}), deleteModel: vi.fn(), deleteRuntime: vi.fn()
}));
vi.mock('./resources.ts', () => ({
  RUNTIME_ASSETS: {}, RUNTIME_BASE: '', downloadModel: vi.fn(), importRuntime: vi.fn(),
  installRuntime: vi.fn(), loadResources: vi.fn()
}));
vi.mock('./useResources.ts', () => ({ useResources: vi.fn(() => ({
  settings: { modelId: 'u2netp' as const, device: 'wasm' as const },
  models: {} as Partial<Record<ModelId, StoredModel>>, runtime: true, loading: false, error: ''
})) }));

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<BackgroundRemovalSettings english={false} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

async function importFile() {
  const input = container.querySelector('input[accept=".onnx"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['new-model'], 'updated.onnx')] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

describe('model activation settings', () => {
  it.each([
    ['fp16', 'model_fp16.onnx'], ['fp32', 'model.onnx']
  ] as const)('downloads, validates and activates the selected %s variant', async (precision, filename) => {
    const blob = new Blob(['model']);
    vi.mocked(downloadModel).mockResolvedValue(blob);
    vi.mocked(installModel).mockResolvedValue();
    const button = [...container.querySelectorAll('button')].find(button => button.textContent?.includes(`下载 ${precision.toUpperCase()}`))!;
    await act(async () => button.click());
    expect(downloadModel).toHaveBeenCalledWith('birefnet', expect.any(AbortSignal), expect.any(Function), precision);
    expect(installModel).toHaveBeenCalledWith('birefnet', blob, filename, 'wasm', expect.any(Object));
    expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ modelId: 'birefnet', device: 'wasm' });
  });
  it('uses a neutral model title and actual installed FP32 size without mislabeling it FP16', async () => {
    const state = useResources();
    vi.mocked(useResources).mockReturnValue({ ...state, models: { birefnet: {
      blob: { size: 191877254 } as Blob, name: 'model.onnx', importedAt: 1, provider: 'webgpu'
    } } });
    await act(async () => root.render(<BackgroundRemovalSettings english={false} />));
    const card = [...container.querySelectorAll('article')].find(article => article.querySelector('strong')?.textContent === 'BiRefNet Lite 512')!;
    expect(card.textContent).toContain('191.88 MB');
    expect(card.textContent).toContain('model.onnx');
    expect(container.querySelector('option[value="birefnet"]')?.textContent).toContain('191.9 MB');
    expect(card.querySelector('strong')?.textContent).not.toContain('FP16');
    expect([...card.querySelectorAll('button')].filter(button => button.textContent?.includes('下载 FP'))).toHaveLength(2);
    expect(card.querySelector('a')?.href).toBe('https://www.modelscope.cn/models/sangsq/birefnet-lite-512');
  });
  it('activates a newly imported model only after inference validation succeeds', async () => {
    vi.mocked(installModel).mockResolvedValue();
    await importFile();
    expect(installModel).toHaveBeenCalledOnce();
    expect(vi.mocked(installModel).mock.calls[0][0]).toBe('birefnet');
    expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ modelId: 'birefnet', device: 'wasm' });
    expect(container.textContent).toContain('已完成');
  });
  it('keeps previous selection when validation fails', async () => {
    vi.mocked(installModel).mockRejectedValue(new Error('Unsupported model input'));
    await importFile();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unsupported model input');
  });
});