import { afterEach, describe, expect, it, vi } from 'vitest';
import { download, importRuntime, RUNTIME_ASSETS, validateRuntime } from './resources.ts';
import type { RuntimeFiles } from './types.ts';

afterEach(() => vi.unstubAllGlobals());

describe('optional removal resources', () => {
  it('pairs the dedicated WebGPU entry with its asyncify loader and WASM', () => {
    expect(RUNTIME_ASSETS).toEqual({
      script: 'ort.webgpu.bundle.min.mjs',
      loader: 'ort-wasm-simd-threaded.asyncify.mjs',
      wasm: 'ort-wasm-simd-threaded.asyncify.wasm'
    });
  });
  it('downloads directly without credentials and reports bytes', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([8, 1, 2]), { headers: { 'content-length': '3' } }));
    vi.stubGlobal('fetch', fetch);
    const report = vi.fn();
    const signal = new AbortController().signal;
    const blob = await download('https://example.com/model.onnx', 100, signal, report);
    expect(blob.size).toBe(3);
    expect(fetch).toHaveBeenCalledWith('https://example.com/model.onnx', {
      signal, credentials: 'omit', referrerPolicy: 'no-referrer'
    });
    expect(report).toHaveBeenCalledWith({ stage: 'download', loaded: 3, total: 3 });
  });
  it('rejects HTTP errors, empty and oversized downloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    await expect(download('https://example.com', 100, new AbortController().signal)).rejects.toThrow('403');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(20))));
    await expect(download('https://example.com', 10, new AbortController().signal)).rejects.toThrow('size limit');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array())));
    await expect(download('https://example.com', 10, new AbortController().signal)).rejects.toThrow('empty');
  });
  it('does not accept a finished download after cancellation', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort();
      return new Response(new Uint8Array([1]));
    }));
    await expect(download('https://example.com', 10, controller.signal)).rejects.toThrow();
  });
  it('checks runtime format without tying resources to hashes or exact sizes', async () => {
    const runtime: RuntimeFiles = {
      script: new Blob(['export const runtime = {};'.repeat(100)]),
      loader: new Blob(['export default {};'.repeat(100)]),
      wasm: new Blob([new Uint8Array([0, 97, 115, 109, 1])])
    };
    await expect(validateRuntime(runtime)).resolves.toBeUndefined();
    await expect(validateRuntime({ ...runtime, wasm: new Blob(['<html>']) })).rejects.toThrow('WASM');
    await expect(validateRuntime({ ...runtime, script: new Blob(['<html>', ' '.repeat(2000)]) })).rejects.toThrow('JavaScript');
    await expect(importRuntime([])).rejects.toThrow('Missing');
  });
});