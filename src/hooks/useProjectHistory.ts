import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ProjectState } from '../types.ts';

const cloneProject = (project: ProjectState): ProjectState => JSON.parse(JSON.stringify(project));

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
    if (JSON.stringify(history[historyIndex]) === JSON.stringify(project)) return;
    const nextHistory = [...history.slice(0, historyIndex + 1), cloneProject(project)].slice(-50);
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
    setProject(cloneProject(history[historyIndex - 1]));
    setHistoryIndex(historyIndex - 1);
  }, [history, historyIndex, setProject]);

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    isUndoRedoAction.current = true;
    setProject(cloneProject(history[historyIndex + 1]));
    setHistoryIndex(historyIndex + 1);
  }, [history, historyIndex, setProject]);

  return { initProjectHistory, modifyProject, saveHistorySnapshot, handleUndo, handleRedo,
    canUndo: historyIndex > 0, canRedo: historyIndex < history.length - 1 };
}