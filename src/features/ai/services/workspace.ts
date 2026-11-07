import type { ProjectState } from '../../../types.ts';
import type { StorageAdapter } from '../../../storage/StorageAdapter.ts';
import type { WorkspaceBridge } from '../types.ts';
import { parseManageProjectsRequest } from '../tools/requests.ts';
import { generateId } from '../../../utils/helpers.ts';
import { syncProjectPages } from '../../../storage/projectCompatibility.ts';
import { copyProject } from '../../../utils/projectPages.ts';

export interface WorkspaceOptions {
  project: ProjectState | null;
  getCanvasPreview?: () => Promise<Blob>;
  getLayerPreview?: (layerId: string) => Promise<Blob>;
  getAssetFolder?: () => Promise<FileSystemDirectoryHandle | null>;
  selectedLayerIds: string[];
  storage: StorageAdapter;
  localProjects: { project: ProjectState; localPath?: string }[];
  activeLocalPath: string | null;
  chatStorageKey?: string;
  getChatDirectory?: () => Promise<FileSystemDirectoryHandle>;
  onCommit: (project: ProjectState) => void;
  onOpen: (project: ProjectState, localPath?: string) => Promise<ProjectState | void>;
  onUpsert: (project: ProjectState) => void;
  onDelete: (id: string, localPath?: string) => void;
  onSearch: (query: string) => void;
  saveLocal: (path: string, project: ProjectState) => Promise<unknown>;
}

export function createWorkspaceBridge(
  getOptions: () => WorkspaceOptions,
  confirm: (message: string, signal: AbortSignal) => Promise<boolean>
): WorkspaceBridge {
  let current: ProjectState | null | undefined;
  let lastOptions: WorkspaceOptions | undefined;
  const read = () => {
    const options = getOptions();
    if (options !== lastOptions) { current = options.project; lastOptions = options; }
    return options;
  };
  const ready = async () => {
    const options = read();
    if (!await options.storage.ensureReady({ prompt: false })) throw new Error('Storage is not ready. Select a storage folder first.');
    return options;
  };
  const save = async (project: ProjectState, localPath?: string) => {
    const options = read();
    if (localPath) await options.saveLocal(localPath, project);
    else { await ready(); await options.storage.saveProject(project); }
  };
  const flush = async () => {
    const options = read();
    if (current) await save(current, options.activeLocalPath || undefined);
  };
  const find = async (id: string) => {
    const options = read();
    if (current?.id === id) return { project: current, localPath: options.activeLocalPath || undefined };
    const local = options.localProjects.find(item => item.project.id === id);
    if (local) return local;
    await ready();
    for (let page = 1; ; page++) {
      const result = await options.storage.listProjects({ page, pageSize: 50 });
      const project = result.items.find(item => item.id === id);
      if (project) return { project, localPath: undefined };
      if (page * 50 >= result.total || !result.items.length) break;
    }
    throw new Error('Project not found: ' + id);
  };
  const open = async (project: ProjectState, localPath?: string) => {
    await flush();
    const opened = await read().onOpen(project, localPath);
    current = structuredClone(opened || project);
  };
  return {
    confirm,
    getProject: () => { read(); return current || null; },
    getCanvasPreview: async () => {
      const options = read();
      if (!current) throw new Error('No project open.');
      if (!options.getCanvasPreview) throw new Error('Canvas preview is unavailable.');
      return options.getCanvasPreview();
    },
    getLayerPreview: async layerId => {
      const options = read();
      if (!current) throw new Error('No project open.');
      if (!options.getLayerPreview) throw new Error('Layer preview is unavailable.');
      return options.getLayerPreview(layerId);
    },
    getAssetFolder: async () => read().getAssetFolder?.() ?? null,
    getSelection: () => read().selectedLayerIds,
    commit: async project => {
      const options = read();
      if (current?.id !== project.id) throw new Error('Active project changed.');
      current = syncProjectPages(project);
      options.onCommit(current);
      await save(current, options.activeLocalPath || undefined);
    },
    manageProjects: async (input, signal) => {
      signal.throwIfAborted();
      const args = parseManageProjectsRequest(input);
      const options = read();
      if (args.action === 'list') {
        const query = args.query ?? '';
        const page = args.page ?? 1;
        const pageSize = args.pageSize ?? 20;
        await ready();
        const result = await options.storage.listProjects({ query, page, pageSize });
        options.onSearch(query);
        const summary = (project: ProjectState, source: string) => ({ id: project.id, title: project.title, updatedAt: project.updatedAt, canvas: project.pages?.[0]?.canvasConfig ?? project.canvasConfig, pageCount: project.pages?.length ?? 1, layerCount: project.pages?.[0]?.layers.length ?? project.layers.length, source });
        return { items: result.items.map(project => summary(current?.id === project.id ? current : project, 'storage')), total: result.total, page, pageSize, localItems: options.localProjects.filter(item => item.project.title.toLowerCase().includes(query.toLowerCase())).map(item => summary(item.project, 'local')) };
      }
      if (args.action === 'create') {
        const width = args.width ?? 1200;
        const height = args.height ?? 630;
        const project: ProjectState = { id: generateId(), title: args.title ?? 'Untitled', layers: [], background: { type: 'color', value: '#18181b', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0.1, overlayScale: 20 }, canvasConfig: { width, height, ratio: `${width}x${height}` }, selectedLayerId: null, updatedAt: Date.now() };
        const created = syncProjectPages(project);
        await save(created);
        signal.throwIfAborted();
        options.onUpsert(created);
        await open(created);
        return { success: true, projectId: created.id, title: created.title, pageId: created.activePageId };
      }
      const id = args.projectId;
      const target = await find(id);
      signal.throwIfAborted();
      if (args.action === 'open') {
        await open(target.project, target.localPath);
        return { success: true, projectId: id, title: target.project.title };
      }
      if (args.action === 'save') { await save(target.project, target.localPath); return { success: true, projectId: id }; }
      if (args.action === 'delete') {
        if (!await confirm(`删除项目「${target.project.title}」？${target.localPath ? '仅移除最近打开记录，不删除磁盘文件。' : '此操作不可撤销。'}`, signal)) throw new Error('User cancelled project deletion.');
        signal.throwIfAborted();
        const latest = await find(id);
        if (!latest.localPath) { await ready(); await options.storage.deleteProject(id); }
        options.onDelete(id, latest.localPath);
        if (current?.id === id) current = null;
        return { success: true, projectId: id };
      }
      if (args.action === 'rename') {
        const project = { ...target.project, title: args.title, updatedAt: Date.now() };
        if (current?.id === id) { current = project; options.onCommit(project); }
        await save(project, target.localPath);
        options.onUpsert(project);
        return { success: true, projectId: id, title: project.title };
      }
      const project = copyProject(target.project, args.title ?? target.project.title + ' (copy)');
      await save(project);
      options.onUpsert(project);
      return { success: true, projectId: project.id, title: project.title };
    }
  };
}