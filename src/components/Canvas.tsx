// 模块：画布渲染与交互（拖拽、缩放、对齐）
import React, { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Layer, ProjectState } from '../types.ts';
import { applySvgAspectRatio } from '../utils/helpers.ts';
import { buildBackgroundStyles } from '../utils/backgroundStyles.ts';
import { updateProjectLayer } from '../features/ai/domain/layerOperations.ts';
import { applyKeyboardLayerTransform, COMMIT_KEYBOARD_LAYER_TRANSFORM, KEYBOARD_LAYER_TRANSFORM, type KeyboardLayerTransform } from '../utils/keyboardLayerTransform.ts';
import { PANEL_LAYER_DRAFT, type PanelLayerDraft } from '../utils/panelLayerDraft.ts';
import { applyCanvasLayerUpdates, boundsOfLayers, rootSelectionIds, selectionBounds, type CanvasLayerUpdate } from '../utils/canvasLayerTransform.ts';
import DecorationContent from './DecorationContent.tsx';
import ImageLayerContent from './ImageLayerContent.tsx';
import { translations, Language } from '../translations.ts';
import { RotateCw } from 'lucide-react';

interface Guideline {
  type: 'h' | 'v';
  pos: number;
}

interface CanvasProps {
  lang: Language;
  project: ProjectState;
  selectedLayerIds?: string[];
  onSelectLayer: (
    id: string | null,
    mode?: 'replace' | 'toggle' | 'range' | 'range-add',
    orderedIds?: string[]
  ) => void;
  updateLayer: (id: string, updates: Partial<Layer>, record?: boolean) => void;
  onKeyboardCommit: (modifier: (project: ProjectState) => ProjectState) => void;
  onCommit: () => void;
  onOpenImageCrop?: (layerId: string) => void;
}

const SNAP_THRESHOLD = 8;

// 画布交互与渲染组件。
const Canvas: React.FC<CanvasProps> = ({ lang, project: committedProject, selectedLayerIds = committedProject.selectedLayerId ? [committedProject.selectedLayerId] : [], onSelectLayer, updateLayer, onKeyboardCommit, onCommit, onOpenImageCrop }) => {
  const [draft, setDraft] = useState<{ pageKey: string; updates: CanvasLayerUpdate[] } | null>(null);
  const draftRef = useRef<typeof draft>(null);
  const [keyboardDraft, setKeyboardDraft] = useState<KeyboardLayerTransform | null>(null);
  const [panelDraft, setPanelDraft] = useState<PanelLayerDraft | null>(null);
  const keyboardDraftRef = useRef<KeyboardLayerTransform | null>(null);
  const keyboardKeysRef = useRef(new Set<string>());
  const committedPageKey = `${committedProject.id}:${committedProject.activePageId ?? ''}`;
  const keyboardProject = keyboardDraft ? applyKeyboardLayerTransform(committedProject, keyboardDraft) : committedProject;
  const panelProject = panelDraft?.pageKey === committedPageKey && keyboardProject.layers.some(layer => layer.id === panelDraft.layerId)
    ? updateProjectLayer(keyboardProject, panelDraft.layerId, panelDraft.updates) : keyboardProject;
  const project = draft?.pageKey === committedPageKey
    ? applyCanvasLayerUpdates(panelProject, draft.updates)
    : panelProject;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fittedPageKeyRef = useRef<string | null>(null);
  const pageKey = `${project.id}:${project.activePageId ?? ''}`;
  const [zoom, setZoom] = useState(0.8);
  const [guidelines, setGuidelines] = useState<Guideline[]>([]);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const textEditRef = useRef<HTMLTextAreaElement | null>(null);
  const lastEditIdRef = useRef<string | null>(null);
  const t = translations[lang];

  // 鼠标交互状态：用于拖拽、缩放、旋转
  const [interaction, setInteraction] = useState<{
    type: 'move' | 'resize' | 'rotate';
    layerId: string;
    layerIds: string[];
    startX: number;
    startY: number;
    initialData: { x: number; y: number; w: number; h: number; rotation: number };
    initialLayers: Record<string, { x: number; y: number; w: number; h: number; rotation: number }>;
    handle?: string;
  } | null>(null);

  const fitCanvas = useCallback(() => {
    const container = scrollContainerRef.current;
    const content = container?.firstElementChild;
    if (!container || !content) return false;
    const padding = getComputedStyle(content);
    const availableWidth = container.offsetWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
    const availableHeight = container.offsetHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom);
    if (availableWidth <= 0 || availableHeight <= 0 || project.pageInfo.width <= 0 || project.pageInfo.height <= 0) return false;
    setZoom(Math.max(0.05, Math.min(5, availableWidth / project.pageInfo.width, availableHeight / project.pageInfo.height)));
    container.scrollLeft = 0;
    container.scrollTop = 0;
    return true;
  }, [project.pageInfo.width, project.pageInfo.height]);

  useLayoutEffect(() => {
    if (fittedPageKeyRef.current === pageKey) return;
    draftRef.current = null;
    setDraft(null);
    setPanelDraft(null);
    keyboardDraftRef.current = null;
    keyboardKeysRef.current.clear();
    setKeyboardDraft(null);
    setInteraction(null);
    setGuidelines([]);
    setEditingLayerId(null);
    lastEditIdRef.current = null;
    if (fitCanvas()) fittedPageKeyRef.current = pageKey;
  }, [pageKey, fitCanvas]);

  useEffect(() => {
    const update = (event: Event) => setPanelDraft((event as CustomEvent<PanelLayerDraft | null>).detail);
    window.addEventListener(PANEL_LAYER_DRAFT, update);
    return () => window.removeEventListener(PANEL_LAYER_DRAFT, update);
  }, []);

  useEffect(() => {
    const commit = () => {
      const current = keyboardDraftRef.current;
      if (!current) return;
      keyboardDraftRef.current = null;
      keyboardKeysRef.current.clear();
      flushSync(() => {
        setKeyboardDraft(null);
        if (current.dx || current.dy || current.rotation) onKeyboardCommit(project => applyKeyboardLayerTransform(project, current));
      });
    };
    const transform = (event: Event) => {
      const next = (event as CustomEvent<KeyboardLayerTransform>).detail;
      let current = keyboardDraftRef.current;
      if (current && (current.projectId !== next.projectId || current.pageId !== next.pageId ||
        Boolean(current.rotation) !== Boolean(next.rotation) || current.layerIds.join('\0') !== next.layerIds.join('\0'))) {
        commit();
        current = null;
      }
      const combined = current ? { ...current, dx: current.dx + next.dx, dy: current.dy + next.dy, rotation: current.rotation + next.rotation } : next;
      keyboardKeysRef.current.add(next.key);
      keyboardDraftRef.current = combined;
      setKeyboardDraft(combined);
    };
    const keyup = (event: KeyboardEvent) => {
      keyboardKeysRef.current.delete(event.key);
      if (!keyboardKeysRef.current.size) commit();
    };
    const commitRequested = (event: Event) => {
      if (!keyboardDraftRef.current) return;
      event.preventDefault();
      commit();
    };
    window.addEventListener(KEYBOARD_LAYER_TRANSFORM, transform);
    window.addEventListener(COMMIT_KEYBOARD_LAYER_TRANSFORM, commitRequested);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', commit);
    window.addEventListener('mousedown', commit, true);
    window.addEventListener('beforeunload', commit, true);
    return () => {
      window.removeEventListener(KEYBOARD_LAYER_TRANSFORM, transform);
      window.removeEventListener(COMMIT_KEYBOARD_LAYER_TRANSFORM, commitRequested);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', commit);
      window.removeEventListener('mousedown', commit, true);
      window.removeEventListener('beforeunload', commit, true);
    };
  }, [onKeyboardCommit]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoom(prev => Math.min(Math.max(0.05, prev - e.deltaY * 0.001), 5));
      }
    };
    const ref = scrollContainerRef.current;
    ref?.addEventListener('wheel', handleWheel, { passive: false });
    return () => ref?.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    if (!editingLayerId) return;
    if (lastEditIdRef.current === editingLayerId) return;
    const layer = project.layers.find(l => l.id === editingLayerId);
    if (!layer || layer.type !== 'text') return;
    lastEditIdRef.current = editingLayerId;
    setEditingValue(prev => (prev === layer.content ? prev : layer.content));
    requestAnimationFrame(() => {
      textEditRef.current?.focus();
      textEditRef.current?.select();
    });
  }, [editingLayerId, project.layers]);

  useEffect(() => {
    if (!editingLayerId) return;
    if (project.selectedLayerId !== editingLayerId) setEditingLayerId(null);
  }, [editingLayerId, project.selectedLayerId]);

  useEffect(() => {
    if (editingLayerId) return;
    lastEditIdRef.current = null;
  }, [editingLayerId]);

  const handleLayerMouseDown = (e: React.MouseEvent, layer: Layer) => {
    if (layer.locked) return;
    e.stopPropagation();
    if (editingLayerId === layer.id) return;
    if (editingLayerId && editingLayerId !== layer.id) setEditingLayerId(null);
    if (e.ctrlKey || e.metaKey) {
      onSelectLayer(layer.id, 'toggle');
      return;
    }
    if (e.shiftKey) {
      const orderedIds = [...project.layers].sort((a, b) => b.zIndex - a.zIndex).map(item => item.id);
      onSelectLayer(layer.id, 'range', orderedIds);
      return;
    }
    if (!selectedLayerIds.includes(layer.id)) onSelectLayer(layer.id);
    
    const layerIds = selectedLayerIds.includes(layer.id)
      ? rootSelectionIds(project, selectedLayerIds)
      : [layer.id];
    setInteraction({
      type: 'move',
      layerId: layer.id,
      layerIds: layerIds.length ? layerIds : [layer.id],
      startX: e.clientX,
      startY: e.clientY,
      initialData: { x: layer.x, y: layer.y, w: layer.width, h: layer.height, rotation: layer.rotation },
      initialLayers: Object.fromEntries(project.layers.filter(item => layerIds.includes(item.id)).map(item => [item.id, { x: item.x, y: item.y, w: item.width, h: item.height, rotation: item.rotation }]))
    });
  };

  const handleLayerDoubleClick = (e: React.MouseEvent, layer: Layer) => {
    if (layer.locked) return;
    if (layer.type === 'image' && onOpenImageCrop) {
      e.stopPropagation();
      onSelectLayer(layer.id);
      onOpenImageCrop(layer.id);
      return;
    }
    if (layer.type !== 'text') return;
    e.stopPropagation();
    onSelectLayer(layer.id);
    setEditingLayerId(layer.id);
    setEditingValue(layer.content);
  };

  const handleControlMouseDown = (e: React.MouseEvent, layer: Layer, type: 'resize' | 'rotate', handle?: string) => {
    e.stopPropagation();
    e.preventDefault();
    const layerIds = selectedLayerIds.length > 1 || selectedLayerIds.includes(layer.id)
      ? rootSelectionIds(project, selectedLayerIds)
      : [layer.id];
    setInteraction({
      type,
      layerId: layer.id,
      layerIds: layerIds.length ? layerIds : [layer.id],
      startX: e.clientX,
      startY: e.clientY,
      handle,
      initialData: { x: layer.x, y: layer.y, w: layer.width, h: layer.height, rotation: layer.rotation },
      initialLayers: Object.fromEntries(project.layers.filter(item => layerIds.includes(item.id)).map(item => [item.id, { x: item.x, y: item.y, w: item.width, h: item.height, rotation: item.rotation }]))
    });
  };

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (!interaction) return;

    const { type, startX, startY, initialData, handle } = interaction;
    const dx = (e.clientX - startX) / zoom;
    const dy = (e.clientY - startY) / zoom;

    if (type === 'move') {
      let nextX = initialData.x + dx;
      let nextY = initialData.y + dy;
      
      const activeGuidelines: Guideline[] = [];
      const movingLayer = project.layers.find(l => l.id === interaction.layerId);
      if (!movingLayer) return;
      const initialLayers = interaction.layerIds.map(layerId => interaction.initialLayers[layerId]).filter(Boolean);
      const initialBounds = boundsOfLayers(initialLayers.map(layer => ({ ...layer, width: layer.w, height: layer.h })));
      if (!initialBounds) return;
      const selectionLeft = initialBounds.x + dx;
      const selectionTop = initialBounds.y + dy;
      const selectionWidth = initialBounds.width;
      const selectionHeight = initialBounds.height;

      // 吸附目标：画布边缘与中心
      const targetsX = [0, project.pageInfo.width / 2, project.pageInfo.width];
      const targetsY = [0, project.pageInfo.height / 2, project.pageInfo.height];
      const movingIds = new Set(interaction.layerIds);
      interaction.layerIds.forEach(id => {
        project.layers.find(layer => layer.id === id)?.children?.forEach(childId => movingIds.add(childId));
      });

      // 吸附目标：其他图层
      project.layers.forEach(l => {
        if (movingIds.has(l.id) || !l.visible || l.type === 'group') return;
        targetsX.push(l.x, l.x + l.width / 2, l.x + l.width);
        targetsY.push(l.y, l.y + l.height / 2, l.y + l.height);
      });

      // 水平吸附
      let snappedX = false;
      for (const tx of targetsX) {
        // 源点：组合左、中、右
        const sources = [selectionLeft, selectionLeft + selectionWidth / 2, selectionLeft + selectionWidth];
        for (let i = 0; i < sources.length; i++) {
          if (Math.abs(sources[i] - tx) < SNAP_THRESHOLD) {
            nextX = initialData.x + tx - sources[i] + dx;
            activeGuidelines.push({ type: 'v', pos: tx });
            snappedX = true;
            break;
          }
        }
        if (snappedX) break;
      }

      // 垂直吸附
      let snappedY = false;
      for (const ty of targetsY) {
        // 源点：组合上、中、下
        const sources = [selectionTop, selectionTop + selectionHeight / 2, selectionTop + selectionHeight];
        for (let i = 0; i < sources.length; i++) {
          if (Math.abs(sources[i] - ty) < SNAP_THRESHOLD) {
            nextY = initialData.y + ty - sources[i] + dy;
            activeGuidelines.push({ type: 'h', pos: ty });
            snappedY = true;
            break;
          }
        }
        if (snappedY) break;
      }

      setGuidelines(activeGuidelines);
      const offsetX = nextX - initialData.x;
      const offsetY = nextY - initialData.y;
      const updates = interaction.layerIds.map(layerId => {
        const initial = interaction.initialLayers[layerId] ?? initialData;
        return { layerId, updates: { x: initial.x + offsetX, y: initial.y + offsetY } };
      });
      const next = { pageKey, updates };
      draftRef.current = next;
      setDraft(next);
      return;
    }

    // 旋转：以图层中心为圆心计算角度
    if (type === 'rotate') {
      const canvasRect = document.getElementById('export-target')?.getBoundingClientRect();
      if (!canvasRect) return;
      const cx = initialData.x + initialData.w / 2;
      const cy = initialData.y + initialData.h / 2;
      const screenCx = canvasRect.left + (cx * zoom);
      const screenCy = canvasRect.top + (cy * zoom);
      const angle = Math.atan2(e.clientY - screenCy, e.clientX - screenCx) * (180 / Math.PI);
      let newRotation = angle + 90; 
      if (e.shiftKey) newRotation = Math.round(newRotation / 15) * 15;
      const rotationDelta = newRotation - initialData.rotation;
      const radians = rotationDelta * Math.PI / 180;
      const selected = interaction.layerIds.map(layerId => interaction.initialLayers[layerId]).filter(Boolean);
      const bounds = selected.length > 1 ? {
        left: Math.min(...selected.map(layer => layer.x)),
        top: Math.min(...selected.map(layer => layer.y)),
        right: Math.max(...selected.map(layer => layer.x + layer.w)),
        bottom: Math.max(...selected.map(layer => layer.y + layer.h))
      } : null;
      const centerX = bounds ? (bounds.left + bounds.right) / 2 : cx;
      const centerY = bounds ? (bounds.top + bounds.bottom) / 2 : cy;
      const updates = interaction.layerIds.map(layerId => {
        const initial = interaction.initialLayers[layerId] ?? initialData;
        const relativeX = initial.x + initial.w / 2 - centerX;
        const relativeY = initial.y + initial.h / 2 - centerY;
        const nextCenterX = centerX + relativeX * Math.cos(radians) - relativeY * Math.sin(radians);
        const nextCenterY = centerY + relativeX * Math.sin(radians) + relativeY * Math.cos(radians);
        return { layerId, updates: {
          x: nextCenterX - initial.w / 2,
          y: nextCenterY - initial.h / 2,
          rotation: initial.rotation + rotationDelta
        } };
      });
      const next = { pageKey, updates };
      draftRef.current = next;
      setDraft(next);
      return;
    }

    // 缩放：转换到图层本地坐标系
    if (type === 'resize' && handle) {
      const rad = initialData.rotation * (Math.PI / 180);
      const cos = Math.cos(-rad);
      const sin = Math.sin(-rad);
      let localDx = dx * cos - dy * sin;
      let localDy = dx * sin + dy * cos;
      const isCorner = ['ne', 'nw', 'se', 'sw'].includes(handle);
      const layer = project.layers.find(l => l.id === interaction.layerId);
      const ratioLocked = e.shiftKey || (layer?.ratioLocked && isCorner);
      
      if (ratioLocked && initialData.w > 0 && initialData.h > 0) {
        const ratio = initialData.w / initialData.h;
        if (handle === 'se' || handle === 'nw') localDy = localDx / ratio;
        else if (handle === 'sw' || handle === 'ne') localDy = -localDx / ratio;
      }

      let dW = 0, dH = 0, dX = 0, dY = 0;
      if (handle.includes('e')) { dW = localDx; }
      if (handle.includes('w')) { dW = -localDx; dX = localDx; }
      if (handle.includes('s')) { dH = localDy; }
      if (handle.includes('n')) { dH = -localDy; dY = localDy; }

      let newW = Math.max(10, initialData.w + dW);
      let newH = Math.max(10, initialData.h + dH);

      // 旋转后中心点位移回推到画布坐标
      const unrotatedCenterXChange = dX + dW / 2;
      const unrotatedCenterYChange = dY + dH / 2;
      const rotatedCenterXChange = unrotatedCenterXChange * Math.cos(rad) - unrotatedCenterYChange * Math.sin(rad);
      const rotatedCenterYChange = unrotatedCenterXChange * Math.sin(rad) + unrotatedCenterYChange * Math.cos(rad);
      const newCenterX = (initialData.x + initialData.w / 2) + rotatedCenterXChange;
      const newCenterY = (initialData.y + initialData.h / 2) + rotatedCenterYChange;

      if (interaction.layerIds.length === 1) {
        const next = { pageKey, updates: [{ layerId: interaction.layerId, updates: { x: newCenterX - newW / 2, y: newCenterY - newH / 2, width: newW, height: newH } }] };
        draftRef.current = next;
        setDraft(next);
        return;
      }

      const scaleX = newW / initialData.w;
      const scaleY = newH / initialData.h;
      const selected = interaction.layerIds.map(layerId => interaction.initialLayers[layerId]).filter(Boolean);
      const left = Math.min(...selected.map(item => item.x));
      const top = Math.min(...selected.map(item => item.y));
      const right = Math.max(...selected.map(item => item.x + item.w));
      const bottom = Math.max(...selected.map(item => item.y + item.h));
      const anchorX = handle.includes('w') ? right : handle.includes('e') ? left : (left + right) / 2;
      const anchorY = handle.includes('n') ? bottom : handle.includes('s') ? top : (top + bottom) / 2;
      const updates = interaction.layerIds.map(layerId => {
        const initial = interaction.initialLayers[layerId] ?? initialData;
        const width = Math.max(10, initial.w * scaleX);
        const height = Math.max(10, initial.h * scaleY);
        const x = anchorX + (initial.x - anchorX) * scaleX;
        const y = anchorY + (initial.y - anchorY) * scaleY;
        return { layerId, updates: { x, y, width, height } };
      });
      const next = { pageKey, updates };
      draftRef.current = next;
      setDraft(next);
    }
  }, [interaction, zoom, project.layers, project.pageInfo, pageKey]);

  const handleGlobalMouseUp = useCallback(() => {
    if (interaction) {
      const current = draftRef.current;
      if (current?.pageKey === pageKey && current.updates.length === 1) {
        const update = current.updates[0];
        updateLayer(update.layerId, update.updates, true);
      } else if (current?.pageKey === pageKey && current.updates.length > 1) {
        onKeyboardCommit(currentProject => applyCanvasLayerUpdates(currentProject, current.updates));
      }
      draftRef.current = null;
      setDraft(null);
      setInteraction(null);
      setGuidelines([]);
    }
  }, [interaction, pageKey, onKeyboardCommit, updateLayer]);

  useEffect(() => {
    if (interaction) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      window.addEventListener('blur', handleGlobalMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
        window.removeEventListener('blur', handleGlobalMouseUp);
      };
    }
  }, [interaction, handleGlobalMouseMove, handleGlobalMouseUp]);

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setEditingLayerId(null);
      onSelectLayer(null);
    }
  };

  return (
    <div className="flex-1 relative">
      <div 
        ref={scrollContainerRef}
        className="absolute inset-0 overflow-auto bg-slate-950 canvas-checkerboard"
        style={{ overflowAnchor: 'none', scrollBehavior: 'auto' }}
        onMouseDown={handleBackgroundClick}
      >
        <div 
          className="flex items-center justify-center min-w-full min-h-full p-16 md:p-32"
          onMouseDown={handleBackgroundClick}
        >
          <div 
            style={{
              width: project.pageInfo.width * zoom,
              height: project.pageInfo.height * zoom,
              overflow: 'clip',
              overflowClipMargin: '100px',
              flexShrink: 0
            }}
            className="relative"
          >
            <div 
              id="export-target"
              className="absolute top-0 left-0 bg-white shadow-[0_0_100px_rgba(0,0,0,0.5)] overflow-hidden"
              style={{
                width: project.pageInfo.width,
                height: project.pageInfo.height,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                ...buildBackgroundStyles(project.pageInfo.background),
                backfaceVisibility: 'hidden'
              }}
            >
            {project.layers
              .filter(l => l.visible && l.type !== 'group')
              .sort((a, b) => a.zIndex - b.zIndex)
              .map(layer => {
                const align = layer.textAlign || 'center';
                const textStyle: React.CSSProperties = {
                  fontSize: `${layer.fontSize || Math.max(12, layer.height * 0.7)}px`,
                  letterSpacing: `${layer.letterSpacing ?? 0}px`,
                  fontFamily: layer.fontFamily || 'Inter, sans-serif',
                  fontWeight: layer.fontWeight || 'bold',
                  wordBreak: 'break-word',
                  opacity: layer.opacity,
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
                  textAlign: align,
                  padding: '0 1rem',
                  lineHeight: layer.lineHeight ?? 1.1,
                  whiteSpace: 'pre-wrap',
                  pointerEvents: 'none',
                };

                if (layer.type === 'text' && layer.writingMode === 'vertical') {
                  textStyle.writingMode = 'vertical-rl';
                  textStyle.textOrientation = 'upright';
                  textStyle.padding = '1rem 0';
                }

                if (layer.type === 'text' && layer.textGradient?.enabled) {
                  textStyle.backgroundImage = `linear-gradient(${layer.textGradient.angle}deg, ${layer.textGradient.from}, ${layer.textGradient.to})`;
                  textStyle.WebkitBackgroundClip = 'text';
                  textStyle.WebkitTextFillColor = 'transparent';
                  textStyle.backgroundClip = 'text';
                  textStyle.color = 'transparent';
                } else if (layer.type === 'text' || layer.type === 'svg') {
                  textStyle.color = layer.color || '#ffffff';
                }

                if (layer.type === 'text' && layer.textShadow?.enabled) {
                  textStyle.textShadow = `${layer.textShadow.offsetX}px ${layer.textShadow.offsetY}px ${layer.textShadow.blur}px ${layer.textShadow.color}`;
                }

                return (
                  <div
                    key={layer.id}
                    onMouseDown={(e) => handleLayerMouseDown(e, layer)}
                    onDoubleClick={(e) => handleLayerDoubleClick(e, layer)}
                    className={`absolute select-none group ${selectedLayerIds.includes(layer.id) ? 'selected-layer' : ''}`}
                    style={{
                      left: layer.x,
                      top: layer.y,
                      width: layer.width,
                      height: layer.height,
                      transform: `rotate(${layer.rotation}deg)`,
                      zIndex: layer.zIndex,
                      pointerEvents: layer.locked ? 'none' : 'auto',
                      cursor: layer.locked ? 'default' : interaction ? 'grabbing' : 'move',
                      willChange: 'transform',
                      backfaceVisibility: 'hidden'
                    }}
                  >
                    {layer.type === 'svg' ? (
                      <div className="w-full h-full pointer-events-none overflow-hidden" style={{ color: layer.color }}>
                        {layer.content.toLowerCase().includes('<svg') ? (
                          <div
                            className="w-full h-full"
                            dangerouslySetInnerHTML={{ __html: applySvgAspectRatio(layer.content, !!layer.ratioLocked) }}
                          />
                        ) : (
                          <svg
                            width="100%"
                            height="100%"
                            viewBox="0 0 100 100"
                            preserveAspectRatio={layer.ratioLocked ? 'xMidYMid meet' : 'none'}
                            dangerouslySetInnerHTML={{ __html: layer.content }}
                          />
                        )}
                      </div>
                    ) : layer.type === 'text' ? (
                      editingLayerId === layer.id ? (
                        <textarea
                          ref={textEditRef}
                          value={editingValue}
                          onChange={(e) => {
                            setEditingValue(e.target.value);
                            updateLayer(layer.id, { content: e.target.value }, false);
                          }}
                          onBlur={() => {
                            setEditingLayerId(null);
                            onCommit();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditingLayerId(null);
                              onCommit();
                            }
                          }}
                          className="w-full h-full bg-transparent text-center resize-none outline-none border border-blue-500/60 shadow-[0_0_0_1px_rgba(59,130,246,0.4)]"
                          style={{
                            ...textStyle,
                            color: layer.color || '#ffffff',
                            backgroundImage: 'none',
                            WebkitTextFillColor: 'currentColor',
                            pointerEvents: 'auto',
                            display: 'block'
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div style={textStyle}>
                          {layer.content}
                        </div>
                      )
                    ) : layer.type === 'decoration' ? (
                      <div className="w-full h-full pointer-events-none" style={{ opacity: layer.opacity }}>
                        <DecorationContent content={layer.content} layers={project.layers} />
                      </div>
                    ) : (
                      <ImageLayerContent layer={layer} />
                    )}
                    {selectedLayerIds.length === 1 && selectedLayerIds.includes(layer.id) && (
                      <div className="absolute inset-0 border border-blue-500 pointer-events-none" style={{ willChange: 'transform', backfaceVisibility: 'hidden' }} />
                    )}
                    {selectedLayerIds.length === 1 && project.selectedLayerId === layer.id && selectedLayerIds.includes(layer.id) && !layer.locked && (
                      <>
                        <div className="absolute left-1/2 -top-8 -translate-x-1/2 flex flex-col items-center cursor-grab" onMouseDown={(e) => handleControlMouseDown(e, layer, 'rotate')}>
                          <div className="w-5 h-5 bg-white border border-blue-600 rounded-full flex items-center justify-center text-blue-600"><RotateCw className="w-3 h-3" /></div>
                          <div className="w-px h-3 bg-blue-600" />
                        </div>
                        {['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].map(h => {
                          const isN = h.includes('n');
                          const isS = h.includes('s');
                          const isW = h.includes('w');
                          const isE = h.includes('e');
                          return (
                            <div
                              key={h}
                              className="absolute w-2.5 h-2.5 bg-white border border-blue-600 rounded-full z-50 pointer-events-auto"
                              onMouseDown={(e) => handleControlMouseDown(e, layer, 'resize', h)}
                              style={{
                                top: isN ? 0 : isS ? '100%' : '50%',
                                left: isW ? 0 : isE ? '100%' : '50%',
                                transform: 'translate(-50%, -50%)',
                                cursor: `${h}-resize`,
                                backfaceVisibility: 'hidden'
                              }}
                            />
                          );
                        })}
                      </>
                    )}
                  </div>
                );
              })}

            {selectedLayerIds.length === 1 && project.layers
              .filter(layer => layer.type === 'group' && selectedLayerIds.includes(layer.id))
              .map(selectedGroup => (
                <div
                  key={`selected-group-${selectedGroup.id}`}
                  onMouseDown={(event) => handleLayerMouseDown(event, selectedGroup)}
                  className="absolute select-none selected-group"
                  style={{
                    left: selectedGroup.x,
                    top: selectedGroup.y,
                    width: selectedGroup.width,
                    height: selectedGroup.height,
                    transform: `rotate(${selectedGroup.rotation}deg)`,
                    zIndex: selectedGroup.id === project.selectedLayerId ? 9999 : 9998,
                    pointerEvents: selectedGroup.locked ? 'none' : 'auto',
                    cursor: interaction ? 'grabbing' : selectedGroup.locked ? 'default' : 'move'
                  }}
                >
                  <div className="absolute inset-0 border border-blue-400 border-dashed pointer-events-none" />
                  {selectedGroup.id === project.selectedLayerId && !selectedGroup.locked && (
                    <>
                      <div className="absolute left-1/2 -top-8 -translate-x-1/2 flex flex-col items-center cursor-grab" onMouseDown={(event) => handleControlMouseDown(event, selectedGroup, 'rotate')}>
                        <div className="w-5 h-5 bg-white border border-blue-600 rounded-full flex items-center justify-center text-blue-600"><RotateCw className="w-3 h-3" /></div>
                        <div className="w-px h-3 bg-blue-600" />
                      </div>
                      {['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].map(handle => {
                        const isN = handle.includes('n');
                        const isS = handle.includes('s');
                        const isW = handle.includes('w');
                        const isE = handle.includes('e');
                        return (
                          <div
                            key={handle}
                            className="absolute w-2.5 h-2.5 bg-white border border-blue-600 rounded-full z-50 pointer-events-auto"
                            onMouseDown={(event) => handleControlMouseDown(event, selectedGroup, 'resize', handle)}
                            style={{
                              top: isN ? 0 : isS ? '100%' : '50%',
                              left: isW ? 0 : isE ? '100%' : '50%',
                              transform: 'translate(-50%, -50%)',
                              cursor: `${handle}-resize`
                            }}
                          />
                        );
                      })}
                    </>
                  )}
                </div>
              ))}
            {(() => {
              if (selectedLayerIds.length < 2) return null;
              const bounds = selectionBounds(project, selectedLayerIds);
              if (!bounds) return null;
              const activeLayer = project.layers.find(layer => layer.id === project.selectedLayerId) ?? null;
              const selectionLayer: Layer = {
                id: '__multi-selection__', name: 'Selection', type: 'group', content: '',
                x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
                rotation: 0, zIndex: 9999, visible: true, locked: false, opacity: 1,
                children: rootSelectionIds(project, selectedLayerIds)
              };
              return (
                <div
                  className="absolute select-none multi-selection-box pointer-events-none"
                  style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height, zIndex: 9999 }}
                >
                  <div className="absolute inset-0 border border-blue-400 border-dashed pointer-events-none" />
                  {activeLayer && !activeLayer.locked && (
                    <>
                      <div className="absolute left-1/2 -top-8 -translate-x-1/2 flex flex-col items-center cursor-grab pointer-events-auto" onMouseDown={(event) => handleControlMouseDown(event, selectionLayer, 'rotate')}>
                        <div className="w-5 h-5 bg-white border border-blue-600 rounded-full flex items-center justify-center text-blue-600"><RotateCw className="w-3 h-3" /></div>
                        <div className="w-px h-3 bg-blue-600" />
                      </div>
                      {['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].map(handle => {
                        const isN = handle.includes('n');
                        const isS = handle.includes('s');
                        const isW = handle.includes('w');
                        const isE = handle.includes('e');
                        return (
                          <div
                            key={handle}
                            className="absolute w-2.5 h-2.5 bg-white border border-blue-600 rounded-full z-50 pointer-events-auto"
                            onMouseDown={(event) => handleControlMouseDown(event, selectionLayer, 'resize', handle)}
                            style={{
                              top: isN ? 0 : isS ? '100%' : '50%',
                              left: isW ? 0 : isE ? '100%' : '50%',
                              transform: 'translate(-50%, -50%)',
                              cursor: `${handle}-resize`
                            }}
                          />
                        );
                      })}
                    </>
                  )}
                </div>
              );
            })()}
            
            {/* 对齐参考线覆盖层 */}
            {guidelines.map((g, i) => (
              <div
                key={i}
                className="absolute pointer-events-none z-[100]"
                style={{
                  left: g.type === 'v' ? g.pos : 0,
                  top: g.type === 'h' ? g.pos : 0,
                  width: g.type === 'v' ? '1px' : '100%',
                  height: g.type === 'h' ? '1px' : '100%',
                  backgroundColor: '#a855f7',
                  boxShadow: '0 0 2px rgba(168, 85, 247, 0.5)',
                  opacity: 0.8
                }}
              />
            ))}
            </div>
          </div>
        </div>
      </div>
      
      <div className="absolute bottom-4 right-4 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl px-2 py-1 flex items-center gap-1.5 text-slate-200 shadow-xl z-50">
        <button
          onClick={() => setZoom(z => Math.max(0.05, z - 0.1))}
          className="hover:text-blue-400 hover:bg-slate-700/80 font-bold w-5 h-5 flex items-center justify-center rounded-md bg-slate-800 border border-slate-700/60 transition-all active:scale-95 text-xs text-slate-300 leading-none"
          title="Zoom out"
        >
          －
        </button>
        <span className="w-9 text-center font-mono text-[11px] font-medium tracking-tight text-slate-200 select-none">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom(z => Math.min(5, z + 0.1))}
          className="hover:text-blue-400 hover:bg-slate-700/80 font-bold w-5 h-5 flex items-center justify-center rounded-md bg-slate-800 border border-slate-700/60 transition-all active:scale-95 text-xs text-slate-300 leading-none"
          title="Zoom in"
        >
          ＋
        </button>
        <div className="w-px h-3.5 bg-slate-800" />
        <button
          onClick={fitCanvas}
          className="hover:text-blue-400 text-slate-400 px-1.5 py-0.5 rounded hover:bg-slate-800 transition-colors text-[10px] font-medium tracking-tight whitespace-nowrap"
        >
          {t.fitCanvas}
        </button>
      </div>
    </div>
  );
};

export default Canvas;
