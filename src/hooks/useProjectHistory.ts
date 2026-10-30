import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ProjectPage, ProjectState } from '../types.ts';
import { selectProjectPage } from '../utils/projectPages.ts';

const pageSnapshots = new WeakMap<ProjectPage, ProjectPage>();
const cloneProject = (project: ProjectState): ProjectState => {
  if (!project.pages) return JSON.parse(JSON.stringify(project));
  const pages = project.pages.map(page => {
    let snapshot = pageSnapshots.get(page);
    if (!snapshot) {
      snapshot = structuredClone(page);
      pageSnapshots.set(page, snapshot);
      pageSnapshots.set(snapshot, snapshot);
    }
    return snapshot;
  });
  const active = pages.find(page => page.id === project.activePageId) ?? pages[0];
  return { ...project, pages, layers: active.layers, background: active.background, canvasConfig: active.canvasConfig };
};

const sameContent = (left: ProjectState | undefined, right: ProjectState) => {
  if (!left) return false;
  if (!left.pages || !right.pages) return JSON.stringify(left) === JSON.stringify(right);
  return left.id === right.id && left.title === right.title && left.version === right.version && left.pages.length === right.pages.length && left.pages.every((page, index) => page === right.pages![index]);
};

export function useProjectHistory(project: ProjectState | null, setProject: Dispatch<SetStateAction<ProjectState | null>>) {
  const [history, setHistory] = useState<ProjectState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoRedoAction = useRef(false);
  const ignoreHistoryChange = useRef(false);

  const initProjectHistory = useCallback((nextProject: ProjectState) => {
    setHistory([cloneProject(nextProject)]);
    setHistoryIndex(0);
  }, []);

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
    isUndoRedoAction.current = true;
    setProject(current => {
      const restored = cloneProject(history[historyIndex - 1]);
      return current?.activePageId && restored.pages?.some(page => page.id === current.activePageId) ? selectProjectPage(restored, current.activePageId) : restored;
    });
    setHistoryIndex(historyIndex - 1);
  }, [history, historyIndex, setProject]);

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    isUndoRedoAction.current = true;
    setProject(current => {
      const restored = cloneProject(history[historyIndex + 1]);
      return current?.activePageId && restored.pages?.some(page => page.id === current.activePageId) ? selectProjectPage(restored, current.activePageId) : restored;
    });
    setHistoryIndex(historyIndex + 1);
  }, [history, historyIndex, setProject]);

  return { initProjectHistory, modifyProject, saveHistorySnapshot, handleUndo, handleRedo,
    canUndo: historyIndex > 0, canRedo: historyIndex < history.length - 1 };
}