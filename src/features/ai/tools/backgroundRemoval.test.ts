import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer, ProjectState } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { executeTool } from './execute.ts';
import { blobDataUrl, removeBackground } from '../../background-removal/index.ts';
import { download, installRuntime } from '../../background-removal/resources.ts';
import { readModel, readRuntime } from '../../background-removal/storage.ts';

vi.mock('../../background-removal/index.ts', () => ({ removeBackground: vi.fn(), blobDataUrl: vi.fn() }));
vi.mock('../../background-removal/resources.ts', () => ({ download: vi.fn(), installRuntime: vi.fn() }));
vi.mock('../../background-removal/storage.ts', () => ({ readModel: vi.fn(), readRuntime: vi.fn() }));

const layer: Layer = {
  id: 'image', name: 'Photo', type: 'image', content: 'data:image/png;base64,AA==', imageSource: 'upload', imageDescription: 'original',
  x: 10, y: 20, width: 100, height: 200, rotation: 12, opacity: .8, zIndex: 1, visible: true, locked: false
};
const args = { projectId: 'project', layerId: layer.id };
const runtime = { script: new Blob(['js']), loader: new Blob(['mjs']), wasm: new Blob(['wasm']) };
function setup() {
  let project: ProjectState = {
    id: 'project', title: 'Test', updatedAt: 0, layers: [structuredClone(layer)], selectedLayerId: layer.id,
    canvasConfig: { width: 800, height: 600, ratio: '4:3' },
    background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 1 }
  };
  const commit = vi.fn(async (next: ProjectState) => { project = next; });
  const bridge: WorkspaceBridge = { getProject: () => project, getSelection: () => [], commit, manageProjects: async () => ({}) };
  const controller = new AbortController();
  const run = (input: unknown = args) => executeTool('remove_background', input, bridge, controller.signal);
  return { run, bridge, controller, commit, change: (next: ProjectState) => { project = next; } };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readRuntime).mockResolvedValue(runtime);
  vi.mocked(readModel).mockResolvedValue(undefined);
  vi.mocked(download).mockResolvedValue(new Blob(['image']));
  vi.mocked(installRuntime).mockResolvedValue();
  vi.mocked(removeBackground).mockResolvedValue({ blob: new Blob(['png']), provider: 'wasm', modelId: 'u2netp' });
  vi.mocked(blobDataUrl).mockResolvedValue('data:image/png;base64,RESULT');
});

describe('static AI background-removal execution', () => {
  it('downloads a missing runtime then commits a marked copy while preserving the original', async () => {
    vi.mocked(readRuntime).mockResolvedValueOnce(undefined).mockResolvedValue(runtime);
    const context = setup();
    expect(await context.run()).toMatchObject({ success: true, modelId: 'u2netp', keepOriginal: true, runtimeDownloaded: true });
    expect(installRuntime).toHaveBeenCalledOnce();
    expect(removeBackground).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ modelId: 'u2netp', device: 'auto' }));
    expect(context.commit).toHaveBeenCalledOnce();
    expect(context.bridge.getProject()!.layers[0]).toMatchObject({ id: layer.id, visible: false, content: layer.content });
    expect(context.bridge.getProject()!.layers[1]).toMatchObject({ backgroundRemoved: true, imageSource: 'upload', imageDescription: 'original' });
  });
  it('uses an explicitly selected ready model and device without downloading runtime or changing defaults', async () => {
    vi.mocked(readModel).mockResolvedValue({ blob: new Blob(['onnx']), name: 'model', provider: 'webgpu', importedAt: 1 });
    const context = setup();
    expect(await context.run({ ...args, modelId: 'birefnet', device: 'webgpu', keepOriginal: false })).toMatchObject({ success: true, modelId: 'birefnet', layerId: layer.id, runtimeDownloaded: false });
    expect(removeBackground).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ modelId: 'birefnet', device: 'webgpu' }));
    expect(installRuntime).not.toHaveBeenCalled();
    expect(context.bridge.getProject()!.layers).toHaveLength(1);
    expect(context.bridge.getProject()!.layers[0].backgroundRemoved).toBe(true);
  });
  it('returns a missing-model result instead of hiding the tool or downloading a large model', async () => {
    const context = setup();
    expect(await context.run({ ...args, modelId: 'birefnet' })).toMatchObject({ success: false, code: 'MODEL_NOT_READY', stage: 'model', error: expect.stringContaining('BiRefNet') });
    expect(installRuntime).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(context.commit).not.toHaveBeenCalled();
  });
  it('returns runtime download failures and their underlying cause without modifying layers', async () => {
    vi.mocked(readRuntime).mockResolvedValue(undefined);
    vi.mocked(installRuntime).mockRejectedValue(new Error('Download HTTP 403', { cause: new Error('CDN denied access') }));
    const context = setup();
    expect(await context.run()).toMatchObject({ success: false, code: 'RUNTIME_DOWNLOAD_FAILED', stage: 'runtime_download', error: expect.stringMatching(/403.*CDN denied access/) });
    expect(removeBackground).not.toHaveBeenCalled();
    expect(context.commit).not.toHaveBeenCalled();
  });
  it('reports the failing runtime filename', async () => {
    vi.mocked(readRuntime).mockResolvedValue(undefined);
    vi.mocked(installRuntime).mockImplementation(async (_signal, progress) => {
      progress?.({ stage: 'ort-wasm-simd-threaded.jsep.wasm' });
      throw new Error('Download HTTP 503');
    });
    expect(await setup().run()).toMatchObject({ success: false, code: 'RUNTIME_DOWNLOAD_FAILED',
      runtimeFile: 'ort-wasm-simd-threaded.jsep.wasm', error: 'Download HTTP 503' });
  });
  it('revalidates the active project after downloading runtime', async () => {
    const context = setup();
    vi.mocked(readRuntime).mockResolvedValueOnce(undefined).mockResolvedValue(runtime);
    vi.mocked(installRuntime).mockImplementation(async () => {
      context.change({ ...context.bridge.getProject()!, id: 'another-project' });
    });
    expect(await context.run()).toMatchObject({ success: false, code: 'TARGET_NOT_READY', stage: 'validation', runtimeDownloaded: true });
    expect(removeBackground).not.toHaveBeenCalled();
    expect(context.commit).not.toHaveBeenCalled();
  });
  it.each([
    ['image_load', download, 'IMAGE_LOAD_FAILED'],
    ['inference', removeBackground, 'INFERENCE_FAILED'],
    ['inference', blobDataUrl, 'INFERENCE_FAILED']
  ] as const)('returns %s errors with the original message', async (stage, operation, code) => {
    vi.mocked(operation).mockRejectedValue(new Error('Specific failure detail'));
    const context = setup();
    expect(await context.run()).toMatchObject({ success: false, code, stage, error: 'Specific failure detail' });
    expect(context.commit).not.toHaveBeenCalled();
  });
  it.each([{ modelId: 'unknown' }, { keepOriginal: 'yes' }, { device: 'unknown' }, { surprise: true }])('rejects invalid request %j before any resources are loaded', async patch => {
    const context = setup();
    expect(await context.run({ ...args, ...patch })).toMatchObject({ success: false, code: 'INVALID_REQUEST' });
    expect(readRuntime).not.toHaveBeenCalled();
  });
  it.each([{ locked: true }, { backgroundRemoved: true }])('blocks an unavailable target %j', async patch => {
    const context = setup();
    Object.assign(context.bridge.getProject()!.layers[0], patch);
    expect(await context.run()).toMatchObject({ success: false, code: 'TARGET_NOT_READY' });
    expect(download).not.toHaveBeenCalled();
    expect(context.commit).not.toHaveBeenCalled();
  });
  it('does not overwrite unrelated changes made while inference is running', async () => {
    const context = setup();
    vi.mocked(removeBackground).mockImplementation(async () => {
      context.bridge.getProject()!.title = 'latest title';
      context.bridge.getProject()!.layers[0].x = 123;
      return { blob: new Blob(['png']), provider: 'wasm', modelId: 'u2netp' };
    });
    await context.run();
    expect(context.bridge.getProject()!.title).toBe('latest title');
    expect(context.bridge.getProject()!.layers[1].x).toBe(123);
  });
  it('rejects project or source replacement during inference', async () => {
    for (const kind of ['project', 'image'] as const) {
      const context = setup();
      vi.mocked(removeBackground).mockImplementation(async () => {
        const project = context.bridge.getProject()!;
        if (kind === 'project') context.change({ ...project, id: 'different' });
        else project.layers[0].content = 'replacement';
        return { blob: new Blob(['png']), provider: 'wasm', modelId: 'u2netp' };
      });
      expect(await context.run()).toMatchObject({ success: false, code: 'APPLY_FAILED' });
      expect(context.commit).not.toHaveBeenCalled();
    }
  });
  it('propagates cancellation to the existing conversation interruption handler', async () => {
    const context = setup();
    vi.mocked(removeBackground).mockImplementation(async () => { context.controller.abort(new Error('User stopped')); throw new Error('aborted'); });
    await expect(context.run()).rejects.toThrow('User stopped');
    expect(context.commit).not.toHaveBeenCalled();
  });
  it('reports saving failures and warns that the layer may already be updated', async () => {
    const context = setup();
    context.commit.mockRejectedValue(new Error('Disk full'));
    expect(await context.run()).toMatchObject({ success: false, code: 'COMMIT_FAILED', error: 'Disk full', mayHaveApplied: true, resultLayerId: expect.any(String) });
  });
});