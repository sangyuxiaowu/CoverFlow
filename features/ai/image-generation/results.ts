export function validateImageDownloadUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Image requests require HTTPS, or HTTP on localhost.');
  if (url.username || url.password || url.hash) throw new Error('Image URL cannot contain credentials or fragments.');
  return url;
}

export async function normalizeGeneratedImage(blob: Blob): Promise<Blob> {
  if (!blob.size) throw new Error('Generated image is empty. Do not regenerate automatically.');
  if (blob.size > 25 * 1024 * 1024) throw new Error('Generated image exceeds 25 MB.');
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = [82, 73, 70, 70].every((value, index) => bytes[index] === value)
    && [87, 69, 66, 80].every((value, index) => bytes[index + 8] === value);
  const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : webp ? 'image/webp' : '';
  if (!mime) throw new Error(`Generated image data is not PNG, JPEG or WebP (reported Content-Type: ${blob.type || 'missing'}). Do not regenerate automatically.`);
  return blob.type === mime ? blob : blob.slice(0, blob.size, mime);
}

export interface ImageResult {
  b64_json?: string;
  url?: string;
}

export function readImageResults(data: unknown, key: string): ImageResult[] {
  if (!data || typeof data !== 'object') return [];
  const items: unknown = (data as Record<string, unknown>)[key];
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    if (!item || typeof item !== 'object') return {};
    const result = item as Record<string, unknown>;
    return { ...(typeof result.b64_json === 'string' ? { b64_json: result.b64_json } : {}), ...(typeof result.url === 'string' ? { url: result.url } : {}) };
  });
}

export async function downloadImage(item: ImageResult, signal: AbortSignal): Promise<Blob> {
  let blob: Blob;
  if (typeof item?.b64_json === 'string' && item.b64_json.length) {
    if (item.b64_json.length > 35 * 1024 * 1024) throw new Error('Generated image exceeds 25 MB.');
    const bytes = Uint8Array.from(atob(item.b64_json), character => character.charCodeAt(0));
    blob = new Blob([bytes]);
  } else if (typeof item?.url === 'string') {
    const download = await fetch(validateImageDownloadUrl(item.url), { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!download.ok) throw new Error(`Generated image download failed (HTTP ${download.status}). Do not regenerate automatically.`);
    if (Number(download.headers.get('content-length')) > 25 * 1024 * 1024) throw new Error('Generated image exceeds 25 MB.');
    blob = await download.blob();
  } else throw new Error('The image provider returned no image. Do not automatically retry.');
  signal.throwIfAborted();
  const image = await normalizeGeneratedImage(blob);
  signal.throwIfAborted();
  return image;
}