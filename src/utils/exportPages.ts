import type { ProjectPage, ProjectState } from '../types.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { leaseImageAssets } from '../storage/imageAssets.ts';
import { pageNumber, pageProject } from './projectPages.ts';
import { buildEmbeddedProjectSvg } from './svgExport.ts';
import { renderProjectImage } from './renderProjectImage.tsx';
import { buildHtmlExport, buildHtmlSvg } from './htmlExport.ts';

export interface PageExportSettings {
  pixelRatio: 0.5 | 1 | 1.5 | 2;
  format: 'png' | 'jpeg' | 'webp' | 'svg' | 'pptx' | 'html';
  compression: 'lossless' | 'balanced' | 'small';
  pptResolution: 'standard' | 'hd' | '4k';
}

export const safeExportName = (name: string) => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'CoverFlow';

export function containImage(width: number, height: number, containerWidth: number, containerHeight: number) {
  const scale = Math.min(containerWidth / width, containerHeight / height);
  const outputWidth = width * scale;
  const outputHeight = height * scale;
  return { x: (containerWidth - outputWidth) / 2, y: (containerHeight - outputHeight) / 2, w: outputWidth, h: outputHeight };
}

export function getExportPixelRatio(width: number, height: number, settings: PageExportSettings) {
  if (settings.format !== 'pptx') return settings.pixelRatio;
  if (settings.pptResolution === 'standard') return 1;
  const targetEdge = settings.pptResolution === '4k' ? 3840 : 1920;
  return Math.max(1, targetEdge / Math.max(width, height));
}

export function preparePptSvg(svgMarkup: string, width: number, height: number, pixelRatio: number) {
  const document = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg' || document.querySelector('parsererror') || root.querySelector('foreignObject')) return null;
  root.setAttribute('width', String(Math.round(width * pixelRatio)));
  root.setAttribute('height', String(Math.round(height * pixelRatio)));
  return new XMLSerializer().serializeToString(root);
}

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error('Unable to read rendered page.'));
  reader.readAsDataURL(blob);
});

export async function exportProjectPages(project: ProjectState, pageIds: string[], settings: PageExportSettings, onProgress?: (done: number, total: number) => void, language = 'zh'): Promise<{ blob: Blob; filename: string }> {
  const synced = syncProjectPages(project);
  const selected = new Set(pageIds);
  const pages = synced.pages!.filter(page => selected.has(page.id));
  if (!pages.length || pages.length !== selected.size) throw new Error('Select existing pages to export.');
  const release = leaseImageAssets(pages);
  try { return await exportSelectedProjectPages(synced, pages, settings, onProgress, language); }
  finally { release(); }
}

async function exportSelectedProjectPages(project: ProjectState, pages: ProjectPage[], settings: PageExportSettings, onProgress?: (done: number, total: number) => void, language = 'zh'): Promise<{ blob: Blob; filename: string }> {
  const synced = project;
  const title = safeExportName(project.title);
  if (settings.format === 'html') {
    onProgress?.(0, pages.length);
    const slides = [];
    for (const [index, page] of pages.entries()) {
      const svg = await buildHtmlSvg(pageProject(synced, page));
      onProgress?.(index + 1, pages.length);
      slides.push({ svg, name: page.name || pageNumber(synced.pages!.indexOf(page)), notes: page.notes, width: page.pageInfo.width, height: page.pageInfo.height });
    }
    return { blob: new Blob([buildHtmlExport(project.title, slides, language)], { type: 'text/html;charset=utf-8' }), filename: `${title}.html` };
  }
  const extension = settings.format === 'jpeg' ? 'jpg' : settings.format;
  const quality = settings.compression === 'small' ? 0.6 : settings.compression === 'balanced' ? 0.8 : 0.92;
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const pptx = settings.format === 'pptx' ? new (await import('pptxgenjs')).default() : null;
  const slideScale = 13.333333 / Math.max(project.pageInfo.width, project.pageInfo.height);
  const slideWidth = project.pageInfo.width * slideScale;
  const slideHeight = project.pageInfo.height * slideScale;
  if (pptx) {
    pptx.defineLayout({ name: 'COVERFLOW', width: slideWidth, height: slideHeight });
    pptx.layout = 'COVERFLOW';
    pptx.title = project.title;
    pptx.author = 'CoverFlow';
  }
  onProgress?.(0, pages.length);
  let single: Blob | undefined;
  for (const [index, page] of pages.entries()) {
    const target = pageProject(synced, page);
    const pixelRatio = getExportPixelRatio(page.pageInfo.width, page.pageInfo.height, settings);
    const svgMarkup = settings.format === 'pptx' || settings.format === 'svg' ? await buildEmbeddedProjectSvg(target) : null;
    const pptSvg = svgMarkup ? preparePptSvg(svgMarkup, page.pageInfo.width, page.pageInfo.height, pixelRatio) : null;
    const blob = settings.format === 'svg'
      ? new Blob([svgMarkup!], { type: 'image/svg+xml;charset=utf-8' })
      : pptSvg
        ? new Blob([pptSvg], { type: 'image/svg+xml;charset=utf-8' })
        : await renderProjectImage(target, { format: settings.format === 'pptx' ? 'png' : settings.format, pixelRatio, quality });
    if (pptx) {
      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };
      slide.addImage({ data: await toDataUrl(blob), ...containImage(page.pageInfo.width, page.pageInfo.height, slideWidth, slideHeight), altText: page.name || pageNumber(synced.pages!.indexOf(page)) });
      if (page.notes) slide.addNotes(page.notes);
    } else if (pages.length === 1) single = blob;
    else zip.file(`${pageNumber(synced.pages!.indexOf(page))}${page.name ? `-${safeExportName(page.name)}` : ''}.${extension}`, await blob.arrayBuffer());
    onProgress?.(index + 1, pages.length);
  }
  if (pptx) {
    const blob = await pptx.write({ outputType: 'blob', compression: true });
    if (!(blob instanceof Blob)) throw new Error('PPT export did not produce a file.');
    return { blob, filename: `${title}.pptx` };
  }
  if (single) return { blob: single, filename: `${title}.${extension}` };
  return { blob: await zip.generateAsync({ type: 'blob' }), filename: `${title}.zip` };
}