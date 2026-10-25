// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { Layer, ProjectState } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';

const layer = (fontFamily: string): Layer => ({ id: 'text', type: 'text', name: 'Title', content: '中文标题', fontFamily, fontWeight: 400, x: 0, y: 0, width: 300, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 });
afterEach(() => { document.head.querySelectorAll('[data-coverflow-font]').forEach(link => link.remove()); vi.restoreAllMocks(); vi.resetModules(); });

it('loads only exact curated families, deduplicates CSS and waits for the actual text glyphs', async () => {
  const load = vi.fn().mockResolvedValue([{}]);
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
  const { ensureProjectFonts, projectGoogleFonts } = await import('./fontLoading.ts');
  expect(projectGoogleFonts({ layers: [layer('"Noto Sans SC", sans-serif'), layer('Noto Sans SC Extra'), layer('Arial')] }).map(font => font.family)).toEqual(['Noto Sans SC']);
  const project = { layers: [layer('"ZCOOL KuaiLe", sans-serif')] };
  const first = ensureProjectFonts(project);
  const second = ensureProjectFonts(project);
  const links = document.head.querySelectorAll<HTMLLinkElement>('[data-coverflow-font]');
  expect(links).toHaveLength(1);
  const url = new URL(links[0].href);
  expect(url.hostname).toBe('fonts.googleapis.com');
  expect(url.searchParams.get('family')).toBe('ZCOOL KuaiLe:wght@400');
  expect(url.searchParams.has('text')).toBe(false);
  links[0].dispatchEvent(new Event('load'));
  await Promise.all([first, second]);
  expect(load).toHaveBeenCalledWith('400 48px "ZCOOL KuaiLe"', '中文标题');
  await ensureProjectFonts({ layers: [layer('Arial')] });
  expect(document.head.querySelectorAll('[data-coverflow-font]')).toHaveLength(1);
});

it('reports download errors and permits retry without retaining a failed stylesheet', async () => {
  const { ensureProjectFonts } = await import('./fontLoading.ts');
  const project = { layers: [layer('"Ma Shan Zheng", cursive')] };
  const pending = ensureProjectFonts(project);
  const rejected = expect(pending).rejects.toThrow('无法加载字体');
  document.head.querySelector('[data-coverflow-font]')!.dispatchEvent(new Event('error'));
  await rejected;
  expect(document.head.querySelector('[data-coverflow-font]')).toBeNull();
  const retry = ensureProjectFonts(project);
  const failed = expect(retry).rejects.toThrow('无法加载字体');
  expect(document.head.querySelectorAll('[data-coverflow-font]')).toHaveLength(1);
  document.head.querySelector('[data-coverflow-font]')!.dispatchEvent(new Event('error'));
  await failed;
});

it.each(['changed', 'aborted'])('does not commit an AI layer after font loading when the project is %s', async reason => {
  const { executeTool } = await import('../tools/execute.ts');
  const original: ProjectState = { id: 'p1', title: 'Test', layers: [], selectedLayerId: null, updatedAt: 0,
    canvasConfig: { width: 800, height: 600, ratio: '4:3' },
    background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } };
  let current = original;
  const commit = vi.fn();
  const bridge: WorkspaceBridge = { getProject: () => current, getSelection: () => [], commit, manageProjects: async () => {} };
  const controller = new AbortController();
  const pending = executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { text: { content: '中文', fontFamily: '"Ma Shan Zheng", cursive', fontWeight: 400 } } }, bridge, controller.signal);
  const rejected = expect(pending).rejects.toThrow(reason === 'changed' ? 'active project changed' : /abort/i);
  if (reason === 'changed') current = { ...original, id: 'p2' };
  else controller.abort();
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load: vi.fn().mockResolvedValue([{}]) } });
  document.head.querySelector('[data-coverflow-font]')!.dispatchEvent(new Event('load'));
  await rejected;
  expect(commit).not.toHaveBeenCalled();
});