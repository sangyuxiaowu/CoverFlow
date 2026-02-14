import { useCallback, useEffect, useState } from 'react';
import { ProjectState } from '../types.ts';

const LOCAL_RECENT_KEY = 'coverflow_recent_local_files_v1';

export type RecentProjectItem = {
  project: ProjectState;
  source: 'storage' | 'local';
  localPath?: string;
};

type LocalRecentMeta = {
  path: string;
  title: string;
  updatedAt: number;
  lastOpenedAt: number;
};

type UseLocalProjectsOptions = {
  view: 'landing' | 'editor';
  parseFailedMessage: string;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onOpenProject: (project: ProjectState) => void;
  onUpdateProject: (project: ProjectState) => void;
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
  const isTauri = import.meta.env.VITE_APP_MODE === 'tauri';

  const removeLocalRecentByPath = useCallback((path: string) => {
    const nextMeta = readLocalRecentMeta().filter(item => item.path !== path);
    writeLocalRecentMeta(nextMeta);
    setLocalRecentItems(prev => prev.filter(item => item.localPath !== path));
  }, []);

  const updateLocalRecentMeta = useCallback((path: string, projectData: ProjectState) => {
    const now = Date.now();
    const meta = readLocalRecentMeta();
    const nextMeta = meta.filter(item => item.path !== path);
    nextMeta.unshift({
      path,
      title: projectData.title,
      updatedAt: projectData.updatedAt,
      lastOpenedAt: now
    });
    writeLocalRecentMeta(nextMeta.slice(0, 50));
  }, []);

  const openLocalProjectFromPath = useCallback(async (path: string) => {
    if (!isTauri) return;
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const text = await readTextFile(path);
      const parsed = JSON.parse(text) as ProjectState;
      if (!parsed?.id || !parsed.layers) throw new Error('Invalid project file');
      onOpenProject(parsed);
      setActiveLocalFilePath(path);
      updateLocalRecentMeta(path, parsed);
      setLocalRecentItems(prev => {
        const next = prev.filter(item => item.localPath !== path);
        return [{ project: parsed, source: 'local', localPath: path }, ...next];
      });
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
      filters: [{ name: 'CoverFlow Project', extensions: ['cfj'] }]
    });
    if (typeof selection === 'string') {
      await openLocalProjectFromPath(selection);
    }
  }, [isTauri, openLocalProjectFromPath]);

  const saveLocalProjectToFile = useCallback(async (path: string, projectData: ProjectState) => {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const nextProject = { ...projectData, updatedAt: Date.now() };
    await writeTextFile(path, JSON.stringify(nextProject, null, 2));
    onUpdateProject(nextProject);
    updateLocalRecentMeta(path, nextProject);
    setLocalRecentItems(prev => {
      const next = prev.filter(item => item.localPath !== path);
      return [{ project: nextProject, source: 'local', localPath: path }, ...next];
    });
    return nextProject;
  }, [onUpdateProject, updateLocalRecentMeta]);

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
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const nextItems: RecentProjectItem[] = [];
      const nextMeta: LocalRecentMeta[] = [];
      for (const item of meta) {
        try {
          const text = await readTextFile(item.path);
          const parsed = JSON.parse(text) as ProjectState;
          if (!parsed?.id || !parsed.layers) continue;
          nextItems.push({ project: parsed, source: 'local', localPath: item.path });
          nextMeta.push({
            path: item.path,
            title: parsed.title,
            updatedAt: parsed.updatedAt,
            lastOpenedAt: item.lastOpenedAt || Date.now()
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
