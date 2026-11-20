import type { ProjectState } from '../types.ts';
import { cachedProjectImage } from '../storage/IndexedDBAdapter.ts';
import { imageAssets } from '../storage/imageAssets.ts';

export async function previewImageAssets(project: ProjectState, maxEdge: number, signal: AbortSignal) {
  const urls: string[] = [];
  const dispose = () => { for (const url of urls) URL.revokeObjectURL(url); };
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return { project, dispose };
  const requested = new Map<string, number>();
  const add = (value: string, scale: number) => requested.set(value, Math.max(requested.get(value) ?? 0, Math.min(4096, maxEdge * 2 * scale)));
  for (const layer of project.layers) {
    if (layer.type !== 'image' || !layer.visible) continue;
    const crop = layer.imageCrop;
    add(layer.content, crop ? Math.max(1, 100 / Math.max(1, crop.width), 100 / Math.max(1, crop.height)) : 1);
  }
  if (project.pageInfo.background.type === 'image') add(project.pageInfo.background.value, 1);
  const replacements = new Map<string, string>();
  try {
    for (const [value, limit] of requested) {
      signal.throwIfAborted();
      const cached = cachedProjectImage(project.id, value);
      let bitmap: ImageBitmap | undefined;
      try {
        const source = imageAssets.blob(value) ?? (cached ? (await cached).blob :
          /^data:image\/|^blob:/i.test(value) ? await (await fetch(value, { signal })).blob() : undefined);
        if (!source) continue;
        signal.throwIfAborted();
        bitmap = await createImageBitmap(source);
        signal.throwIfAborted();
        const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
        const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
        const context = canvas.getContext('2d');
        if (!context) continue;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
        signal.throwIfAborted();
        const url = URL.createObjectURL(blob);
        urls.push(url);
        replacements.set(value, url);
      } catch (error) {
        if (signal.aborted) throw error;
      } finally { bitmap?.close(); }
    }
    if (!replacements.size) return { project, dispose };
    const background = project.pageInfo.background;
    return { project: { ...project,
      layers: project.layers.map(layer => layer.type === 'image' && replacements.has(layer.content) ? { ...layer, content: replacements.get(layer.content)! } : layer),
      pageInfo: { ...project.pageInfo, background: background.type === 'image' && replacements.has(background.value) ? { ...background, value: replacements.get(background.value)! } : background }
    }, dispose };
  } catch (error) { dispose(); throw error; }
}