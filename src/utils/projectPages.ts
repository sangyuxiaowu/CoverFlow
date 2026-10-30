import type { Layer, ProjectPage, ProjectState } from '../types.ts';
import { generateId } from './helpers.ts';
import { readProject, syncProjectPages, writeProject } from '../storage/projectCompatibility.ts';

export const pageNumber = (index: number) => `P${String(index + 1).padStart(2, '0')}`;

export function selectProjectPage(project: ProjectState, pageId: string): ProjectState {
  const synced = syncProjectPages(project);
  const page = synced.pages!.find(item => item.id === pageId);
  if (!page) throw new Error('Page not found.');
  return { ...synced, activePageId: page.id, layers: page.layers, background: page.background, canvasConfig: page.canvasConfig, selectedLayerId: null };
}

export function copyLayers(layers: Layer[]): Layer[] {
  const ids = new Map(layers.map(layer => [layer.id, generateId()]));
  return layers.map(layer => ({ ...structuredClone(layer), id: ids.get(layer.id)!, parentId: layer.parentId ? ids.get(layer.parentId) : undefined, ...(layer.children ? { children: layer.children.map(id => ids.get(id)!).filter(Boolean) } : {}) }));
}

export function copyPage(page: ProjectPage): ProjectPage {
  return { ...structuredClone(page), id: generateId(), layers: copyLayers(page.layers) };
}

export function copyProject(project: ProjectState, title: string): ProjectState {
  const document = writeProject(project);
  return readProject({ ...document, id: generateId(), title, updatedAt: Date.now(), pages: document.pages.map(copyPage) });
}