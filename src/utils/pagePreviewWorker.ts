import type { ProjectPage } from '../types.ts';

export function createPagePreviewWorker() {
  const worker = new Worker(new URL('../workers/pagePreview.worker.ts', import.meta.url), { type: 'module' });
  let nextId = 0;
  let stopped = false;
  const pending = new Map<number, { resolve: (value: { key?: string; blob?: Blob }) => void; reject: (error: Error) => void }>();
  const rejectAll = (error: Error) => { for (const task of pending.values()) task.reject(error); pending.clear(); };
  worker.onmessage = ({ data }: MessageEvent<{ id: number; key?: string; blob?: Blob; error?: string }>) => {
    const task = pending.get(data.id);
    if (!task) return;
    pending.delete(data.id);
    if (data.error) task.reject(new Error(data.error));
    else task.resolve(data);
  };
  worker.onerror = () => { stopped = true; rejectAll(new Error('Preview background worker failed.')); };
  const request = (data: object, transfer: Transferable[] = []) => new Promise<{ key?: string; blob?: Blob }>((resolve, reject) => {
    if (stopped) { reject(new Error('Preview background worker is stopped.')); return; }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try { worker.postMessage({ ...data, id }, transfer); }
    catch (error) { pending.delete(id); reject(error); }
  });
  return {
    async key(page: ProjectPage) {
      const result = await request({ type: 'key', page });
      if (!result.key) throw new Error('Preview content key is unavailable.');
      return result.key;
    },
    async encode(bitmap: ImageBitmap, format: string, quality: number) {
      const result = await request({ type: 'encode', bitmap, format, quality }, [bitmap]);
      if (!result.blob) throw new Error('Preview image is unavailable.');
      return result.blob;
    },
    dispose() { stopped = true; worker.terminate(); rejectAll(new Error('Preview background work cancelled.')); }
  };
}