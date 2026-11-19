import type { ProjectState } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { syncProjectPages } from '../../../storage/projectCompatibility.ts';
import { deleteProjectPage, duplicateProjectPages, insertProjectPages, moveProjectPageAfter, pageNumber, selectProjectPage } from '../../../utils/projectPages.ts';
import { backgroundPatch, choice, number, record, safeImage, text } from './validation.ts';
import { sanitizeBackgroundCss } from '../../../utils/customContent.ts';

export function pageContext(project: ProjectState) {
  const synced = syncProjectPages(project);
  return {
    pageId: synced.activePageId,
    pageCount: synced.pages!.length,
    pages: synced.pages!.map((page, index) => ({ id: page.id, number: pageNumber(index), name: page.name, canvas: `${page.pageInfo.width}x${page.pageInfo.height}`, layerCount: page.layers.length, active: page.id === synced.activePageId }))
  };
}

export async function executePageTool(input: unknown, bridge: WorkspaceBridge, signal: AbortSignal) {
  signal.throwIfAborted();
  const args = record(input);
  const action = choice(args.action, 'action', ['list', 'create', 'switch', 'duplicate', 'move', 'delete', 'update']);
  const allowed = action === 'create' ? ['action', 'count', 'pageId', 'name', 'pageInfo'] : action === 'update' ? ['action', 'pageId', 'name', 'pageInfo'] : action === 'duplicate' ? ['action', 'count', 'pageId'] : action === 'list' ? ['action'] : ['action', 'pageId'];
  if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Unsupported page parameter.');
  const current = bridge.getProject();
  if (!current) throw new Error('No project open.');
  const project = syncProjectPages(current);
  if (action === 'list') return { projectId: project.id, ...pageContext(project) };
  const pageId = text(args.pageId, 'pageId');
  const target = project.pages!.find(page => page.id === pageId);
  if (!target) throw new Error('Page not found.');
  let next: ProjectState;
  if (action === 'create' || action === 'update') {
    const pageInfo = args.pageInfo === undefined ? {} : record(args.pageInfo);
    if (args.pageInfo !== undefined && !Object.keys(pageInfo).length) throw new Error('pageInfo must contain at least one field.');
    if (action === 'update' && args.name === undefined && args.pageInfo === undefined) throw new Error('Provide name or pageInfo to update.');
    if (Object.keys(pageInfo).some(field => !['width', 'height', 'background'].includes(field))) throw new Error('Unsupported pageInfo parameter.');
    if (args.name !== undefined && (typeof args.name !== 'string' || args.name.length > 100)) throw new Error('Page name must contain at most 100 characters.');
    const source = action === 'create' ? project.pages!.find(page => page.id === project.activePageId)! : target;
    const name = args.name === undefined || (action === 'create' && !(args.name as string).trim()) ? source.name : (args.name as string).trim();
    const width = pageInfo.width === undefined ? source.pageInfo.width : number(pageInfo.width, 'width', 10, 10000);
    const height = pageInfo.height === undefined ? source.pageInfo.height : number(pageInfo.height, 'height', 10, 10000);
    const backgroundUpdates = pageInfo.background === undefined ? {} : backgroundPatch(pageInfo.background);
    const background = { ...source.pageInfo.background, ...backgroundUpdates };
    if (background.type === 'css' && ['overlayType', 'overlayColor', 'overlayOpacity', 'overlayScale'].some(field => field in backgroundUpdates)) throw new Error('Overlay textures are not supported with CSS backgrounds.');
    if (background.type === 'image') safeImage(background.value);
    if (background.type === 'css') {
      const result = sanitizeBackgroundCss(background.value);
      if (result.issues.length) throw new Error(result.issues.join('; '));
    }
    if (background.type !== 'image' && /url\s*\(/i.test(background.value)) throw new Error('Use an image background for image URLs.');
    const nextPageInfo = { width, height, background };
    if (action === 'create') {
      const count = args.count === undefined ? 1 : number(args.count, 'count', 1, 99);
      if (!Number.isInteger(count)) throw new Error('Invalid count');
      next = insertProjectPages(project, name, nextPageInfo, background, count, pageId);
    } else {
      const pages = project.pages!.map(page => page.id === pageId ? { ...page, name, pageInfo: nextPageInfo } : page);
      next = { ...project, pages, updatedAt: Date.now(), ...(pageId === project.activePageId ? { pageInfo: nextPageInfo } : {}) };
    }
  } else {
    if (action === 'switch') next = selectProjectPage(project, pageId);
    else if (action === 'duplicate') {
      const count = args.count === undefined ? 1 : number(args.count, 'count', 1, 99);
      if (!Number.isInteger(count)) throw new Error('Invalid count');
      next = duplicateProjectPages(project, pageId, count);
    } else if (action === 'move') next = moveProjectPageAfter(project, pageId, project.activePageId!);
    else {
      if (project.pages!.length === 1) throw new Error('The last page cannot be deleted.');
      const page = project.pages!.find(item => item.id === pageId)!;
      const index = project.pages!.indexOf(page);
      if (!bridge.confirm || !await bridge.confirm(`删除页面「${pageNumber(index)}${page.name ? ` ${page.name}` : ''}」及其全部图层？`, signal)) throw new Error('User cancelled page deletion.');
      signal.throwIfAborted();
      if (bridge.getProject() !== current) throw new Error('The project changed while confirming deletion. Read get_context again.');
      next = deleteProjectPage(project, pageId);
    }
  }
  signal.throwIfAborted();
  await bridge.commit(next);
  return { success: true, projectId: next.id, ...pageContext(next) };
}