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
    pages: synced.pages!.map((page, index) => ({ id: page.id, number: pageNumber(index), name: page.name, canvas: page.canvasConfig, layerCount: page.layers.length, active: page.id === synced.activePageId }))
  };
}

export async function executePageTool(input: unknown, bridge: WorkspaceBridge, signal: AbortSignal) {
  signal.throwIfAborted();
  const args = record(input);
  const action = choice(args.action, 'action', ['list', 'create', 'switch', 'duplicate', 'move', 'delete']);
  const allowed = action === 'create' ? ['action', 'count', 'pageInfo'] : action === 'duplicate' ? ['action', 'count', 'pageId'] : action === 'list' ? ['action'] : ['action', 'pageId'];
  if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Unsupported page parameter.');
  const current = bridge.getProject();
  if (!current) throw new Error('No project open.');
  const project = syncProjectPages(current);
  if (action === 'list') return { projectId: project.id, ...pageContext(project) };
  let next: ProjectState;
  if (action === 'create') {
    const count = args.count === undefined ? 1 : number(args.count, 'count', 1, 99);
    if (!Number.isInteger(count)) throw new Error('Invalid count');
    const pageInfo = args.pageInfo === undefined ? {} : record(args.pageInfo);
    if (Object.keys(pageInfo).some(field => !['name', 'width', 'height', 'background'].includes(field))) throw new Error('Unsupported pageInfo parameter.');
    if (pageInfo.name !== undefined && (typeof pageInfo.name !== 'string' || pageInfo.name.length > 100)) throw new Error('Page name must contain at most 100 characters.');
    const name = pageInfo.name === undefined ? '' : pageInfo.name as string;
    const width = pageInfo.width === undefined ? project.canvasConfig.width : Math.round(number(pageInfo.width, 'width', 10, 10000));
    const height = pageInfo.height === undefined ? project.canvasConfig.height : Math.round(number(pageInfo.height, 'height', 10, 10000));
    const backgroundUpdates = pageInfo.background === undefined ? {} : backgroundPatch(pageInfo.background);
    const background = { ...project.background, ...backgroundUpdates };
    if (background.type === 'css' && ['overlayType', 'overlayColor', 'overlayOpacity', 'overlayScale'].some(field => field in backgroundUpdates)) throw new Error('Overlay textures are not supported with CSS backgrounds.');
    if (background.type === 'image') safeImage(background.value);
    if (background.type === 'css') {
      const result = sanitizeBackgroundCss(background.value);
      if (result.issues.length) throw new Error(result.issues.join('; '));
    }
    if (background.type !== 'image' && /url\s*\(/i.test(background.value)) throw new Error('Use an image background for image URLs.');
    next = insertProjectPages(project, name, { width, height, ratio: `${width}x${height}` }, background, count);
  } else {
    const pageId = text(args.pageId, 'pageId');
    if (!project.pages!.some(page => page.id === pageId)) throw new Error('Page not found.');
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