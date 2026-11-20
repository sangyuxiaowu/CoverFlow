import type { ProjectState } from '../types.ts';
import { encodeProjectArchive, prepareProjectArchivePreviews } from './projectArchive.ts';

self.onmessage = async (event: MessageEvent<{ kind: 'encode' | 'previews'; project: ProjectState; previews: Record<string, Uint8Array>; assets?: Record<string, Blob>; bytes?: Uint8Array }>) => {
  try {
    const result = event.data.kind === 'encode'
      ? await encodeProjectArchive(event.data.project, event.data.previews, event.data.assets)
      : await prepareProjectArchivePreviews(event.data.bytes!, event.data.project, event.data.previews);
    const bytes = result instanceof Uint8Array ? result : result.bytes;
    self.postMessage({ ok: true, result }, { transfer: bytes ? [bytes.buffer] : [] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};