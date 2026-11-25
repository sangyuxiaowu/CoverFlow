import { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectState } from '../types.ts';
import { decodeProjectArchive, encodeProjectArchive } from '../storage/projectArchive.ts';
import { readLegacyCfj } from '../storage/legacyCfj.ts';
import { summarizeProject, type ProjectSummary } from '../storage/StorageAdapter.ts';
import { pagePreviewFingerprint } from '../storage/projectPreviews.ts';
import { captureImageAssets, collectProjectImagePages } from '../storage/imageAssets.ts';
import { writeProject } from '../storage/projectCompatibility.ts';
import { ProjectImageSession } from '../storage/projectImageSession.ts';
import { readFileBytes, writeFileContent } from '../storage/fileAccess.ts';
import { listBrowserRecentProjects, putBrowserRecentProject, removeBrowserRecentProject } from '../storage/browserRecentProjects.ts';
import { generateId } from '../utils/helpers.ts';

export const readLocalProject = async (path: string, imageOwner?: symbol) => {
  const { readFile, readTextFile } = await import('@tauri-apps/plugin-fs');
  return path.toLowerCase().endsWith('.cfjx') ? decodeProjectArchive(await readFile(path), imageOwner) : readLegacyCfj(await readTextFile(path));
};

const LOCAL_RECENT_KEY = 'coverflow_recent_local_files_v1';

export type RecentProjectItem = {
  project: ProjectState | ProjectSummary;
  source: 'storage' | 'local';
  localPath?: string;
};

type LocalRecentMeta = {
  path: string;
  title: string;
  updatedAt: number;
  lastOpenedAt: number;
  summary?: ProjectSummary;
  size?: number;
  modified?: number;
};

const localSummary = (project: ProjectState): ProjectSummary => {
  const first = project.pages?.[0];
  return { ...summarizeProject(project), ...(first ? { firstPageId: first.id, fingerprint: pagePreviewFingerprint(first) } : {}) };
};

type UseLocalProjectsOptions = {
  view: 'landing' | 'editor';
  parseFailedMessage: string;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onOpenProject: (project: ProjectState, session: ProjectImageSession, beforeCommit?: () => boolean) => Promise<ProjectState>;
  onUpdateProject: (project: ProjectState, source: ProjectState) => void;
};

const readLocalRecentMeta = () => {
  if (typeof sessionStorage === 'undefined') return [] as LocalRecentMeta[];
  const raw = sessionStorage.getItem(LOCAL_RECENT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LocalRecentMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
};

const writeLocalRecentMeta = (items: LocalRecentMeta[]) => {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(LOCAL_RECENT_KEY, JSON.stringify(items));
};

export const useLocalProjects = ({
  view,
  parseFailedMessage,
  showToast,
  onOpenProject,
  onUpdateProject
}: UseLocalProjectsOptions) => {
  const [localRecentItems, setLocalRecentItems] = useState<RecentProjectItem[]>([]);
  const [activeLocalFilePath, setActiveLocalFilePath] = useState<string | null>(null);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const recentWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const browserFiles = useRef(new Map<string, FileSystemFileHandle>());
  const isTauri = import.meta.env.VITE_APP_MODE === 'tauri';

  const queueBrowserRecentWrite = useCallback((operation: () => Promise<void>) => {
    const pending = recentWriteQueue.current.then(operation);
    recentWriteQueue.current = pending.catch(error => console.error('[CoverFlow recent files]', error));
    return recentWriteQueue.current;
  }, []);

  const removeLocalRecentByPath = useCallback((path: string) => {
    if (!isTauri) {
      browserFiles.current.delete(path);
      void queueBrowserRecentWrite(() => removeBrowserRecentProject(path));
      setLocalRecentItems(prev => prev.filter(item => item.localPath !== path));
      return;
    }
    const nextMeta = readLocalRecentMeta().filter(item => item.path !== path);
    writeLocalRecentMeta(nextMeta);
    setLocalRecentItems(prev => prev.filter(item => item.localPath !== path));
  }, [isTauri, queueBrowserRecentWrite]);

  const readProjectFromLocalPath = useCallback(async (path: string, imageOwner?: symbol, request = false) => {
    if (isTauri) return readLocalProject(path, imageOwner);
    const handle = browserFiles.current.get(path);
    if (!handle) throw new Error('The opened file is no longer available.');
    if (await handle.queryPermission({ mode: 'read' }) !== 'granted' &&
        (!request || await handle.requestPermission({ mode: 'read' }) !== 'granted')) {
      throw new DOMException('Read permission denied.', 'NotAllowedError');
    }
    return decodeProjectArchive(await readFileBytes(handle), imageOwner);
  }, [isTauri]);

  const rememberBrowserProject = useCallback((path: string, handle: FileSystemFileHandle, projectData: ProjectState) => {
    const summary = localSummary(projectData);
    setLocalRecentItems(prev => [{ project: summary, source: 'local', localPath: path }, ...prev.filter(item => item.localPath !== path)]);
    return queueBrowserRecentWrite(() => putBrowserRecentProject({ path, handle, summary, lastOpenedAt: Date.now() }));
  }, [queueBrowserRecentWrite]);

  const updateLocalRecentMeta = useCallback((path: string, projectData: ProjectState) => {
    const now = Date.now();
    const meta = readLocalRecentMeta();
    const previous = meta.find(item => item.path === path);
    const nextMeta = meta.filter(item => item.path !== path);
    nextMeta.unshift({
      path,
      title: projectData.title,
      updatedAt: projectData.updatedAt,
      lastOpenedAt: now,
      summary: localSummary(projectData),
      size: previous?.size,
      modified: previous?.modified
    });
    writeLocalRecentMeta(nextMeta.slice(0, 50));
  }, []);

  const openLocalProjectFromPath = useCallback(async (path: string, requestPermission = true) => {
    const session = new ProjectImageSession();
    try {
      const parsed = await onOpenProject(await readProjectFromLocalPath(path, session.owner, requestPermission), session);
      setActiveLocalFilePath(path);
      if (!isTauri) {
        await rememberBrowserProject(path, browserFiles.current.get(path)!, parsed);
        return parsed;
      }
      updateLocalRecentMeta(path, parsed);
      setLocalRecentItems(prev => {
        const next = prev.filter(item => item.localPath !== path);
        return [{ project: localSummary(parsed), source: 'local', localPath: path }, ...next];
      });
      return parsed;
    } catch (err) {
      session.close();
      if (isTauri) removeLocalRecentByPath(path);
      showToast(parseFailedMessage, 'error');
    }
  }, [isTauri, onOpenProject, parseFailedMessage, readProjectFromLocalPath, rememberBrowserProject, removeLocalRecentByPath, showToast, updateLocalRecentMeta]);

  const openLocalProjectDialog = useCallback(async () => {
    if (!isTauri) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selection = await open({
      multiple: false,
      filters: [{ name: 'CoverFlow Project', extensions: ['cfjx', 'cfj'] }]
    });
    if (typeof selection === 'string') {
      await openLocalProjectFromPath(selection);
    }
  }, [isTauri, openLocalProjectFromPath]);

  const saveLocalProjectToFile = useCallback(async (path: string, projectData: ProjectState) => {
    const assets = Object.fromEntries(captureImageAssets(collectProjectImagePages(writeProject(projectData))));
    const nextProject = { ...projectData, updatedAt: Date.now() };
    const browserFile = browserFiles.current.get(path);
    if (browserFile) {
      if (await browserFile.queryPermission({ mode: 'readwrite' }) !== 'granted' &&
          await browserFile.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new DOMException('Write permission denied.', 'NotAllowedError');
      }
      const operation = writeQueue.current.then(async () => {
        const bytes = await encodeProjectArchive(nextProject, undefined, assets);
        await writeFileContent(browserFile, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/x-coverflow-project' }));
      });
      writeQueue.current = operation.catch(() => {});
      await operation;
      onUpdateProject(nextProject, projectData);
      await rememberBrowserProject(path, browserFile, nextProject);
      return nextProject;
    }
    if (!isTauri) throw new Error('The opened file is no longer available.');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    let targetPath = path;
    if (!path.toLowerCase().endsWith('.cfjx')) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const selected = await save({ defaultPath: path.replace(/\.cfj$/i, '.cfjx'), filters: [{ name: 'CoverFlow Project', extensions: ['cfjx'] }] });
      if (!selected) throw new Error('Project conversion was cancelled.');
      if (!selected.toLowerCase().endsWith('.cfjx')) throw new Error('Expected a CFJX project file.');
      targetPath = selected;
    }
    const operation = writeQueue.current.then(async () => { await writeFile(targetPath, await encodeProjectArchive(nextProject, undefined, assets)); });
    writeQueue.current = operation.catch(() => {});
    await operation;
    setActiveLocalFilePath(current => current === path ? targetPath : current);
    onUpdateProject(nextProject, projectData);
    if (targetPath !== path) removeLocalRecentByPath(path);
    updateLocalRecentMeta(targetPath, nextProject);
    setLocalRecentItems(prev => {
      const next = prev.filter(item => item.localPath !== targetPath && item.localPath !== path);
      return [{ project: localSummary(nextProject), source: 'local', localPath: targetPath }, ...next];
    });
    return nextProject;
  }, [isTauri, onUpdateProject, rememberBrowserProject, removeLocalRecentByPath, updateLocalRecentMeta]);

  const openBrowserProject = useCallback(async (handle: FileSystemFileHandle, beforeOpen: () => Promise<(() => boolean) | null>) => {
    if (!handle.name.toLowerCase().endsWith('.cfjx')) return;
    const session = new ProjectImageSession();
    try {
      const parsed = await decodeProjectArchive(await readFileBytes(handle), session.owner);
      const beforeCommit = await beforeOpen();
      if (!beforeCommit) {
        session.close();
        return;
      }
      let path = [...browserFiles.current].find(([, existing]) => existing === handle)?.[0];
      try {
        const recent = await listBrowserRecentProjects();
        for (const item of recent) {
          if (await handle.isSameEntry(item.handle)) { path = item.path; break; }
        }
      } catch (error) { console.error('[CoverFlow recent files]', error); }
      path ??= `pwa:${generateId()}`;
      const opened = await onOpenProject(parsed, session, beforeCommit);
      browserFiles.current.set(path, handle);
      setActiveLocalFilePath(path);
      await rememberBrowserProject(path, handle, opened);
      return { project: opened, path };
    } catch (error) {
      session.close();
      showToast(parseFailedMessage, 'error');
    }
  }, [onOpenProject, parseFailedMessage, rememberBrowserProject, showToast]);

  const clearActiveLocalFilePath = useCallback(() => {
    setActiveLocalFilePath(null);
  }, []);

  useEffect(() => {
    if (isTauri) return;
    let active = true;
    void listBrowserRecentProjects().then(items => {
      if (!active) return;
      for (const item of items) if (!browserFiles.current.has(item.path)) browserFiles.current.set(item.path, item.handle);
      setLocalRecentItems(previous => [...previous, ...items.filter(item => !previous.some(existing => existing.localPath === item.path)).map(item => ({ project: item.summary, source: 'local' as const, localPath: item.path }))]);
    }).catch(error => console.error('[CoverFlow recent files]', error));
    return () => { active = false; };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri || view !== 'landing') return;
    let active = true;
    const loadLocalRecents = async () => {
      const meta = readLocalRecentMeta();
      if (meta.length === 0) {
        if (active) setLocalRecentItems([]);
        return;
      }
      const nextItems: RecentProjectItem[] = [];
      const nextMeta: LocalRecentMeta[] = [];
      const { stat } = await import('@tauri-apps/plugin-fs');
      for (const item of meta) {
        try {
          const file = await stat(item.path);
          const modified = file.mtime?.getTime() ?? 0;
          if (item.summary && item.size === file.size && item.modified === modified) {
            nextItems.push({ project: item.summary, source: 'local', localPath: item.path });
            nextMeta.push(item);
            continue;
          }
          const parsed = await readLocalProject(item.path);
          const summary = localSummary(parsed);
          nextItems.push({ project: summary, source: 'local', localPath: item.path });
          nextMeta.push({
            path: item.path,
            title: parsed.title,
            updatedAt: parsed.updatedAt,
            lastOpenedAt: item.lastOpenedAt || Date.now(),
            summary,
            size: file.size,
            modified
          });
        } catch (err) {
          // skip invalid path
        }
      }
      if (!active) return;
      setLocalRecentItems(nextItems);
      writeLocalRecentMeta(nextMeta);
    };
    loadLocalRecents();
    return () => {
      active = false;
    };
  }, [isTauri, view]);

  useEffect(() => {
    if (!isTauri) return;
    const init = async () => {
      try {
        const pendingFromGlobal = (window as any).__CFJ_PENDING__;
        if (Array.isArray(pendingFromGlobal)) {
          (window as any).__CFJ_PENDING__ = [];
          for (const path of pendingFromGlobal) {
            if (path) await openLocalProjectFromPath(path);
          }
        }
      } catch (err) {
        // ignore pending open errors
      }
    };
    init();
  }, [isTauri, openLocalProjectFromPath]);

  return {
    isTauri,
    localRecentItems,
    activeLocalFilePath,
    openLocalProjectDialog,
    openLocalProjectFromPath,
    openBrowserProject,
    readProjectFromLocalPath,
    removeLocalRecentByPath,
    saveLocalProjectToFile,
    clearActiveLocalFilePath
  };
};
