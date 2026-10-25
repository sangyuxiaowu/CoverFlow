import type { ProjectState } from '../../../types.ts';
import { GOOGLE_FONTS, type ManagedFont } from './fonts.ts';

const stylesheets = new Map<string, Promise<void>>();

export function projectGoogleFonts(project: Pick<ProjectState, 'layers'>): ManagedFont[] {
  const families = new Set(project.layers.filter(layer => layer.type === 'text').map(layer =>
    (layer.fontFamily ?? '').split(',')[0].trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase()));
  return GOOGLE_FONTS.filter(font => families.has(font.family.toLowerCase()));
}

function loadStylesheet(font: ManagedFont): Promise<void> {
  const existing = stylesheets.get(font.family);
  if (existing) return existing;
  const loading = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    const url = new URL('https://fonts.googleapis.com/css2');
    url.searchParams.set('family', `${font.family}:wght@${font.weights!.join(';')}`);
    url.searchParams.set('display', 'swap');
    link.rel = 'stylesheet';
    link.crossOrigin = 'anonymous';
    link.href = url.href;
    link.dataset.coverflowFont = font.family;
    const timer = window.setTimeout(() => finish(new Error(`字体加载超时：${font.family}。请检查 Google Fonts 网络连接。`)), 20000);
    const finish = (error?: Error) => {
      window.clearTimeout(timer);
      link.onload = null;
      link.onerror = null;
      if (error) { link.remove(); reject(error); }
      else resolve();
    };
    link.onload = () => finish();
    link.onerror = () => finish(new Error(`无法加载字体：${font.family}。请检查 Google Fonts 网络连接。`));
    document.head.append(link);
  });
  stylesheets.set(font.family, loading);
  void loading.catch(() => { stylesheets.delete(font.family); });
  return loading;
}

export async function ensureProjectFonts(project: Pick<ProjectState, 'layers'>): Promise<void> {
  const fonts = projectGoogleFonts(project);
  if (!fonts.length) return;
  await Promise.all(fonts.map(loadStylesheet));
  if (!document.fonts?.load) throw new Error('当前环境不支持加载网络字体。');
  await Promise.all(project.layers.filter(layer => layer.type === 'text' && layer.content).map(async layer => {
    const font = projectGoogleFonts({ layers: [layer] })[0];
    if (!font) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        document.fonts.load(`${layer.fontWeight || 400} ${layer.fontSize || 48}px ${JSON.stringify(font.family)}`, layer.content),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`字体文件加载超时：${font.family}`)), 20000); })
      ]);
    } catch (cause) {
      throw new Error(`字体文件加载失败：${font.family}`, { cause });
    } finally { clearTimeout(timer); }
  }));
}