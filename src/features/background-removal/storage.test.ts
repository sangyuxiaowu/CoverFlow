import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteModel, deleteRuntime, readModel, readRuntime, readSettings, saveModel, saveRuntime, saveSettings, subscribeResources } from './storage.ts';

describe('independent background-removal storage', () => {
  it('defaults to the bundled model and persists selection', async () => {
    expect(await readSettings()).toEqual({ modelId: 'u2netp', device: 'auto' });
    await saveSettings({ modelId: 'birefnet', device: 'wasm' });
    expect(await readSettings()).toEqual({ modelId: 'birefnet', device: 'wasm' });
  });
  it('stores binaries separately and notifies only committed writes', async () => {
    let changes = 0;
    const unsubscribe = subscribeResources(() => { changes++; });
    const blob = new Blob(['model-binary']);
    await saveModel('birefnet', { blob, name: 'updated-model.onnx', importedAt: 123, provider: 'wasm' });
    const restored = await readModel('birefnet');
    expect(await restored?.blob.text()).toBe('model-binary');
    expect(restored?.provider).toBe('wasm');
    expect(changes).toBe(1);
    await deleteModel('birefnet');
    expect(await readModel('birefnet')).toBeUndefined();
    expect(changes).toBe(2);
    unsubscribe();
  });
  it('keeps model deletion independent from runtime cache', async () => {
    await saveRuntime({ script: new Blob(['script']), loader: new Blob(['loader']), wasm: new Blob(['wasm']) });
    await deleteModel('u2netp');
    expect(await (await readRuntime())?.wasm.text()).toBe('wasm');
    await deleteRuntime();
    expect(await readRuntime()).toBeUndefined();
  });
  it('does not reuse old 1024 or unrelated binaries under the Lite 512 profile', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('coverflow-background-removal', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('resources', 'readwrite');
      transaction.objectStore('resources').put({ blob: new Blob(['old-model']), name: 'old.onnx', provider: 'wasm', importedAt: 1 }, 'model-birefnet');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    expect(await readModel('birefnet')).toBeUndefined();
    await saveModel('birefnet', { blob: new Blob(['lite-512']), name: 'model_fp16.onnx', provider: 'webgpu', importedAt: 2 });
    expect(await (await readModel('birefnet'))?.blob.text()).toBe('lite-512');
    await deleteModel('birefnet');
    expect(await readModel('birefnet')).toBeUndefined();
  });
});