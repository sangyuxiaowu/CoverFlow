import type { Layer, ProjectState } from '../types.ts';
import { detectDecorationFormat } from './customContent.ts';

export function resolveDynamicFields(layer: Layer, project: Pick<ProjectState, 'pages' | 'activePageId'>): string {
  if (layer.type !== 'text' && (layer.type !== 'decoration' || detectDecorationFormat(layer.content) !== 'html')) return layer.content;
  const pages = project.pages ?? [];
  const pageIndex = Math.max(0, pages.findIndex(page => page.id === project.activePageId)) + 1;
  const totalPages = Math.max(1, pages.length);
  return layer.content.replace(/\{\{(PAGE_INDEX|TOTAL_PAGES)\}\}/g, (_, field: string) => String(field === 'PAGE_INDEX' ? pageIndex : totalPages));
}

export function pageDynamicFieldsKey(project: Pick<ProjectState, 'pages'>, page: { id: string; layers: Layer[] }): string {
  if (!page.layers.some(layer => (layer.type === 'text' || (layer.type === 'decoration' && detectDecorationFormat(layer.content) === 'html')) && /\{\{(?:PAGE_INDEX|TOTAL_PAGES)\}\}/.test(layer.content))) return '';
  return `${(project.pages ?? []).findIndex(item => item.id === page.id) + 1}/${project.pages?.length ?? 1}`;
}