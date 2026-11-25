// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import * as htmlToImage from 'html-to-image';
import type { ProjectState } from '../types.ts';
import { renderProjectImage } from './renderProjectImage.tsx';
import { previewImageAssets } from './previewImageAssets.ts';
import { cachedProjectImage } from '../storage/IndexedDBAdapter.ts';

vi.hoisted(() => { vi.resetModules(); });
vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));
vi.mock('../components/LivePreview.tsx', () => ({ default: ({ previewRef }: { previewRef: { current: HTMLDivElement | null } }) => <div ref={previewRef} /> }));
vi.mock('../features/ai/services/fontLoading.ts', () => ({ ensureProjectFonts: vi.fn(async () => {}), projectFontEmbedCSS: vi.fn(async () => '') }));
vi.mock('../storage/IndexedDBAdapter.ts', () => ({ cachedProjectImage: vi.fn() }));
vi.mock('./previewIdle.ts', async importOriginal => ({ ...await importOriginal<typeof import('./previewIdle.ts')>(),
  waitForPreviewIdle: vi.fn(async (signal: AbortSignal) => signal.throwIfAborted()) }));

it('waits for an uncancellable screenshot before releasing the background queue and clears canvases', async () => {
  const project: ProjectState = { id: 'images', title: 'Images', layers: [], selectedLayerId: null, updatedAt: 1, pageInfo: { ...({ width: 1024, height: 1024 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } };
  const firstCanvas = document.createElement('canvas');
  const secondCanvas = document.createElement('canvas');
  secondCanvas.toBlob = callback => callback(new Blob(['preview']));
  let finish!: (canvas: HTMLCanvasElement) => void;
  let started!: () => void;
  const screenshotStarted = new Promise<void>(resolve => { started = resolve; });
  vi.mocked(htmlToImage.toCanvas).mockReset().mockImplementationOnce(() => {
    started();
    return new Promise(resolve => { finish = resolve; });
  }).mockResolvedValueOnce(secondCanvas);
  const controller = new AbortController();
  const first = renderProjectImage(project, { background: true, signal: controller.signal }).catch(error => error);
  await screenshotStarted;
  controller.abort();
  const second = renderProjectImage(project, { background: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const callsBeforeCompletion = vi.mocked(htmlToImage.toCanvas).mock.calls.length;
  finish(firstCanvas);
  expect((await first).name).toBe('AbortError');
  expect(await second).toBeInstanceOf(Blob);
  expect(callsBeforeCompletion).toBe(1);
  expect(firstCanvas.width).toBe(0);
  expect(firstCanvas.height).toBe(0);
  expect(secondCanvas.width).toBe(0);
  expect(secondCanvas.height).toBe(0);
  expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
});

it('uses temporary reduced assets only for previews and revokes their URLs', async () => {
  const image = 'data:image/png;base64,AQIDBA==';
  const project: ProjectState = { id: 'preview', title: 'Preview', selectedLayerId: null, updatedAt: 1,
    layers: [{ id: 'image', name: 'Image', type: 'image', content: image, x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }],
    pageInfo: { width: 1000, height: 1000, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } };
  const close = vi.fn();
  const drawImage = vi.fn();
  const revoke = vi.fn();
  vi.mocked(cachedProjectImage).mockReturnValue(Promise.resolve({ id: 'asset', blob: new Blob(['image']) }));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2000, height: 1000, close })));
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { drawImage }; }
    async convertToBlob() { return new Blob(['preview'], { type: 'image/webp' }); }
  });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: revoke });
  try {
    const preview = await previewImageAssets(project, 320, new AbortController().signal);
    expect(preview.project.layers[0].content).toBe('blob:preview');
    expect(project.layers[0].content).toBe(image);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 640, 320);
    expect(close).toHaveBeenCalledOnce();
    preview.dispose();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:preview');
  } finally { vi.unstubAllGlobals(); vi.clearAllMocks(); }
});

it('uses a binary image for a file project preview without an IndexedDB cache', async () => {
  const image = 'data:image/png;base64,AQIDBA==';
  const project: ProjectState = { id: 'file-preview', title: 'Preview', selectedLayerId: null, updatedAt: 1,
    layers: [{ id: 'image', name: 'Image', type: 'image', content: image, x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }],
    pageInfo: { width: 1000, height: 1000, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } };
  const source = new Blob(['image'], { type: 'image/png' });
  vi.mocked(cachedProjectImage).mockReturnValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => source })));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1000, height: 500, close: vi.fn() })));
  vi.stubGlobal('OffscreenCanvas', class {
    getContext() { return { drawImage: vi.fn() }; }
    async convertToBlob() { return new Blob(['preview']); }
  });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:file-preview'), revokeObjectURL: vi.fn() });
  try {
    const preview = await previewImageAssets(project, 320, new AbortController().signal);
    expect(preview.project.layers[0].content).toBe('blob:file-preview');
    expect(createImageBitmap).toHaveBeenCalledWith(source);
    preview.dispose();
  } finally { vi.unstubAllGlobals(); vi.clearAllMocks(); }
});