// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BackgroundRemovalSettings from './BackgroundRemovalSettings.tsx';
import { installModel } from './index.ts';
import { saveSettings } from './storage.ts';

vi.mock('./index.ts', () => ({ installModel: vi.fn(), verifyModel: vi.fn() }));
vi.mock('./storage.ts', () => ({
  RUNTIME_VERSION: '1.23.2', readSettings: vi.fn(async () => ({ modelId: 'u2netp', device: 'wasm' })),
  saveSettings: vi.fn(async () => {}), deleteModel: vi.fn(), deleteRuntime: vi.fn()
}));
vi.mock('./resources.ts', () => ({
  RUNTIME_ASSETS: {}, RUNTIME_BASE: '', downloadModel: vi.fn(), importRuntime: vi.fn(),
  installRuntime: vi.fn(), loadResources: vi.fn()
}));
vi.mock('./useResources.ts', () => ({ useResources: () => ({
  settings: { modelId: 'u2netp', device: 'wasm' }, models: {}, runtime: true, loading: false, error: ''
}) }));

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