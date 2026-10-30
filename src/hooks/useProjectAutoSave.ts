import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ProjectState } from '../types.ts';
import type { StorageAdapter } from '../storage/StorageAdapter.ts';
import { writeProject } from '../storage/projectCompatibility.ts';

const projectSnapshot = (project: ProjectState) => JSON.stringify(writeProject(project));

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
  const lastSavedSnapshotRef = useRef('');
  const lastSavedProjectIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const latestProjectRef = useRef<ProjectState | null>(null);
  const prevViewRef = useRef(view);

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current === null) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }, []);

  useEffect(() => {
    latestProjectRef.current = project;
    if (!project) {
      lastSavedProjectIdRef.current = null;
      lastSavedSnapshotRef.current = '';
      return;
    }
    if (lastSavedProjectIdRef.current !== project.id) {
      lastSavedProjectIdRef.current = project.id;
      lastSavedSnapshotRef.current = projectSnapshot(project);
    }
  }, [project]);

  const performAutoSave = useCallback((reason: 'auto' | 'leave' | 'manual') => {
    const canSaveLocal = Boolean(activeLocalFilePath && isTauri);
    if (!storageReadyRef.current && !canSaveLocal) return;
    const currentProject = latestProjectRef.current;
    if (!currentProject) return;
    const snapshot = projectSnapshot(currentProject);
    if (snapshot === lastSavedSnapshotRef.current) return;

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

    if (canSaveLocal) {
      saveLocalProjectToFile(activeLocalFilePath!, currentProject).then(nextProject => {
        lastSavedAtRef.current = Date.now();
        lastSavedProjectIdRef.current = nextProject.id;
        lastSavedSnapshotRef.current = projectSnapshot(nextProject);
        if (reason === 'manual') showToast(savedMessage);
      }).catch(error => {
        reportStorageError(error, `save-${reason}`, saveFailedMessage, currentProject.id, activeLocalFilePath);
      });
      return;
    }

    storageAdapter.saveProject(currentProject).then(() => {
      lastSavedAtRef.current = Date.now();
      lastSavedProjectIdRef.current = currentProject.id;
      lastSavedSnapshotRef.current = snapshot;
      if (reason === 'manual') showToast(savedMessage);
    }).catch(error => {
      reportStorageError(error, `save-${reason}`, saveFailedMessage, currentProject.id);
    });
  }, [activeLocalFilePath, isTauri, storageReadyRef, saveLocalProjectToFile, storageAdapter, showToast, reportStorageError, savedMessage, saveFailedMessage]);

  const persistProject = useCallback(async (nextProject: ProjectState) => {
    try {
      await storageAdapter.saveProject(nextProject);
      lastSavedProjectIdRef.current = nextProject.id;
      lastSavedSnapshotRef.current = projectSnapshot(nextProject);
    } catch (error) {
      reportStorageError(error, 'persist-project', saveFailedMessage, nextProject.id);
    }
  }, [storageAdapter, reportStorageError, saveFailedMessage]);

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

  return { performAutoSave, persistProject, latestProjectRef, cancelPendingSave };
}