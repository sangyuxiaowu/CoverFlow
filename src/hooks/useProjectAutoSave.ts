import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectDocument, ProjectSaveStatus, ProjectState } from '../types.ts';
import type { StorageAdapter } from '../storage/StorageAdapter.ts';
import { sameStoredValue, writeProject } from '../storage/projectCompatibility.ts';
import { collectProjectImagePages, leaseImageAssets } from '../storage/imageAssets.ts';

export const DEFAULT_AUTO_SAVE_IDLE_MS = 15000;

export type SaveReason = 'auto' | 'page-switch' | 'leave' | 'manual';

const sameVersions = (left: ProjectDocument['versions'], right: ProjectDocument['versions']) => {
  const leftList = left ?? [];
  const rightList = right ?? [];
  if (leftList.length !== rightList.length) return false;
  return leftList.every((item, index) => {
    const other = rightList[index];
    return item === other || (
      item.id === other.id &&
      item.info === other.info &&
      item.createdAt === other.createdAt &&
      item.title === other.title &&
      item.version === other.version &&
      sameStoredValue(item.pages, other.pages)
    );
  });
};

const sameDocument = (left: ProjectDocument | null, right: ProjectDocument) => Boolean(left &&
  left.id === right.id && left.title === right.title && left.version === right.version &&
  left.schemaVersion === right.schemaVersion &&
  sameVersions(left.versions, right.versions) &&
  left.pages.length === right.pages.length && left.pages.every((page, index) => {
    const other = right.pages[index];
    return page.id === other.id && page.name === other.name && page.notes === other.notes && sameStoredValue(page.layers, other.layers) && sameStoredValue(page.pageInfo, other.pageInfo);
  }));

type AutoSaveOptions = {
  project: ProjectState | null;
  view: 'landing' | 'editor';
  storageAdapter: StorageAdapter;
  isCloudMode: boolean;
  isTauri: boolean;
  activeLocalFilePath: string | null;
  idleDelayMs?: number;
  saveLocalProjectToFile: (path: string, project: ProjectState) => Promise<ProjectState>;
  clearActiveLocalFilePath: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
  reportStorageError: (error: unknown, operation: string, message: string, projectId?: string, path?: string | null) => void;
  savedMessage: string;
  saveFailedMessage: string;
};

export function useProjectAutoSave({
  project,
  view,
  storageAdapter,
  isCloudMode,
  isTauri,
  activeLocalFilePath,
  idleDelayMs = DEFAULT_AUTO_SAVE_IDLE_MS,
  saveLocalProjectToFile,
  clearActiveLocalFilePath,
  showToast,
  reportStorageError,
  savedMessage,
  saveFailedMessage
}: AutoSaveOptions) {
  const [saveStatus, setSaveStatus] = useState<ProjectSaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const saveStatusRef = useRef<ProjectSaveStatus>('saved');
  const updateSaveStatus = useCallback((next: ProjectSaveStatus) => {
    saveStatusRef.current = next;
    setSaveStatus(next);
  }, []);

  const lastSavedSnapshotRef = useRef<{ adapter: StorageAdapter; path: string | undefined; snapshot: ProjectDocument } | null>(null);
  const lastSavedProjectIdRef = useRef<string | null>(null);
  const lastObservedSnapshotRef = useRef<ProjectDocument | null>(null);
  const prevActivePageIdRef = useRef<string | null>(null);
  const prevAdapterRef = useRef<StorageAdapter>(storageAdapter);
  const saveTimerRef = useRef<number | null>(null);
  const latestProjectRef = useRef<ProjectState | null>(null);
  const prevViewRef = useRef(view);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef<{ adapter: StorageAdapter; path: string | undefined; snapshot: ProjectDocument; promise: Promise<ProjectState> } | null>(null);
  const hasUnsavedRef = useRef(false);

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current === null) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }, []);

  const markProjectSaved = useCallback((savedProject: ProjectState, path?: string) => {
    cancelPendingSave();
    const snapshot = writeProject(savedProject);
    lastSavedProjectIdRef.current = savedProject.id;
    lastSavedSnapshotRef.current = { adapter: storageAdapter, path, snapshot };
    lastObservedSnapshotRef.current = snapshot;
    prevActivePageIdRef.current = savedProject.activePageId ?? null;
    hasUnsavedRef.current = false;
    const now = Date.now();
    setLastSavedAt(now);
    updateSaveStatus('saved');
  }, [cancelPendingSave, storageAdapter, updateSaveStatus]);

  const saveActiveProject = useCallback((nextProject: ProjectState, path?: string, force = false): Promise<ProjectState> => {
    const snapshot = writeProject(nextProject);
    const pending = pendingRef.current;
    const lastSaved = lastSavedSnapshotRef.current;
    if (pending && pending.adapter === storageAdapter && pending.path === path && sameDocument(pending.snapshot, snapshot)) {
      return pending.promise;
    }
    if (!force && !pending && lastSaved?.adapter === storageAdapter && lastSaved.path === path && sameDocument(lastSaved.snapshot, snapshot)) {
      if (latestProjectRef.current?.id === nextProject.id && saveStatusRef.current !== 'saved') {
        hasUnsavedRef.current = false;
        updateSaveStatus('saved');
      }
      return Promise.resolve(nextProject);
    }

    let releaseAssets: () => void;
    try {
      releaseAssets = leaseImageAssets(collectProjectImagePages(snapshot));
    } catch (error) {
      if (latestProjectRef.current?.id === nextProject.id) {
        hasUnsavedRef.current = true;
        updateSaveStatus('error');
      }
      return Promise.reject(error);
    }

    if (latestProjectRef.current?.id === nextProject.id) {
      updateSaveStatus('saving');
    }

    const promise = saveQueueRef.current.then(async () => {
      if (path) return saveLocalProjectToFile(path, nextProject);
      if (!await storageAdapter.ensureReady({ prompt: false })) {
        throw new Error('Storage is not ready. Select a storage folder first.');
      }
      await storageAdapter.saveProject(nextProject);
      return nextProject;
    }).then(saved => {
      const now = Date.now();
      setLastSavedAt(now);
      if (latestProjectRef.current?.id === saved.id) {
        const savedSnapshot = writeProject(saved);
        lastSavedProjectIdRef.current = saved.id;
        lastSavedSnapshotRef.current = { adapter: storageAdapter, path, snapshot: savedSnapshot };
        const currentSnapshot = writeProject(latestProjectRef.current);
        const stillDirty = !sameDocument(savedSnapshot, currentSnapshot);
        hasUnsavedRef.current = stillDirty;
        updateSaveStatus(stillDirty ? 'unsaved' : 'saved');
      } else {
        hasUnsavedRef.current = false;
        updateSaveStatus('saved');
      }
      return saved;
    }, error => {
      if (latestProjectRef.current?.id === nextProject.id) {
        if (force && lastSavedSnapshotRef.current?.snapshot.id === nextProject.id) {
          lastSavedSnapshotRef.current = null;
        }
        hasUnsavedRef.current = true;
        updateSaveStatus('error');
      }
      throw error;
    });

    const task = { adapter: storageAdapter, path, snapshot, promise };
    pendingRef.current = task;
    saveQueueRef.current = promise.then(() => {}, () => {});
    void promise.then(releaseAssets, releaseAssets);
    void promise.then(
      () => { if (pendingRef.current === task) pendingRef.current = null; },
      () => { if (pendingRef.current === task) pendingRef.current = null; }
    );
    return promise;
  }, [storageAdapter, saveLocalProjectToFile, updateSaveStatus, lastSavedAt]);

  const flushSave = useCallback(async (reason: SaveReason): Promise<boolean> => {
    cancelPendingSave();
    const canSaveLocal = Boolean(activeLocalFilePath && isTauri);
    const currentProject = latestProjectRef.current;
    if (!currentProject) return true;
    if (canSaveLocal && (reason === 'auto' || reason === 'page-switch')) return true;

    const path = canSaveLocal ? activeLocalFilePath! : undefined;
    const currentSnapshot = writeProject(currentProject);
    const lastSaved = lastSavedSnapshotRef.current;
    const isDirty = !(lastSaved?.adapter === storageAdapter && lastSaved.path === path && sameDocument(lastSaved.snapshot, currentSnapshot));

    if (!isDirty && !pendingRef.current) {
      hasUnsavedRef.current = false;
      updateSaveStatus('saved');
      if (reason === 'manual') showToast(savedMessage);
      return true;
    }

    const projectToSave = isDirty ? { ...currentProject, updatedAt: Date.now() } : currentProject;
    try {
      await saveActiveProject(projectToSave, path);
      if (reason === 'manual') showToast(savedMessage);
      return true;
    } catch (error) {
      if (canSaveLocal) reportStorageError(error, `save-${reason}`, saveFailedMessage, currentProject.id, activeLocalFilePath);
      else reportStorageError(error, `save-${reason}`, saveFailedMessage, currentProject.id);
      return false;
    }
  }, [
    cancelPendingSave,
    activeLocalFilePath,
    isTauri,
    storageAdapter,
    saveActiveProject,
    showToast,
    savedMessage,
    reportStorageError,
    saveFailedMessage,
    updateSaveStatus
  ]);

  const performAutoSave = useCallback((reason: SaveReason) => {
    void flushSave(reason);
  }, [flushSave]);

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
    latestProjectRef.current = project;
    const canSaveLocal = Boolean(activeLocalFilePath && isTauri);
    const path = canSaveLocal ? activeLocalFilePath! : undefined;

    if (!project) {
      cancelPendingSave();
      lastSavedProjectIdRef.current = null;
      lastSavedSnapshotRef.current = null;
      lastObservedSnapshotRef.current = null;
      prevActivePageIdRef.current = null;
      prevAdapterRef.current = storageAdapter;
      hasUnsavedRef.current = false;
      updateSaveStatus('saved');
      return;
    }

    const currentSnapshot = writeProject(project);

    if (lastSavedProjectIdRef.current !== project.id) {
      cancelPendingSave();
      lastSavedProjectIdRef.current = project.id;
      lastSavedSnapshotRef.current = { adapter: storageAdapter, path, snapshot: currentSnapshot };
      lastObservedSnapshotRef.current = currentSnapshot;
      prevActivePageIdRef.current = project.activePageId ?? null;
      prevAdapterRef.current = storageAdapter;
      hasUnsavedRef.current = false;
      updateSaveStatus('saved');
      return;
    }

    const adapterChanged = prevAdapterRef.current !== storageAdapter;
    prevAdapterRef.current = storageAdapter;

    const lastSaved = lastSavedSnapshotRef.current;
    const isDirty = !(lastSaved && lastSaved.adapter === storageAdapter && lastSaved.path === path && sameDocument(lastSaved.snapshot, currentSnapshot));
    const pageSwitched = prevActivePageIdRef.current !== (project.activePageId ?? null);
    prevActivePageIdRef.current = project.activePageId ?? null;
    const contentEdited = !sameDocument(lastObservedSnapshotRef.current, currentSnapshot);
    lastObservedSnapshotRef.current = currentSnapshot;

    if (!isDirty) {
      cancelPendingSave();
      hasUnsavedRef.current = false;
      if (!pendingRef.current && saveStatusRef.current !== 'saved') {
        updateSaveStatus('saved');
      }
      return;
    }

    hasUnsavedRef.current = true;
    if (!pendingRef.current && (contentEdited || adapterChanged || saveStatusRef.current === 'saved')) {
      updateSaveStatus('unsaved');
    }

    if (view !== 'editor' || isCloudMode || canSaveLocal) return;

    if (pageSwitched || adapterChanged) {
      cancelPendingSave();
      void flushSave(pageSwitched ? 'page-switch' : 'auto');
      return;
    }

    if (contentEdited || (saveTimerRef.current === null && !pendingRef.current)) {
      cancelPendingSave();
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushSave('auto');
      }, idleDelayMs);
    }
  }, [
    project,
    view,
    storageAdapter,
    isCloudMode,
    isTauri,
    activeLocalFilePath,
    idleDelayMs,
    cancelPendingSave,
    flushSave,
    updateSaveStatus
  ]);

  useEffect(() => {
    if (prevViewRef.current === 'editor' && view !== 'editor') {
      cancelPendingSave();
      void flushSave('leave');
      clearActiveLocalFilePath();
    }
    prevViewRef.current = view;
  }, [view, cancelPendingSave, flushSave, clearActiveLocalFilePath]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedRef.current && !pendingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const hasUnsavedChanges = saveStatus === 'unsaved' || saveStatus === 'error' || saveStatus === 'saving';

  return {
    saveStatus,
    hasUnsavedChanges,
    lastSavedAt,
    performAutoSave,
    flushSave,
    persistProject,
    saveActiveProject,
    markProjectSaved,
    latestProjectRef,
    cancelPendingSave
  };
}