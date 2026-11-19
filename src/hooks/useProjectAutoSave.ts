import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ProjectDocument, ProjectState } from '../types.ts';
import type { StorageAdapter } from '../storage/StorageAdapter.ts';
import { writeProject } from '../storage/projectCompatibility.ts';

const sameDocument = (left: ProjectDocument | null, right: ProjectDocument) => Boolean(left &&
  left.id === right.id && left.title === right.title && left.version === right.version &&
  left.schemaVersion === right.schemaVersion && left.updatedAt === right.updatedAt &&
  left.pages.length === right.pages.length && left.pages.every((page, index) => {
    const other = right.pages[index];
    return page.id === other.id && page.name === other.name && page.layers === other.layers && page.pageInfo === other.pageInfo;
  }));

type AutoSaveOptions = {
  project: ProjectState | null;
  view: 'landing' | 'editor';
  storageAdapter: StorageAdapter;
  storageReadyRef: RefObject<boolean>;
  isCloudMode: boolean;
  isTauri: boolean;
  activeLocalFilePath: string | null;
  saveLocalProjectToFile: (path: string, project: ProjectState) => Promise<ProjectState>;
  clearActiveLocalFilePath: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
  reportStorageError: (error: unknown, operation: string, message: string, projectId?: string, path?: string | null) => void;
  savedMessage: string;
  saveFailedMessage: string;
};

export function useProjectAutoSave({ project, view, storageAdapter, storageReadyRef, isCloudMode, isTauri,
  activeLocalFilePath, saveLocalProjectToFile, clearActiveLocalFilePath, showToast, reportStorageError,
  savedMessage, saveFailedMessage }: AutoSaveOptions) {
  const lastSavedAtRef = useRef(0);
  const lastSavedSnapshotRef = useRef<{ adapter: StorageAdapter; path: string | undefined; snapshot: ProjectDocument } | null>(null);
  const lastSavedProjectIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const latestProjectRef = useRef<ProjectState | null>(null);
  const prevViewRef = useRef(view);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef<{ adapter: StorageAdapter; path: string | undefined; snapshot: ProjectDocument; promise: Promise<ProjectState> } | null>(null);

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current === null) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }, []);

  useEffect(() => {
    latestProjectRef.current = project;
    if (!project) {
      lastSavedProjectIdRef.current = null;
      lastSavedSnapshotRef.current = null;
      return;
    }
    if (lastSavedProjectIdRef.current !== project.id) {
      lastSavedProjectIdRef.current = project.id;
      lastSavedSnapshotRef.current = { adapter: storageAdapter, path: isTauri ? activeLocalFilePath ?? undefined : undefined, snapshot: writeProject(project) };
    }
  }, [project, storageAdapter, isTauri, activeLocalFilePath]);

  const saveActiveProject = useCallback((nextProject: ProjectState, path?: string, force = false): Promise<ProjectState> => {
    const snapshot = writeProject(nextProject);
    const pending = pendingRef.current;
    const lastSaved = lastSavedSnapshotRef.current;
    if (pending && pending.adapter === storageAdapter && pending.path === path && sameDocument(pending.snapshot, snapshot)) return pending.promise;
    if (!force && !pending && lastSaved?.adapter === storageAdapter && lastSaved.path === path && sameDocument(lastSaved.snapshot, snapshot)) return Promise.resolve(nextProject);
    const promise = saveQueueRef.current.then(async () => {
      if (path) return saveLocalProjectToFile(path, nextProject);
      if (!await storageAdapter.ensureReady({ prompt: false })) throw new Error('Storage is not ready. Select a storage folder first.');
      await storageAdapter.saveProject(nextProject);
      return nextProject;
    }).then(saved => {
      lastSavedAtRef.current = Date.now();
      if (latestProjectRef.current?.id === saved.id) {
        lastSavedProjectIdRef.current = saved.id;
        lastSavedSnapshotRef.current = { adapter: storageAdapter, path, snapshot: writeProject(saved) };
      }
      return saved;
    });
    const task = { adapter: storageAdapter, path, snapshot, promise };
    pendingRef.current = task;
    saveQueueRef.current = promise.then(() => {}, () => {});
    void promise.then(() => { if (pendingRef.current === task) pendingRef.current = null; }, () => { if (pendingRef.current === task) pendingRef.current = null; });
    return promise;
  }, [storageAdapter, saveLocalProjectToFile]);

  const performAutoSave = useCallback((reason: 'auto' | 'leave' | 'manual') => {
    const canSaveLocal = Boolean(activeLocalFilePath && isTauri);
    if (!storageReadyRef.current && !canSaveLocal) return;
    const currentProject = latestProjectRef.current;
    if (!currentProject) return;
    if (canSaveLocal && reason === 'auto') return;
    const now = Date.now();
    if (reason === 'auto' && now - lastSavedAtRef.current < 5000) {
      if (saveTimerRef.current === null) {
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null;
          performAutoSave('auto');
        }, 5000 - (now - lastSavedAtRef.current));
      }
      return;
    }

    const lastSaved = lastSavedSnapshotRef.current;
    const path = canSaveLocal ? activeLocalFilePath! : undefined;
    if (!pendingRef.current && lastSaved?.adapter === storageAdapter && lastSaved.path === path && sameDocument(lastSaved.snapshot, writeProject(currentProject))) return;
    saveActiveProject(currentProject, path).then(() => {
      if (reason === 'manual') showToast(savedMessage);
    }).catch(error => {
      if (canSaveLocal) reportStorageError(error, `save-${reason}`, saveFailedMessage, currentProject.id, activeLocalFilePath);
      else reportStorageError(error, `save-${reason}`, saveFailedMessage, currentProject.id);
    });
  }, [activeLocalFilePath, isTauri, storageReadyRef, storageAdapter, saveActiveProject, showToast, reportStorageError, savedMessage, saveFailedMessage]);

  const persistProject = useCallback(async (nextProject: ProjectState) => {
    try {
      await saveActiveProject(nextProject, undefined, true);
    } catch (error) {
      reportStorageError(error, 'persist-project', saveFailedMessage, nextProject.id);
    }
  }, [saveActiveProject, reportStorageError, saveFailedMessage]);

  useEffect(() => {
    cancelPendingSave();
    return cancelPendingSave;
  }, [storageAdapter, cancelPendingSave]);

  useEffect(() => {
    if (isCloudMode || view !== 'editor' || !project || (activeLocalFilePath && isTauri)) return;
    performAutoSave('auto');
  }, [project, view, performAutoSave, isCloudMode, activeLocalFilePath, isTauri]);

  useEffect(() => {
    if (prevViewRef.current === 'editor' && view !== 'editor') {
      performAutoSave('leave');
      clearActiveLocalFilePath();
    }
    prevViewRef.current = view;
  }, [view, performAutoSave, clearActiveLocalFilePath]);

  useEffect(() => {
    const handleBeforeUnload = () => performAutoSave('leave');
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [performAutoSave]);

  return { performAutoSave, persistProject, saveActiveProject, latestProjectRef, cancelPendingSave };
}