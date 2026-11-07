import type { ProjectState } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { syncProjectPages } from '../../../storage/projectCompatibility.ts';
import { deleteProjectPage, insertProjectPage, pageNumber, selectProjectPage } from '../../../utils/projectPages.ts';
import { choice, number, record, text } from './validation.ts';

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
  const action = choice(args.action, 'action', ['list', 'create', 'switch', 'duplicate', 'delete']);
  const allowed = action === 'create' ? ['projectId', 'action', 'name', 'width', 'height'] : action === 'list' ? ['projectId', 'action'] : ['projectId', 'action', 'pageId'];
  if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Unsupported page parameter.');
  const current = bridge.getProject();
  if (!current || current.id !== text(args.projectId, 'projectId')) throw new Error('The active project changed. Read get_context again.');
  const project = syncProjectPages(current);
  if (action === 'list') return { projectId: project.id, ...pageContext(project) };
  let next: ProjectState;
  if (action === 'create') {
    if (args.name !== undefined && (typeof args.name !== 'string' || args.name.length > 100)) throw new Error('Page name must contain at most 100 characters.');
    const width = args.width === undefined ? project.canvasConfig.width : Math.round(number(args.width, 'width', 10, 10000));
    const height = args.height === undefined ? project.canvasConfig.height : Math.round(number(args.height, 'height', 10, 10000));
    next = insertProjectPage(project, (args.name as string | undefined) ?? '', { width, height, ratio: `${width}x${height}` });
  } else {
    const pageId = text(args.pageId, 'pageId');
    if (!project.pages!.some(page => page.id === pageId)) throw new Error('Page not found.');
    if (action === 'switch') next = selectProjectPage(project, pageId);
    else if (action === 'duplicate') next = insertProjectPage(project, '', project.canvasConfig, pageId);
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