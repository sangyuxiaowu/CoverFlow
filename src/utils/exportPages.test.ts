// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { insertProjectPage } from './projectPages.ts';
import { containImage, exportProjectPages, getExportPixelRatio, preparePptSvg, safeExportName } from './exportPages.ts';
import { buildHtmlExport, buildHtmlSvg } from './htmlExport.ts';
import { projectFontEmbedCSS } from '../features/ai/services/fontLoading.ts';

vi.mock('../features/ai/services/fontLoading.ts', () => ({ projectFontEmbedCSS: vi.fn(async () => '') }));

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

it('exports selected SVG pages in one standalone HTML with playback and print pagination', async () => {
  const target = project();
  target.title = '</title><script>alert(1)</script>';
  const progress = vi.fn();
  const result = await exportProjectPages(target, target.pages!.map(page => page.id).reverse(), { format: 'html', pixelRatio: 2, compression: 'lossless', pptResolution: 'hd' }, progress);
  expect(result.filename.endsWith('.html')).toBe(true);
  expect(result.blob.type).toBe('text/html;charset=utf-8');
  const html = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(result.blob);
  });
  const document = new DOMParser().parseFromString(html, 'text/html');
  expect(document.title).toBe(target.title);
  expect(document.querySelectorAll('script')).toHaveLength(1);
  const images = Array.from(document.querySelectorAll('main img'));
  expect(images).toHaveLength(2);
  expect(decodeURIComponent(images[0].getAttribute('src')!)).toContain('width="900"');
  expect(decodeURIComponent(images[1].getAttribute('src')!)).toContain('width="500"');
  expect(document.querySelectorAll('section[hidden]')).toHaveLength(1);
  expect(document.querySelector('#play')).not.toBeNull();
  expect(document.querySelector('#print')).not.toBeNull();
  expect(document.querySelectorAll('script[src],link[href],img[src^="http"]')).toHaveLength(0);
  expect(html).toContain('@page sheet0{size:900px 383px;margin:0}');
  expect(html).toContain('break-after:page');
  expect(progress).toHaveBeenLastCalledWith(2, 2);
});

it('embeds remote images and font CSS into SVG and fails on unavailable images', async () => {
  const target = project();
  target.background = { ...target.background, type: 'image', value: 'https://example.com/image.png' };
  const fetchImage = vi.fn(async () => new Response('image-data', { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetchImage);
  vi.mocked(projectFontEmbedCSS).mockResolvedValueOnce('@font-face{font-family:Test;src:url(data:font/woff2;base64,AAAA)}');
  try {
    const svg = await buildHtmlSvg(target);
    expect(svg).toContain('@font-face');
    expect(svg).toContain('data:image/png;base64,');
    expect(svg).not.toContain('https://example.com');
    expect(fetchImage).toHaveBeenCalledOnce();
    fetchImage.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(buildHtmlSvg(target)).rejects.toThrow('Image download failed');
  } finally { vi.unstubAllGlobals(); }
});

it('supports a single-page English HTML and disables playback at runtime', () => {
  const html = buildHtmlExport('Single', [{ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', name: '<Page>', width: 800, height: 600 }], 'en');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  expect(parsed.documentElement.lang).toBe('en');
  expect(parsed.querySelector('section')?.getAttribute('aria-label')).toBe('<Page>');
  expect(parsed.querySelector('#play')?.getAttribute('aria-label')).toBe('Play');
  expect(parsed.querySelectorAll('main img')).toHaveLength(1);
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const playerDocument = frame.contentDocument!;
  playerDocument.body.innerHTML = parsed.body.innerHTML;
  try {
    new Function('document', 'window', parsed.querySelector('script')!.textContent!)(playerDocument, frame.contentWindow);
    expect(playerDocument.querySelector<HTMLOutputElement>('#counter')?.value).toBe('1 / 1');
    for (const id of ['previous', 'next', 'play', 'interval']) expect(playerDocument.querySelector<HTMLButtonElement>(`#${id}`)?.disabled).toBe(true);
  } finally { frame.remove(); }
});

it('reveals floating controls on activity, hides after leaving, and plays SVG pages in a loop', () => {
  vi.useFakeTimers();
  const html = buildHtmlExport('Playback', [0, 1].map(index => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', name: String(index), width: 800, height: 600 })));
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const player = frame.contentDocument!;
  player.body.innerHTML = parsed.body.innerHTML;
  try {
    new Function('document', 'window', parsed.querySelector('script')!.textContent!)(player, frame.contentWindow);
    expect(player.body.classList.contains('controls-visible')).toBe(false);
    player.dispatchEvent(new Event('pointermove'));
    expect(player.body.classList.contains('controls-visible')).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(player.body.classList.contains('controls-visible')).toBe(false);
    player.dispatchEvent(new Event('pointermove'));
    player.querySelector('nav')!.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(3000);
    expect(player.body.classList.contains('controls-visible')).toBe(true);
    player.querySelector('nav')!.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(1600);
    expect(player.body.classList.contains('controls-visible')).toBe(false);
    const play = player.querySelector<HTMLButtonElement>('#play')!;
    play.click();
    expect(play.getAttribute('aria-pressed')).toBe('true');
    vi.advanceTimersByTime(5000);
    expect(player.querySelector('#counter')?.textContent).toBe('2 / 2');
    vi.advanceTimersByTime(5000);
    expect(player.querySelector('#counter')?.textContent).toBe('1 / 2');
    play.click();
    vi.advanceTimersByTime(5000);
    expect(player.querySelector('#counter')?.textContent).toBe('1 / 2');
    expect(play.getAttribute('aria-pressed')).toBe('false');
    player.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(player.querySelector('#counter')?.textContent).toBe('2 / 2');
    expect(player.body.classList.contains('controls-visible')).toBe(false);
    player.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(player.querySelector('#counter')?.textContent).toBe('1 / 2');
    expect(player.body.classList.contains('controls-visible')).toBe(false);
    player.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(player.querySelector('#counter')?.textContent).toBe('2 / 2');
    expect(player.body.classList.contains('controls-visible')).toBe(false);
    player.dispatchEvent(new Event('pointermove'));
    expect(player.body.classList.contains('controls-visible')).toBe(true);
    player.querySelector<HTMLButtonElement>('#previous')!.click();
    expect(player.querySelector('#counter')?.textContent).toBe('1 / 2');
    expect(player.body.classList.contains('controls-visible')).toBe(false);
    player.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(player.body.classList.contains('controls-visible')).toBe(true);
  } finally { frame.remove(); vi.useRealTimers(); }
});