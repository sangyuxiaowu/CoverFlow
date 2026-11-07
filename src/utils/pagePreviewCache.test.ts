import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { ProjectPage } from '../types.ts';
import { MAX_PAGE_PREVIEWS, PagePreviewCache, pagePreviewKey, serializePagePreview } from './pagePreviewCache.ts';
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

it('reuses the same IndexedDB key without Web Crypto in a Tauri webview', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const expected = await pagePreviewKey(page);
  expect(expected).toMatch(/^fnv1a64-v1:[0-9a-f]{16}$/);
  const cache = new PagePreviewCache();
  await cache.put(expected, new Blob(['cached preview']));
  vi.stubGlobal('crypto', undefined);
  const key = await pagePreviewKey(page);
  expect(key).toBe(expected);
  expect(await (await cache.get(key))!.text()).toBe('cached preview');
});

it('keeps content fingerprints stable across copies and changes them with visual content', async () => {
  const key = await pagePreviewKey(page);
  const copied = { ...structuredClone(page), id: 'copied', name: 'Renamed' };
  copied.layers[0].id = 'copied-layer';
  copied.layers[0].name = 'Renamed layer';
  expect(await pagePreviewKey(copied)).toBe(key);
  for (const changed of [
    { ...page, canvasConfig: { ...page.canvasConfig, width: 800 } },
    { ...page, background: { ...page.background, value: '#000' } },
    { ...page, layers: [{ ...page.layers[0], content: 'Changed' }] },
    { ...page, layers: [{ ...page.layers[0], content: '\u4e2d\u6587\ud83d\ude00' }] }
  ]) expect(await pagePreviewKey(changed)).not.toBe(key);
});

it('persists at most 100 blobs and evicts by insertion order without touching reads', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const cache = new PagePreviewCache();
  const blob = new Blob(['page']);
  for (let index = 0; index < MAX_PAGE_PREVIEWS; index++) await cache.put(`key-${index}`, blob);
  expect(await cache.count()).toBe(100);
  expect(await (await cache.get('key-0'))!.text()).toBe('page');
  await cache.put('next', blob);
  const reopened = new PagePreviewCache();
  expect(await reopened.count()).toBe(100);
  expect(await reopened.get('key-0')).toBeUndefined();
  expect(await reopened.get('key-1')).toBeInstanceOf(Blob);
  await reopened.put('next', new Blob(['updated']));
  expect(await reopened.count()).toBe(100);
  expect(await (await reopened.get('next'))!.text()).toBe('updated');
  await reopened.clear();
  expect(await cache.count()).toBe(0);
});

it('keeps concurrent writes within the limit and skips cancelled writes', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const cache = new PagePreviewCache();
  await Promise.all(Array.from({ length: 105 }, (_, index) => cache.put(`key-${index}`, new Blob(['page']))));
  expect(await cache.count()).toBe(100);
  expect(await cache.get('key-0')).toBeUndefined();
  expect(await cache.get('key-104')).toBeInstanceOf(Blob);
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await expect(cache.put('cancelled', new Blob(['page']), controller.signal)).rejects.toThrow('cancelled');
  expect(await cache.get('cancelled')).toBeUndefined();
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