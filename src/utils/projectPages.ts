import type { Layer, ProjectPage, ProjectState } from '../types.ts';
import { generateId } from './helpers.ts';
import { MAX_PROJECT_PAGES, readProject, syncProjectPages, writeProject } from '../storage/projectCompatibility.ts';

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

export function insertProjectPage(project: ProjectState, name: string, canvasConfig = project.canvasConfig, duplicateId?: string): ProjectState {
  const synced = syncProjectPages(project);
  if (synced.pages!.length >= MAX_PROJECT_PAGES) throw new Error('A project can contain at most 99 pages.');
  if (!Number.isFinite(canvasConfig.width) || !Number.isFinite(canvasConfig.height) || canvasConfig.width < 10 || canvasConfig.height < 10) throw new Error('Invalid page dimensions.');
  const source = synced.pages!.find(page => page.id === (duplicateId ?? synced.activePageId));
  if (!source) throw new Error('Page not found.');
  const page: ProjectPage = duplicateId ? copyPage(source) : { id: generateId(), name: name.trim(), layers: [], background: { ...source.background }, canvasConfig: { ...canvasConfig } };
  const pages = [...synced.pages!];
  pages.splice(pages.findIndex(item => item.id === source.id) + 1, 0, page);
  return selectProjectPage({ ...synced, pages, updatedAt: Date.now() }, page.id);
}

export function deleteProjectPage(project: ProjectState, pageId: string): ProjectState {
  const synced = syncProjectPages(project);
  if (synced.pages!.length <= 1) throw new Error('The last page cannot be deleted.');
  const index = synced.pages!.findIndex(page => page.id === pageId);
  if (index < 0) throw new Error('Page not found.');
  const pages = synced.pages!.filter(page => page.id !== pageId);
  const activePageId = pageId === synced.activePageId ? pages[Math.min(index, pages.length - 1)].id : synced.activePageId!;
  const active = pages.find(page => page.id === activePageId)!;
  return { ...synced, pages, activePageId, layers: active.layers, background: active.background, canvasConfig: active.canvasConfig, selectedLayerId: null, updatedAt: Date.now() };
}

export function renameProjectPage(project: ProjectState, pageId: string, name: string): ProjectState {
  const synced = syncProjectPages(project);
  if (!synced.pages!.some(page => page.id === pageId)) throw new Error('Page not found.');
  return { ...synced, pages: synced.pages!.map(page => page.id === pageId ? { ...page, name: name.trim() } : page), updatedAt: Date.now() };
}

export function moveProjectPage(project: ProjectState, pageId: string, targetId: string): ProjectState {
  const synced = syncProjectPages(project);
  const pages = [...synced.pages!];
  const from = pages.findIndex(page => page.id === pageId);
  const to = pages.findIndex(page => page.id === targetId);
  if (from < 0 || to < 0) throw new Error('Page not found.');
  if (from === to) return synced;
  pages.splice(to, 0, pages.splice(from, 1)[0]);
  return { ...synced, pages, updatedAt: Date.now() };
}

export function pageProject(project: ProjectState, page: ProjectPage): ProjectState {
  return { ...project, activePageId: page.id, layers: page.layers, background: page.background, canvasConfig: page.canvasConfig, selectedLayerId: null };
}