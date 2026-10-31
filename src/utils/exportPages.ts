import type { ProjectState } from '../types.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { pageNumber, pageProject } from './projectPages.ts';
import { buildProjectSvg } from './svgExport.ts';
import { renderProjectImage } from './renderProjectImage.tsx';

export interface PageExportSettings {
  pixelRatio: 0.5 | 1 | 1.5 | 2;
  format: 'png' | 'jpeg' | 'webp' | 'svg' | 'pptx';
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

export async function exportProjectPages(project: ProjectState, pageIds: string[], settings: PageExportSettings, onProgress?: (done: number, total: number) => void): Promise<{ blob: Blob; filename: string }> {
  const synced = syncProjectPages(project);
  const selected = new Set(pageIds);
  const pages = synced.pages!.filter(page => selected.has(page.id));
  if (!pages.length || pages.length !== selected.size) throw new Error('Select existing pages to export.');
  const title = safeExportName(project.title);
  const extension = settings.format === 'jpeg' ? 'jpg' : settings.format;
  const quality = settings.compression === 'small' ? 0.6 : settings.compression === 'balanced' ? 0.8 : 0.92;
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const pptx = settings.format === 'pptx' ? new (await import('pptxgenjs')).default() : null;
  const slideScale = 13.333333 / Math.max(project.canvasConfig.width, project.canvasConfig.height);
  const slideWidth = project.canvasConfig.width * slideScale;
  const slideHeight = project.canvasConfig.height * slideScale;
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
    const pixelRatio = getExportPixelRatio(page.canvasConfig.width, page.canvasConfig.height, settings);
    const svgMarkup = settings.format === 'pptx' ? buildProjectSvg(target) : null;
    const pptSvg = svgMarkup ? preparePptSvg(svgMarkup, page.canvasConfig.width, page.canvasConfig.height, pixelRatio) : null;
    const blob = settings.format === 'svg'
      ? new Blob([buildProjectSvg(target)], { type: 'image/svg+xml;charset=utf-8' })
      : pptSvg
        ? new Blob([pptSvg], { type: 'image/svg+xml;charset=utf-8' })
        : await renderProjectImage(target, { format: settings.format === 'pptx' ? 'png' : settings.format, pixelRatio, quality });
    if (pptx) {
      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };
      slide.addImage({ data: await toDataUrl(blob), ...containImage(page.canvasConfig.width, page.canvasConfig.height, slideWidth, slideHeight), altText: page.name || pageNumber(synced.pages!.indexOf(page)) });
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