import * as htmlToImage from 'html-to-image';

export interface PageColorSnapshot {
  canvas: HTMLCanvasElement;
  rect: DOMRect;
}

export async function capturePageColorSnapshot(element: HTMLElement): Promise<PageColorSnapshot> {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) throw new Error('Sampling area is empty.');
  const canvas = await htmlToImage.toCanvas(element, {
    fontEmbedCSS: '',
    filter: node => !(node instanceof Element && node.matches('.cf-eyedropper-status, .cf-eyedropper-loupe')),
    pixelRatio: 1,
    canvasWidth: Math.max(1, Math.round(rect.width)),
    canvasHeight: Math.max(1, Math.round(rect.height)),
    style: { transform: 'none', transformOrigin: 'top left', boxShadow: 'none' }
  });
  return { canvas, rect };
}

export function samplePageColor(snapshot: PageColorSnapshot, clientX: number, clientY: number): [number, number, number, number] | null {
  const { canvas, rect } = snapshot;
  if (clientX < rect.left || clientY < rect.top || clientX >= rect.right || clientY >= rect.bottom) return null;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const x = Math.floor((clientX - rect.left) * canvas.width / rect.width);
  const y = Math.floor((clientY - rect.top) * canvas.height / rect.height);
  try {
    const data = context.getImageData(x, y, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  } catch {
    return null;
  }
}