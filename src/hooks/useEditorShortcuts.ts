import { useEffect } from 'react';
import type { Layer, ProjectState } from '../types.ts';

type EditorShortcutOptions = {
  view: 'landing' | 'editor';
  project: ProjectState | null;
  aiBusy: boolean;
  selectedLayerIds: string[];
  handleUndo: () => void;
  handleRedo: () => void;
  performAutoSave: (reason: 'auto' | 'manual' | 'leave') => void;
  modifyProject: (modifier: (project: ProjectState) => ProjectState, record?: boolean) => void;
  updateLayer: (id: string, updates: Partial<Layer>, record?: boolean) => void;
  handleDeleteLayers: (ids: string[]) => void;
  handleCloneLayers: (ids: string[]) => void;
  handleGroupLayers: (ids: string[]) => void;
  addSvgLayerWithContent: (content: string) => void;
  addImageLayerWithContent: (content: string) => void;
  addTextLayerWithContent: (content: string) => void;
  applyProjectFromJson: (data: Partial<ProjectState>) => void;
};

export function useEditorShortcuts({ view, project, aiBusy, selectedLayerIds, handleUndo, handleRedo,
  performAutoSave, modifyProject, updateLayer, handleDeleteLayers, handleCloneLayers, handleGroupLayers,
  addSvgLayerWithContent, addImageLayerWithContent, addTextLayerWithContent, applyProjectFromJson }: EditorShortcutOptions) {
  useEffect(() => {
    if (view !== 'editor' || !project) return;

    const readFileAsText = (file: File) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });

    const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    const handlePaste = async (e: ClipboardEvent) => {
      if (aiBusy) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const clipboard = e.clipboardData;
      if (!clipboard) return;

      const files = Array.from(clipboard.files || []);
      if (files.length > 0) {
        e.preventDefault();
        for (const file of files) {
          if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
            const text = await readFileAsText(file);
            addSvgLayerWithContent(text);
          } else if (file.type.startsWith('image/')) {
            const dataUrl = await readFileAsDataUrl(file);
            addImageLayerWithContent(dataUrl);
          }
        }
        return;
      }

      const text = clipboard.getData('text/plain');
      if (!text || !text.trim()) return;

      const trimmed = text.trim();

      if (trimmed.toLowerCase().startsWith('<svg')) {
        e.preventDefault();
        addSvgLayerWithContent(trimmed);
        return;
      }

      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && (parsed.layers || parsed.background || parsed.canvasConfig)) {
            e.preventDefault();
            applyProjectFromJson(parsed as ProjectState);
            return;
          }
        } catch (err) {}
      }

      e.preventDefault();
      addTextLayerWithContent(trimmed);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [view, project, aiBusy, addSvgLayerWithContent, addImageLayerWithContent, addTextLayerWithContent, applyProjectFromJson]);

  useEffect(() => {
    if (view !== 'editor' || !project) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (aiBusy || (e.target as HTMLElement).closest('.cf-ai-panel')) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // 保存（Ctrl+S / Cmd+S）
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        performAutoSave('manual');
        return;
      }

      // 撤销/重做
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        if (selectedLayerIds.length > 1) {
          e.preventDefault();
          handleGroupLayers(selectedLayerIds);
        }
        return;
      }

      if (!project || !project.selectedLayerId) return;

      const layer = project.layers.find(l => l.id === project.selectedLayerId);
      if (!layer || layer.locked) return;

      // 回车：激活文字编辑
      if (e.key === 'Enter') {
        if (layer.type === 'text') {
          e.preventDefault();
          const textarea = document.querySelector('textarea');
          if (textarea) textarea.focus();
          return;
        }
      }

      // 删除/退格
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedLayerIds.length > 1) handleDeleteLayers(selectedLayerIds);
        else handleDeleteLayers([project.selectedLayerId]);
        return;
      }

      // 组合按键（Ctrl + 方向键）
      if (e.ctrlKey || e.metaKey) {
        // 层级调整
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          modifyProject(p => {
            const index = p.layers.findIndex(l => l.id === project.selectedLayerId);
            const newLayers = [...p.layers];
            if (e.key === 'ArrowUp' && index < newLayers.length - 1) {
              [newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]];
            } else if (e.key === 'ArrowDown' && index > 0) {
              [newLayers[index], newLayers[index - 1]] = [newLayers[index - 1], newLayers[index]];
            }
            return { ...p, layers: newLayers.map((l, i) => ({ ...l, zIndex: i + 1 })) };
          });
          return;
        }

        // 旋转调整
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const dr = e.key === 'ArrowLeft' ? -5 : 5;
          updateLayer(project.selectedLayerId, { rotation: (layer.rotation + dr) % 360 });
          return;
        }

        // 克隆（Ctrl+J）
        if (e.key.toLowerCase() === 'j') {
          e.preventDefault();
          if (selectedLayerIds.length > 1) handleCloneLayers(selectedLayerIds);
          else handleCloneLayers([project.selectedLayerId]);
          return;
        }
      }

      // 简单位移
      if (!e.ctrlKey && !e.metaKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        updateLayer(project.selectedLayerId, { x: layer.x + dx, y: layer.y + dy });
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [project, handleUndo, handleRedo, updateLayer, view, selectedLayerIds, handleDeleteLayers, handleCloneLayers, handleGroupLayers, performAutoSave, aiBusy, modifyProject]);

}
