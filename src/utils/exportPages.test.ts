// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { insertProjectPage } from './projectPages.ts';
import { containImage, exportProjectPages, getExportPixelRatio, preparePptSvg, safeExportName } from './exportPages.ts';

vi.mock('./renderProjectImage.tsx', () => ({ renderProjectImage: vi.fn(async () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1cAAAAASUVORK5CYII='), character => character.charCodeAt(0))], { type: 'image/png' })) }));

const project = () => insertProjectPage(syncProjectPages({ id: 'export', title: 'Article', updatedAt: 1, selectedLayerId: null, layers: [], canvasConfig: { width: 900, height: 383, ratio: '2.35:1' }, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } }), 'Detail', { width: 500, height: 500, ratio: '1:1' });

it('uses page order rather than checkbox order when creating the archive', async () => {
  const target = project();
  const progress = vi.fn();
  const result = await exportProjectPages(target, target.pages!.map(page => page.id).reverse(), { format: 'svg', pixelRatio: 1, compression: 'lossless', pptResolution: 'hd' }, progress);
  expect(result.filename).toBe('Article.zip');
  const archive = await JSZip.loadAsync(await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(result.blob);
  }));
  expect(Object.keys(archive.files)).toEqual(['P01.svg', 'P02-Detail.svg']);
  expect(await archive.file('P01.svg')!.async('string')).toContain('width="900"');
  expect(await archive.file('P02-Detail.svg')!.async('string')).toContain('width="500"');
  expect(progress).toHaveBeenLastCalledWith(2, 2);
});

it('exports a single file and rejects empty or unknown selections', async () => {
  const target = project();
  const settings = { format: 'svg', pixelRatio: 1, compression: 'lossless', pptResolution: 'hd' } as const;
  const result = await exportProjectPages(target, [target.activePageId!], settings);
  expect(result.filename).toBe('Article.svg');
  expect(result.blob.type).toContain('image/svg+xml');
  await expect(exportProjectPages(target, [], settings)).rejects.toThrow('Select');
  await expect(exportProjectPages(target, ['missing'], settings)).rejects.toThrow('Select');
});

it('contains mixed aspect ratios without stretching and sanitizes filenames', () => {
  expect(containImage(500, 500, 16, 9)).toEqual({ x: 3.5, y: 0, w: 9, h: 9 });
  expect(containImage(1600, 900, 16, 9)).toEqual({ x: 0, y: 0, w: 16, h: 9 });
  expect(safeExportName('Article: a/b?')).toBe('Article_ a_b_');
});

it('computes PPT raster sizes without downscaling wide and portrait canvases', () => {
  const settings = { format: 'pptx', pixelRatio: 1, compression: 'lossless', pptResolution: 'hd' } as const;
  expect(getExportPixelRatio(900, 383, settings)).toBe(1920 / 900);
  expect(getExportPixelRatio(500, 900, settings)).toBe(1920 / 900);
  expect(getExportPixelRatio(2400, 1200, settings)).toBe(1);
  expect(getExportPixelRatio(900, 383, { ...settings, pptResolution: 'standard' })).toBe(1);
  expect(getExportPixelRatio(900, 383, { ...settings, pptResolution: '4k' })).toBe(3840 / 900);
});

it('prepares Office-compatible SVG with a high-resolution raster fallback size', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="383" viewBox="0 0 900 383"><rect width="900" height="383" /></svg>';
  const prepared = preparePptSvg(svg, 900, 383, 1920 / 900);
  const document = new DOMParser().parseFromString(prepared!, 'image/svg+xml');
  expect(document.documentElement.getAttribute('width')).toBe('1920');
  expect(document.documentElement.getAttribute('height')).toBe('817');
  expect(document.documentElement.getAttribute('viewBox')).toBe('0 0 900 383');
  expect(preparePptSvg('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject /></svg>', 900, 383, 1)).toBeNull();
});

it('creates an actual image-based PPTX with one image per slide and a uniform aspect ratio', async () => {
  const target = project();
  const result = await exportProjectPages(target, target.pages!.map(page => page.id), { format: 'pptx', pixelRatio: 1, compression: 'lossless', pptResolution: 'hd' });
  expect(result.filename).toBe('Article.pptx');
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(result.blob);
  });
  const archive = await JSZip.loadAsync(bytes);
  expect(Object.keys(archive.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(2);
  expect(Object.keys(archive.files).filter(name => /^ppt\/media\/.*\.png$/.test(name))).toHaveLength(2);
  expect(Object.keys(archive.files).filter(name => /^ppt\/media\/.*\.svg$/.test(name))).toHaveLength(2);
  const presentation = new DOMParser().parseFromString(await archive.file('ppt/presentation.xml')!.async('string'), 'application/xml');
  const size = presentation.getElementsByTagName('p:sldSz')[0];
  expect(size.getAttribute('cx')).toBe(size.getAttribute('cy'));
  const first = new DOMParser().parseFromString(await archive.file('ppt/slides/slide1.xml')!.async('string'), 'application/xml');
  const picture = first.getElementsByTagName('p:pic')[0];
  expect(Number(picture.getElementsByTagName('a:off')[0].getAttribute('y'))).toBeGreaterThan(0);
  expect(first.getElementsByTagName('p:sp')).toHaveLength(0);
});