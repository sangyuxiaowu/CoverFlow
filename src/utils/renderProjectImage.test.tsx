// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import * as htmlToImage from 'html-to-image';
import type { ProjectState } from '../types.ts';
import { renderProjectImage } from './renderProjectImage.tsx';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));
vi.mock('../components/LivePreview.tsx', () => ({ default: ({ previewRef }: { previewRef: { current: HTMLDivElement | null } }) => <div ref={previewRef} /> }));
vi.mock('../features/ai/services/fontLoading.ts', () => ({ ensureProjectFonts: vi.fn(async () => {}), projectFontEmbedCSS: vi.fn(async () => '') }));
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