import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectPage } from '../types.ts';
import { MAX_PAGE_PREVIEWS, PagePreviewCache, serializePagePreview } from './pagePreviewCache.ts';
import { waitForPreviewIdle, waitForPreviewTask } from './previewIdle.ts';

afterEach(() => vi.unstubAllGlobals());

const page: ProjectPage = {
  id: 'page', name: '', canvasConfig: { width: 900, height: 383, ratio: '2.35:1' },
  background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 },
  layers: [{ id: 'text', name: 'Title', type: 'text', content: 'First\nSecond', x: 0, y: 0, width: 500, height: 200, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1, lineHeight: 1.5 }]
};

it('keys visual content independently of identities, names and object property order', () => {
  const renamed = { ...structuredClone(page), id: 'copied', name: 'Renamed', canvasConfig: { ratio: 'custom', height: 383, width: 900 } };
  renamed.layers[0].id = 'copy-text';
  renamed.layers[0].name = 'Another title';
  expect(serializePagePreview(renamed)).toBe(serializePagePreview(page));
  for (const changed of [
    { ...page, canvasConfig: { ...page.canvasConfig, width: 800 } },
    { ...page, background: { ...page.background, value: '#000' } },
    { ...page, layers: [{ ...page.layers[0], content: 'Changed' }] },
    { ...page, layers: [{ ...page.layers[0], lineHeight: 2 }] }
  ]) expect(serializePagePreview(changed)).not.toBe(serializePagePreview(page));
});

it('holds at most 100 entries, touches hits and releases replaced and evicted URLs', () => {
  let sequence = 0;
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: () => `blob:${sequence++}`, revokeObjectURL: revoke });
  const cache = new PagePreviewCache();
  const blob = new Blob(['page']);
  for (let index = 0; index < MAX_PAGE_PREVIEWS; index++) cache.put(`key-${index}`, blob);
  expect(cache.size).toBe(100);
  expect(cache.get('key-0')).toBe('blob:0');
  cache.put('next', blob);
  expect(cache.size).toBe(100);
  expect(cache.peek('key-1')).toBeUndefined();
  expect(cache.peek('key-0')).toBe('blob:0');
  expect(revoke).toHaveBeenCalledWith('blob:1');
  cache.put('next', blob);
  expect(revoke).toHaveBeenCalledWith('blob:100');
  cache.clear();
  expect(cache.size).toBe(0);
  expect(revoke).toHaveBeenCalledTimes(102);
});

it('waits for enough idle time and cancels pending work without executing it', async () => {
  let callback!: IdleRequestCallback;
  const schedule = vi.fn((next: IdleRequestCallback) => { callback = next; return 1; });
  const cancel = vi.fn();
  vi.stubGlobal('window', { requestIdleCallback: schedule, cancelIdleCallback: cancel });
  vi.stubGlobal('navigator', {});
  const controller = new AbortController();
  let finished = false;
  const pending = waitForPreviewIdle(controller.signal).then(() => { finished = true; });
  callback({ didTimeout: false, timeRemaining: () => 2 });
  await Promise.resolve();
  expect(finished).toBe(false);
  expect(schedule).toHaveBeenCalledTimes(2);
  callback({ didTimeout: false, timeRemaining: () => 20 });
  await pending;
  expect(finished).toBe(true);
  const stopped = new AbortController();
  const rejection = expect(waitForPreviewIdle(stopped.signal)).rejects.toThrow('stop');
  stopped.abort(new Error('stop'));
  await rejection;
  expect(cancel).toHaveBeenCalledTimes(2);
});

it('releases a cancelled asynchronous wait without waiting for its obsolete result', async () => {
  let finish!: (value: string) => void;
  const task = new Promise<string>(resolve => { finish = resolve; });
  const controller = new AbortController();
  const rejection = expect(waitForPreviewTask(task, controller.signal)).rejects.toThrow('cancelled');
  controller.abort(new Error('cancelled'));
  await rejection;
  finish('obsolete');
  await task;
});