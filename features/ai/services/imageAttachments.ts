import type { ChatImageUpload } from '../types.ts';

export const MAX_IMAGE_EDGE = 600;

export async function encodeWebp(source: Blob | HTMLCanvasElement): Promise<Blob> {
  let bitmap: ImageBitmap | null = null;
  let sourceWidth: number;
  let sourceHeight: number;
  if (source instanceof HTMLCanvasElement) {
    sourceWidth = source.width;
    sourceHeight = source.height;
  } else {
    if (source.size > 25 * 1024 * 1024) throw new Error('Image exceeds the 25 MB source limit.');
    if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot decode uploaded images.');
    bitmap = await createImageBitmap(source);
    sourceWidth = bitmap.width;
    sourceHeight = bitmap.height;
  }
  if (!sourceWidth || !sourceHeight) throw new Error('Image has invalid dimensions.');
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) { bitmap?.close(); throw new Error('Canvas context not available.'); }
  context.drawImage(bitmap || source as HTMLCanvasElement, 0, 0, canvas.width, canvas.height);
  bitmap?.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
  if (!blob || blob.type !== 'image/webp') throw new Error('WebP encoding is not supported by this browser.');
  return blob;
}

export async function createImageUpload(file: File): Promise<ChatImageUpload> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP or GIF image.');
  }
  const blob = await encodeWebp(file);
  return {
    blob,
    image: { id: crypto.randomUUID(), name: file.name.slice(0, 160) || 'image.webp', type: 'image/webp', size: blob.size }
  };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  const type = blob.type || 'image/webp';
  return blob.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return `data:${type};base64,${btoa(binary)}`;
  });
}