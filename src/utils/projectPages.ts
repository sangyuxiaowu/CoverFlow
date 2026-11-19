import type { Layer, ProjectPage, ProjectState } from '../types.ts';
import { generateId } from './helpers.ts';
import { MAX_PROJECT_PAGES, readProject, syncProjectPages, writeProject } from '../storage/projectCompatibility.ts';
import { clonePlainData } from './clonePlainData.ts';

export const pageNumber = (index: number) => `P${String(index + 1).padStart(2, '0')}`;

export function selectProjectPage(project: ProjectState, pageId: string): ProjectState {
  const synced = syncProjectPages(project);
  const page = synced.pages!.find(item => item.id === pageId);
  if (!page) throw new Error('Page not found.');
  return { ...synced, activePageId: page.id, layers: page.layers, pageInfo: page.pageInfo, selectedLayerId: null };
}

export function copyLayers(layers: Layer[]): Layer[] {
  const ids = new Map(layers.map(layer => [layer.id, generateId()]));
  return layers.map(layer => ({ ...clonePlainData(layer), id: ids.get(layer.id)!, parentId: layer.parentId ? ids.get(layer.parentId) : undefined, ...(layer.children ? { children: layer.children.map(id => ids.get(id)!).filter(Boolean) } : {}) }));
}

export function copyPage(page: ProjectPage): ProjectPage {
  return { ...page, id: generateId(), layers: copyLayers(page.layers), pageInfo: { ...page.pageInfo, background: { ...page.pageInfo.background } } };
}

export function copyProject(project: ProjectState, title: string): ProjectState {
  const document = writeProject(project);
  return readProject({ ...document, id: generateId(), title, updatedAt: Date.now(), pages: document.pages.map(copyPage) });
}

export function insertProjectPage(project: ProjectState, name: string, canvasConfig: Pick<ProjectPage['pageInfo'], 'width' | 'height'> = project.pageInfo, duplicateId?: string): ProjectState {
  const synced = syncProjectPages(project);
  if (synced.pages!.length >= MAX_PROJECT_PAGES) throw new Error('A project can contain at most 99 pages.');
  if (!Number.isFinite(canvasConfig.width) || !Number.isFinite(canvasConfig.height) || canvasConfig.width < 10 || canvasConfig.height < 10) throw new Error('Invalid page dimensions.');
  const source = synced.pages!.find(page => page.id === (duplicateId ?? synced.activePageId));
  if (!source) throw new Error('Page not found.');
  const page: ProjectPage = duplicateId ? copyPage(source) : { id: generateId(), name: name.trim(), layers: [], pageInfo: { ...({ ...canvasConfig }), background: { ...source.pageInfo.background } } };
  const pages = [...synced.pages!];
  pages.splice(pages.findIndex(item => item.id === source.id) + 1, 0, page);
  return selectProjectPage({ ...synced, pages, updatedAt: Date.now() }, page.id);
}

export function insertProjectPages(project: ProjectState, name: string, canvasConfig: Pick<ProjectPage['pageInfo'], 'width' | 'height'>, background: ProjectPage['pageInfo']['background'], count: number, targetId: string): ProjectState {
  const synced = syncProjectPages(project);
  if (!synced.pages!.length || synced.pages!.length + count > MAX_PROJECT_PAGES) throw new Error('A project can contain at most 99 pages.');
  if (!Number.isFinite(canvasConfig.width) || !Number.isFinite(canvasConfig.height) || canvasConfig.width < 10 || canvasConfig.height < 10) throw new Error('Invalid page dimensions.');
  const targetIndex = synced.pages!.findIndex(page => page.id === targetId);
  if (targetIndex < 0) throw new Error('Page not found.');
  const pages = [...synced.pages!];
  let firstId = '';
  for (let index = 0; index < count; index += 1) {
    const page: ProjectPage = { id: generateId(), name: name.trim(), layers: [], pageInfo: { ...({ ...canvasConfig }), background: { ...background } } };
    pages.splice(targetIndex + 1 + index, 0, page);
    if (!firstId) firstId = page.id;
  }
  return selectProjectPage({ ...synced, pages, updatedAt: Date.now() }, firstId);
}

export function duplicateProjectPages(project: ProjectState, pageId: string, count: number): ProjectState {
  const synced = syncProjectPages(project);
  if (synced.pages!.length + count > MAX_PROJECT_PAGES) throw new Error('A project can contain at most 99 pages.');
  const source = synced.pages!.find(page => page.id === pageId);
  if (!source) throw new Error('Page not found.');
  const activeIndex = synced.pages!.findIndex(page => page.id === synced.activePageId);
  if (activeIndex < 0) throw new Error('Page not found.');
  const pages = [...synced.pages!];
  const copies = Array.from({ length: count }, () => copyPage(source));
  pages.splice(activeIndex + 1, 0, ...copies);
  return selectProjectPage({ ...synced, pages, updatedAt: Date.now() }, copies[0].id);
}

export function moveProjectPageAfter(project: ProjectState, pageId: string, targetId: string): ProjectState {
  const synced = syncProjectPages(project);
  const from = synced.pages!.findIndex(page => page.id === pageId);
  const target = synced.pages!.findIndex(page => page.id === targetId);
  if (from < 0 || target < 0) throw new Error('Page not found.');
  if (from === target) return synced;
  const pages = [...synced.pages!];
  const [moved] = pages.splice(from, 1);
  const adjustedTarget = pages.findIndex(page => page.id === targetId);
  pages.splice(adjustedTarget + 1, 0, moved);
  return { ...synced, pages, updatedAt: Date.now() };
}

export function deleteProjectPage(project: ProjectState, pageId: string): ProjectState {
  const synced = syncProjectPages(project);
  if (synced.pages!.length <= 1) throw new Error('The last page cannot be deleted.');
  const index = synced.pages!.findIndex(page => page.id === pageId);
  if (index < 0) throw new Error('Page not found.');
  const pages = synced.pages!.filter(page => page.id !== pageId);
  const activePageId = pageId === synced.activePageId ? pages[Math.min(index, pages.length - 1)].id : synced.activePageId!;
  const active = pages.find(page => page.id === activePageId)!;
  return { ...synced, pages, activePageId, layers: active.layers, pageInfo: active.pageInfo, selectedLayerId: null, updatedAt: Date.now() };
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
  return { ...project, activePageId: page.id, layers: page.layers, pageInfo: page.pageInfo, selectedLayerId: null };
}