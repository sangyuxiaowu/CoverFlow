import type { ProjectPage } from '../types.ts';
import { serializePagePreview } from '../utils/pagePreviewCache.ts';

type Job = { id: number; type: 'key'; page: ProjectPage } |
  { id: number; type: 'encode'; bitmap: ImageBitmap; format: string; quality: number };
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Job>) => void) | null;
  postMessage: (message: { id: number; key?: string; blob?: Blob; error?: string }) => void;
};

scope.onmessage = async ({ data }) => {
  try {
    if (data.type === 'key') {
      const bytes = new TextEncoder().encode(serializePagePreview(data.page));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      scope.postMessage({ id: data.id, key });
    } else {
      try {
        const canvas = new OffscreenCanvas(data.bitmap.width, data.bitmap.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Preview encoding context is unavailable.');
        context.drawImage(data.bitmap, 0, 0);
        const blob = await canvas.convertToBlob({ type: data.format, quality: data.quality });
        scope.postMessage({ id: data.id, blob });
      } finally { data.bitmap.close(); }
    }
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};