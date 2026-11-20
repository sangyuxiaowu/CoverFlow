import { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectState } from '../types.ts';
import { decodeProjectArchive, encodeProjectArchive } from '../storage/projectArchive.ts';
import { readLegacyCfj } from '../storage/legacyCfj.ts';
import { summarizeProject, type ProjectSummary } from '../storage/StorageAdapter.ts';
import { pagePreviewFingerprint } from '../storage/projectPreviews.ts';
import { captureImageAssets } from '../storage/imageAssets.ts';
import { writeProject } from '../storage/projectCompatibility.ts';

export const readLocalProject = async (path: string) => {
  const { readFile, readTextFile } = await import('@tauri-apps/plugin-fs');
  return path.toLowerCase().endsWith('.cfjx') ? decodeProjectArchive(await readFile(path)) : readLegacyCfj(await readTextFile(path));
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
  onOpenProject: (project: ProjectState) => void;
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
  const isTauri = import.meta.env.VITE_APP_MODE === 'tauri';

  const removeLocalRecentByPath = useCallback((path: string) => {
    const nextMeta = readLocalRecentMeta().filter(item => item.path !== path);
    writeLocalRecentMeta(nextMeta);
    setLocalRecentItems(prev => prev.filter(item => item.localPath !== path));
  }, []);

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

  const openLocalProjectFromPath = useCallback(async (path: string) => {
    if (!isTauri) return;
    try {
      const parsed = await readLocalProject(path);
      onOpenProject(parsed);
      setActiveLocalFilePath(path);
      updateLocalRecentMeta(path, parsed);
      setLocalRecentItems(prev => {
        const next = prev.filter(item => item.localPath !== path);
        return [{ project: parsed, source: 'local', localPath: path }, ...next];
      });
      return parsed;
    } catch (err) {
      removeLocalRecentByPath(path);
      showToast(parseFailedMessage, 'error');
    }
  }, [isTauri, onOpenProject, parseFailedMessage, removeLocalRecentByPath, showToast, updateLocalRecentMeta]);

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
    const assets = Object.fromEntries(captureImageAssets(writeProject(projectData).pages));
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const nextProject = { ...projectData, updatedAt: Date.now() };
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
      return [{ project: nextProject, source: 'local', localPath: targetPath }, ...next];
    });
    return nextProject;
  }, [onUpdateProject, removeLocalRecentByPath, updateLocalRecentMeta]);

  const clearActiveLocalFilePath = useCallback(() => {
    setActiveLocalFilePath(null);
  }, []);

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
    removeLocalRecentByPath,
    saveLocalProjectToFile,
    clearActiveLocalFilePath
  };
};
