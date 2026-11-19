import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ProjectPage, ProjectState } from '../types.ts';
import { selectProjectPage } from '../utils/projectPages.ts';
import { clonePlainData } from '../utils/clonePlainData.ts';

const pageSnapshots = new WeakMap<ProjectPage, ProjectPage>();
const cloneProject = (project: ProjectState): ProjectState => {
  if (!project.pages) return clonePlainData(project);
  const pages = project.pages.map(page => {
    let snapshot = pageSnapshots.get(page);
    if (!snapshot) {
      snapshot = clonePlainData(page);
      pageSnapshots.set(page, snapshot);
      pageSnapshots.set(snapshot, snapshot);
    }
    return snapshot;
  });
  const active = pages.find(page => page.id === project.activePageId) ?? pages[0];
  return { ...project, pages, layers: active.layers, pageInfo: active.pageInfo };
};

const sameContent = (left: ProjectState | undefined, right: ProjectState) => {
  if (!left) return false;
  if (!left.pages || !right.pages) return JSON.stringify(left) === JSON.stringify(right);
  return left.id === right.id && left.title === right.title && left.version === right.version && left.pages.length === right.pages.length && left.pages.every((page, index) => page === right.pages![index]);
};

export interface AiProjectHistory {
  begin: (project?: ProjectState | null) => symbol | null;
  isValid: (token: symbol) => boolean;
  setRunning: (token: symbol, running: boolean) => void;
  commit: (project: ProjectState) => void;
  restore: (token: symbol) => ProjectState | null;
  clear: () => void;
}

export function useProjectHistory(project: ProjectState | null, setProject: Dispatch<SetStateAction<ProjectState | null>>) {
  const [history, setHistory] = useState<ProjectState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoRedoAction = useRef(false);
  const ignoreHistoryChange = useRef(false);
  const checkpoint = useRef<{ token: symbol; snapshot: ProjectState; expected: ProjectState; running: boolean } | null>(null);
  const [, refreshCheckpoint] = useState(0);
  const clearCheckpoint = useCallback(() => {
    if (!checkpoint.current) return;
    checkpoint.current = null;
    refreshCheckpoint(version => version + 1);
  }, []);
  const isCheckpointValid = (token: symbol) => {
    const current = checkpoint.current;
    return Boolean(current?.token === token && project && sameContent(cloneProject(current.expected), cloneProject(project)));
  };
  useLayoutEffect(() => {
    if (checkpoint.current && !isCheckpointValid(checkpoint.current.token)) clearCheckpoint();
  }, [project]);
  useEffect(() => () => { checkpoint.current = null; }, []);

  const aiHistory: AiProjectHistory = {
    begin: (source = project) => {
      if (!source) { clearCheckpoint(); return null; }
      const snapshot = cloneProject(source);
      const cached = history[historyIndex];
      const token = Symbol('ai-turn');
      checkpoint.current = { token, snapshot: sameContent(cached, snapshot) ? cached : snapshot, expected: source, running: true };
      refreshCheckpoint(version => version + 1);
      return token;
    },
    isValid: isCheckpointValid,
    setRunning: (token, running) => { if (checkpoint.current?.token === token) checkpoint.current.running = running; },
    commit: next => {
      if (checkpoint.current?.running && checkpoint.current.expected.id === next.id) checkpoint.current.expected = next;
      else clearCheckpoint();
      setProject(next);
    },
    restore: token => {
      if (!isCheckpointValid(token)) { clearCheckpoint(); return null; }
      const restored = cloneProject(checkpoint.current!.snapshot);
      clearCheckpoint();
      return restored;
    },
    clear: clearCheckpoint
  };

  const initProjectHistory = useCallback((nextProject: ProjectState) => {
    clearCheckpoint();
    setHistory([cloneProject(nextProject)]);
    setHistoryIndex(0);
  }, [clearCheckpoint]);

  const saveHistorySnapshot = () => {
    if (!project) return;
    ignoreHistoryChange.current = false;
    const snapshot = cloneProject(project);
    if (sameContent(history[historyIndex], snapshot)) return;
    const nextHistory = [...history.slice(0, historyIndex + 1), snapshot].slice(-50);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  };

  useEffect(() => {
    if (!isUndoRedoAction.current && !ignoreHistoryChange.current) saveHistorySnapshot();
    isUndoRedoAction.current = false;
    ignoreHistoryChange.current = false;
  }, [project]);

  const modifyProject = (modifier: (current: ProjectState) => ProjectState, saveToHistory = true) => {
    if (!saveToHistory) ignoreHistoryChange.current = true;
    setProject(current => current ? modifier(current) : null);
  };

  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;
    clearCheckpoint();
    isUndoRedoAction.current = true;
    setProject(current => {
      const restored = cloneProject(history[historyIndex - 1]);
      return current?.activePageId && restored.pages?.some(page => page.id === current.activePageId) ? selectProjectPage(restored, current.activePageId) : restored;
    });
    setHistoryIndex(historyIndex - 1);
  }, [history, historyIndex, setProject, clearCheckpoint]);

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    clearCheckpoint();
    isUndoRedoAction.current = true;
    setProject(current => {
      const restored = cloneProject(history[historyIndex + 1]);
      return current?.activePageId && restored.pages?.some(page => page.id === current.activePageId) ? selectProjectPage(restored, current.activePageId) : restored;
    });
    setHistoryIndex(historyIndex + 1);
  }, [history, historyIndex, setProject, clearCheckpoint]);

  return { initProjectHistory, modifyProject, saveHistorySnapshot, handleUndo, handleRedo, aiHistory,
    canUndo: historyIndex > 0, canRedo: historyIndex < history.length - 1 };
}