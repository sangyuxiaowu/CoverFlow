import type { ProjectPage } from '../types.ts';

export const MAX_PAGE_PREVIEWS = 100;
export const PAGE_PREVIEW_EDGE = 160;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function serializePagePreview(page: ProjectPage): string {
  const metadata = new Set(['id', 'name', 'parentId', 'children', 'imageSource', 'imageDescription', 'backgroundRemoved']);
  const layers = page.layers.filter(layer => layer.visible && layer.type !== 'group').sort((left, right) => left.zIndex - right.zIndex)
    .map(layer => Object.fromEntries(Object.entries(layer).filter(([key]) => !metadata.has(key))));
  return JSON.stringify(canonical({ schema: 2, maxEdge: PAGE_PREVIEW_EDGE, quality: 0.65,
    canvas: { width: page.canvasConfig.width, height: page.canvasConfig.height }, background: page.background, layers }));
}

export async function pagePreviewKey(page: ProjectPage): Promise<string> {
  const bytes = new TextEncoder().encode(serializePagePreview(page));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `fnv1a64-v1:${hash.toString(16).padStart(16, '0')}`;
}

export class PagePreviewCache {
  constructor(private databaseName = 'coverflow_page_previews_v1') {}

  private async transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, result: (value: T) => void) => void, signal?: AbortSignal): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('previews', { keyPath: 'key' });
        store.createIndex('order', 'order', { unique: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      signal?.throwIfAborted();
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction('previews', mode);
        const abort = () => tx.abort();
        let value: T;
        tx.oncomplete = () => { signal?.removeEventListener('abort', abort); resolve(value); };
        tx.onabort = tx.onerror = () => { signal?.removeEventListener('abort', abort); reject(signal?.aborted ? signal.reason : tx.error); };
        signal?.addEventListener('abort', abort, { once: true });
        try { action(tx.objectStore('previews'), result => { value = result; }); }
        catch (error) { tx.abort(); reject(error); }
      });
    } finally { db.close(); }
  }

  get(key: string): Promise<Blob | undefined> {
    return this.transaction('readonly', (store, result) => {
      const request = store.get(key);
      request.onsuccess = () => result(request.result?.blob);
    });
  }

  put(key: string, blob: Blob, signal?: AbortSignal): Promise<void> {
    return this.transaction('readwrite', (store, result) => {
      const latest = store.index('order').openCursor(null, 'prev');
      latest.onsuccess = () => {
        store.put({ key, blob, order: (latest.result?.value.order ?? 0) + 1 });
        const count = store.count();
        count.onsuccess = () => {
          let excess = count.result - MAX_PAGE_PREVIEWS;
          if (excess <= 0) { result(undefined); return; }
          const oldest = store.index('order').openCursor();
          oldest.onsuccess = () => {
            const cursor = oldest.result;
            if (!cursor || excess <= 0) { result(undefined); return; }
            cursor.delete();
            excess--;
            cursor.continue();
          };
        };
      };
    }, signal);
  }

  count(): Promise<number> {
    return this.transaction('readonly', (store, result) => {
      const request = store.count();
      request.onsuccess = () => result(request.result);
    });
  }

  clear(): Promise<void> {
    return this.transaction('readwrite', (store, result) => { store.clear(); result(undefined); });
  }
}