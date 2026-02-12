// 模块：应用入口与主编辑流程
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Sidebar from './components/Sidebar.tsx';
import Canvas from './components/Canvas.tsx';
import LayersPanel from './components/LayersPanel.tsx';
import { ProjectState, Layer, BackgroundConfig } from './types.ts';
import { translations, Language } from './translations.ts';
import { PRESET_RATIOS } from './constants.ts';
import { generateId, downloadFile, normalizeSVG, getSVGDimensions } from './utils/helpers.ts';
import { 
  Download, Trash2, Plus, Share2, ArrowLeft, Clock, 
  Layout as LayoutIcon, ChevronRight, LayoutGrid, CheckCircle2, AlertCircle,
  Upload, Type as TextIcon, ImagePlus, FileOutput, Undo2, Redo2, Search, X,
  FileJson, ImageIcon as ImageIconLucide, Copy
} from 'lucide-react';
import * as htmlToImage from 'html-to-image';

const STORAGE_KEY = 'coverflow_projects_v2';

const Toast = ({ message, type }: { message: string, type: 'success' | 'error' }) => (
  <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl animate-in slide-in-from-top-4 fade-in duration-300 ${
    type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
  }`}>
    {type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
    <span className="font-bold text-sm">{message}</span>
  </div>
);

const ConfirmModal = ({ isOpen, message, onConfirm, onCancel, lang }: { isOpen: boolean, message: string, onConfirm: () => void, onCancel: () => void, lang: Language }) => {
  if (!isOpen) return null;
  const t = translations[lang];
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-6 scale-100 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 text-amber-500"><AlertCircle className="w-6 h-6" /><h3 className="text-lg font-bold text-slate-100">{t.confirmTitle}</h3></div>
        <p className="text-slate-300 text-sm leading-relaxed font-medium">{message}</p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors">{t.cancel}</button>
          <button onClick={onConfirm} className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-lg shadow-red-900/20 transition-all active:scale-95">{t.confirmDeleteAction}</button>
        </div>
      </div>
    </div>
  );
};

// 实时预览：通过 CSS 缩放渲染封面
const LivePreview: React.FC<{ project: ProjectState, previewRef?: React.RefObject<HTMLDivElement> }> = ({ project, previewRef }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // 自动保存项目列表到本地缓存
  useEffect(() => {
    if (!containerRef.current) return;
    const updateScale = () => {
      if (!containerRef.current) return;
      const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
      const sw = (cw - 40) / project.canvasConfig.width;
      const sh = (ch - 40) / project.canvasConfig.height;
      setScale(Math.min(sw, sh));
    };
    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [project.canvasConfig]);

  const getBackgroundStyles = (bg: BackgroundConfig): React.CSSProperties => {
    const styles: React.CSSProperties = {};
    let baseBackground = '';
    if (bg.type === 'color') styles.backgroundColor = bg.value;
    else if (bg.type === 'gradient') baseBackground = bg.value;
    else if (bg.type === 'image') {
      baseBackground = `url(${bg.value})`;
      styles.backgroundSize = 'cover';
      styles.backgroundPosition = 'center';
    }

    let patternImage = '';
    let patternSize = '';
    if (bg.overlayType !== 'none') {
      const rgba = bg.overlayColor.startsWith('#') 
        ? `${bg.overlayColor}${Math.round(bg.overlayOpacity * 255).toString(16).padStart(2, '0')}` 
        : bg.overlayColor;
      const s = bg.overlayScale || 20;
      if (bg.overlayType === 'dots') patternImage = `radial-gradient(${rgba} 2px, transparent 2px)`;
      else if (bg.overlayType === 'grid') patternImage = `linear-gradient(${rgba} 1px, transparent 1px), linear-gradient(90deg, ${rgba} 1px, transparent 1px)`;
      else if (bg.overlayType === 'stripes') patternImage = `repeating-linear-gradient(45deg, ${rgba}, ${rgba} 2px, transparent 2px, transparent ${s/2}px)`;
      patternSize = `${s}px ${s}px`;
    }

    const bgs: string[] = [];
    const sizes: string[] = [];
    if (patternImage) { bgs.push(patternImage); sizes.push(patternSize); }
    if (baseBackground) { bgs.push(baseBackground); sizes.push(bg.type === 'image' ? 'cover' : '100% 100%'); }

    if (bgs.length > 0) {
      styles.backgroundImage = bgs.join(', ');
      styles.backgroundSize = sizes.join(', ');
    }
    return styles;
  };

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center bg-[#0c0c0e] overflow-hidden">
      <div 
        ref={previewRef}
        style={{
          width: project.canvasConfig.width,
          height: project.canvasConfig.height,
          transform: `scale(${scale})`,
          ...getBackgroundStyles(project.background),
          boxShadow: '0 15px 45px rgba(0,0,0,0.6)',
          flexShrink: 0,
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {project.layers
          .filter(l => l.visible && l.type !== 'group')
          .sort((a, b) => a.zIndex - b.zIndex)
          .map(layer => {
            const align = layer.textAlign || 'center';
            const textStyle: React.CSSProperties = {
              fontSize: `${layer.fontSize || Math.max(12, layer.height * 0.7)}px`,
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
              lineHeight: 1.1,
              pointerEvents: 'none',
              padding: '0 0.5rem'
            };

            if (layer.type === 'text' && layer.writingMode === 'vertical') {
              textStyle.writingMode = 'vertical-rl';
              textStyle.textOrientation = 'upright';
              textStyle.padding = '0.5rem 0';
            }

            if (layer.type === 'text' && layer.textGradient?.enabled) {
              textStyle.backgroundImage = `linear-gradient(${layer.textGradient.angle}deg, ${layer.textGradient.from}, ${layer.textGradient.to})`;
              textStyle.WebkitBackgroundClip = 'text';
              textStyle.WebkitTextFillColor = 'transparent';
              textStyle.color = 'transparent';
            } else {
              textStyle.color = layer.color || '#ffffff';
            }

            return (
              <div
                key={layer.id}
                className="absolute"
                style={{
                  left: layer.x,
                  top: layer.y,
                  width: layer.width,
                  height: layer.height,
                  transform: `rotate(${layer.rotation}deg)`,
                  zIndex: layer.zIndex,
                }}
              >
                {layer.type === 'svg' ? (
                  <div className="w-full h-full pointer-events-none overflow-hidden" style={{ color: layer.color }}>
                    {layer.content.toLowerCase().includes('<svg')
                      ? <div className="w-full h-full" dangerouslySetInnerHTML={{ __html: layer.content }} />
                      : <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" dangerouslySetInnerHTML={{ __html: layer.content }} />
                    }
                  </div>
                ) : layer.type === 'text' ? (
                  <div style={textStyle}>{layer.content}</div>
                ) : (
                  <img src={layer.content} className="w-full h-full object-contain" style={{ opacity: layer.opacity }} alt="" />
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
};

const ProjectCard = ({ 
  project, 
  lang, 
  onClick, 
  onDelete, 
  onDownloadJson, 
  onDownloadImage,
  onDuplicate
}: { 
  project: ProjectState, 
  lang: Language, 
  onClick: () => void, 
  onDelete: (e: React.MouseEvent) => void,
  onDownloadJson: (e: React.MouseEvent) => void,
  onDownloadImage: (previewNode: HTMLDivElement | null, e: React.MouseEvent) => void,
  onDuplicate: (e: React.MouseEvent) => void
}) => {
  const t = translations[lang];
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const previewNodeRef = useRef<HTMLDivElement>(null);

  // 记录操作历史，供撤销/重做
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.05 });

    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div 
      ref={cardRef}
      onClick={onClick} 
      className="group bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden hover:border-blue-500/50 transition-all cursor-pointer shadow-xl hover:shadow-blue-900/10 flex flex-col h-[260px]"
    >
      <div className="flex-1 bg-[#0c0c0e] relative overflow-hidden flex items-center justify-center">
        {isVisible ? (
          <LivePreview project={project} previewRef={previewNodeRef} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#0c0c0e]">
            <div className="w-8 h-8 rounded-full border border-slate-800 border-t-slate-600 animate-spin opacity-20" />
          </div>
        )}
        
        {/* 右上角悬浮删除按钮 */}
        <button 
          onClick={onDelete} 
          className="absolute top-3 right-3 z-20 p-2 text-white bg-red-600/80 hover:bg-red-500 rounded-xl transition-all shadow-xl opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95"
          title={t.deleteProject}
        >
          <Trash2 className="w-4 h-4" />
        </button>

        {/* 比例标签 */}
        <div className="absolute bottom-3 right-3 z-10 opacity-60 group-hover:opacity-100 transition-opacity">
           <span className="text-[9px] px-2 py-1 bg-slate-800 text-slate-400 font-black rounded-lg border border-slate-700 uppercase tracking-tight">
              {project.canvasConfig.ratio}
           </span>
        </div>
      </div>

      <div className="px-5 py-4 flex flex-col gap-2 border-t border-slate-800/50 bg-slate-900/60 backdrop-blur-sm">
        <h3 className="text-sm font-bold text-slate-100 group-hover:text-blue-400 transition-colors truncate">
          {project.title}
        </h3>
        
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] flex items-center gap-1.5 uppercase font-bold tracking-widest text-slate-600">
            <Clock className="w-3 h-3" /> {new Date(project.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          <div className="flex items-center gap-1">
            <button 
              onClick={(e) => onDuplicate(e)}
              className="p-2 text-slate-500 hover:text-white bg-slate-800/50 hover:bg-blue-600 rounded-xl transition-all shadow-sm active:scale-90"
              title={t.duplicateProject || t.importedCopySuffix}
            >
              <Copy className="w-3 h-3" />
            </button>
            <button 
              onClick={(e) => onDownloadJson(e)} 
              className="p-2 text-slate-500 hover:text-white bg-slate-800/50 hover:bg-blue-600 rounded-xl transition-all shadow-sm active:scale-90"
              title={t.exportJson}
            >
              <FileJson className="w-3 h-3" />
            </button>
            <button 
              onClick={(e) => onDownloadImage(previewNodeRef.current, e)} 
              className="p-2 text-slate-500 hover:text-white bg-slate-800/50 hover:bg-blue-600 rounded-xl transition-all shadow-sm active:scale-90"
              title={t.export}
            >
              <ImageIconLucide className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [lang, setLang] = useState<Language>(() => (localStorage.getItem('coverflow_lang') as Language) || 'zh');
  const t = translations[lang];
  const [projects, setProjects] = useState<ProjectState[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });
  
  const [view, setView] = useState<'landing' | 'editor'>('landing');
  const [project, setProject] = useState<ProjectState | null>(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('assets');
  const [isExporting, setIsExporting] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string, onConfirm: () => void } | null>(null);
  const [projectSearchTerm, setProjectSearchTerm] = useState('');
  
  const [history, setHistory] = useState<ProjectState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const isUndoRedoAction = useRef(false);
  const ignoreHistoryChange = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); } catch (e) {}
  }, [projects]);

  useEffect(() => {
    if (project && view === 'editor') {
      setProjects(prev => prev.map(p => p.id === project.id ? { ...project, updatedAt: Date.now() } : p));
    }
  }, [project, view]);

  useEffect(() => { localStorage.setItem('coverflow_lang', lang); }, [lang]);

  useEffect(() => {
    if (!project) {
      setSelectedLayerIds([]);
      return;
    }
    if (!project.selectedLayerId) {
      setSelectedLayerIds([]);
      return;
    }
    setSelectedLayerIds(prev => {
      if (prev.length === 1 && prev[0] === project.selectedLayerId) return prev;
      if (prev.length > 1 && prev.includes(project.selectedLayerId)) return prev;
      return [project.selectedLayerId];
    });
  }, [project?.id, project?.selectedLayerId]);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (project && !isUndoRedoAction.current && !ignoreHistoryChange.current) {
      const lastState = history[historyIndex];
      if (JSON.stringify(lastState) !== JSON.stringify(project)) {
         const newHistory = history.slice(0, historyIndex + 1);
         newHistory.push(JSON.parse(JSON.stringify(project)));
         if (newHistory.length > 50) newHistory.shift();
         setHistory(newHistory);
         setHistoryIndex(newHistory.length - 1);
      }
    }
    isUndoRedoAction.current = false;
    ignoreHistoryChange.current = false;
  }, [project]);

  const initProjectHistory = (p: ProjectState) => {
    setHistory([JSON.parse(JSON.stringify(p))]);
    setHistoryIndex(0);
  };

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      isUndoRedoAction.current = true;
      const prevIndex = historyIndex - 1;
      const prevState = JSON.parse(JSON.stringify(history[prevIndex]));
      setProject(prevState);
      setHistoryIndex(prevIndex);
    }
  }, [historyIndex, history]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      isUndoRedoAction.current = true;
      const nextIndex = historyIndex + 1;
      const nextState = JSON.parse(JSON.stringify(history[nextIndex]));
      setProject(nextState);
      setHistoryIndex(nextIndex);
    }
  }, [historyIndex, history]);

  // 拖拽/连续调整结束时提交一次历史快照
  const saveHistorySnapshot = () => {
    if (!project) return;
    ignoreHistoryChange.current = false;
    const lastState = history[historyIndex];
    if (JSON.stringify(lastState) !== JSON.stringify(project)) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(JSON.parse(JSON.stringify(project)));
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  };

  const createNewProject = (preset: typeof PRESET_RATIOS[0]) => {
    const newProject: ProjectState = {
      id: generateId(), title: t.untitled, updatedAt: Date.now(),
      layers: [{ id: generateId(), name: t.defaultHeadlineName, type: 'text', content: t.doubleClickToEdit, x: 50, y: preset.height / 2 - 50, width: preset.width - 100, height: 100, fontSize: 64, fontFamily: 'Inter, sans-serif', fontWeight: 700, textAlign: 'center', writingMode: 'horizontal', rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1, color: '#ffffff', ratioLocked: true }],
      background: { 
        type: 'color', 
        value: '#1e293b', 
        overlayType: 'none', 
        overlayColor: '#ffffff', 
        overlayOpacity: 0.1, 
        overlayScale: 20 
      },
      canvasConfig: { width: preset.width, height: preset.height, ratio: preset.ratio },
      selectedLayerId: null
    };
    setProject(newProject);
    setProjects(prev => [newProject, ...prev]);
    setView('editor');
    initProjectHistory(newProject);
  };

  const modifyProject = (modifier: (p: ProjectState) => ProjectState, saveToHistory: boolean = true) => {
    if (!saveToHistory) ignoreHistoryChange.current = true;
    setProject(prev => prev ? modifier(prev) : null);
  };

  const getGroupBounds = (layers: Layer[], childIds: string[]) => {
    const children = layers.filter(l => childIds.includes(l.id));
    if (children.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
    const minX = Math.min(...children.map(l => l.x));
    const minY = Math.min(...children.map(l => l.y));
    const maxX = Math.max(...children.map(l => l.x + l.width));
    const maxY = Math.max(...children.map(l => l.y + l.height));
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  };

  const updateLayer = useCallback((id: string, updates: Partial<Layer>, record: boolean = true) => {
    modifyProject(p => {
      const target = p.layers.find(l => l.id === id);
      if (!target) return p;

      if (target.type === 'group') {
        const childIds = target.children || [];
        const baseBounds = {
          x: target.x,
          y: target.y,
          width: Math.max(1, target.width),
          height: Math.max(1, target.height),
          rotation: target.rotation || 0
        };
        const nextBounds = {
          x: updates.x !== undefined ? updates.x : baseBounds.x,
          y: updates.y !== undefined ? updates.y : baseBounds.y,
          width: updates.width !== undefined ? Math.max(1, updates.width) : baseBounds.width,
          height: updates.height !== undefined ? Math.max(1, updates.height) : baseBounds.height,
          rotation: updates.rotation !== undefined ? updates.rotation : baseBounds.rotation
        };
        const scaleX = nextBounds.width / baseBounds.width;
        const scaleY = nextBounds.height / baseBounds.height;
        const deltaRotation = nextBounds.rotation - baseBounds.rotation;
        const baseCenter = { x: baseBounds.x + baseBounds.width / 2, y: baseBounds.y + baseBounds.height / 2 };
        const nextCenter = { x: nextBounds.x + nextBounds.width / 2, y: nextBounds.y + nextBounds.height / 2 };
        const rad = deltaRotation * (Math.PI / 180);

        const hasTransform = updates.x !== undefined || updates.y !== undefined || updates.width !== undefined || updates.height !== undefined || updates.rotation !== undefined;

        const nextLayers = p.layers.map(l => {
          if (l.id === target.id) {
            return { ...target, ...updates, ...nextBounds };
          }
          if (!childIds.includes(l.id)) return l;

          let updatedChild = { ...l };
          if (updates.opacity !== undefined) updatedChild.opacity = updates.opacity;
          if (updates.visible !== undefined) updatedChild.visible = updates.visible;
          if (updates.locked !== undefined) updatedChild.locked = updates.locked;

          if (hasTransform) {
            const childCenter = { x: l.x + l.width / 2, y: l.y + l.height / 2 };
            let relX = (childCenter.x - baseCenter.x) * scaleX;
            let relY = (childCenter.y - baseCenter.y) * scaleY;
            if (deltaRotation !== 0) {
              const rx = relX * Math.cos(rad) - relY * Math.sin(rad);
              const ry = relX * Math.sin(rad) + relY * Math.cos(rad);
              relX = rx;
              relY = ry;
            }
            const newCenter = { x: nextCenter.x + relX, y: nextCenter.y + relY };
            const newW = Math.max(10, l.width * scaleX);
            const newH = Math.max(10, l.height * scaleY);
            updatedChild = {
              ...updatedChild,
              x: newCenter.x - newW / 2,
              y: newCenter.y - newH / 2,
              width: newW,
              height: newH,
              rotation: l.rotation + deltaRotation
            };
          }
          return updatedChild;
        });

        return { ...p, layers: nextLayers };
      }

      const layers = p.layers.map(l => {
        if (l.id !== id) return l;
        const newL = { ...l, ...updates };
        if (l.ratioLocked) {
          if (updates.width !== undefined && updates.height === undefined) newL.height = updates.width * (l.height / l.width);
          else if (updates.height !== undefined && updates.width === undefined) newL.width = updates.height * (l.width / l.height);
        }
        return newL;
      });

      const updatedLayer = layers.find(l => l.id === id);
      if (updatedLayer?.parentId) {
        const parentLayer = layers.find(l => l.id === updatedLayer.parentId);
        if (parentLayer?.type === 'group') {
          const bounds = getGroupBounds(layers, parentLayer.children || []);
          return {
            ...p,
            layers: layers.map(l => l.id === parentLayer.id ? { ...parentLayer, ...bounds } : l)
          };
        }
      }

      return { ...p, layers };
    }, record);
  }, [getGroupBounds]);

  const getExpandedSelection = (layers: Layer[], ids: string[]) => {
    const expanded = new Set(ids);
    layers.forEach(l => {
      if (l.type === 'group' && expanded.has(l.id)) {
        (l.children || []).forEach(childId => expanded.add(childId));
      }
    });
    return expanded;
  };

  const handleSelectLayer = (id: string | null, mode: 'replace' | 'toggle' = 'replace') => {
    if (!project) return;
    if (!id) {
      setSelectedLayerIds([]);
      modifyProject(p => ({ ...p, selectedLayerId: null }), false);
      return;
    }

    if (mode === 'replace') {
      setSelectedLayerIds([id]);
      modifyProject(p => ({ ...p, selectedLayerId: id }), false);
      return;
    }

    const exists = selectedLayerIds.includes(id);
    const nextIds = exists ? selectedLayerIds.filter(lid => lid !== id) : [...selectedLayerIds, id];
    const nextActiveId = exists
      ? (project.selectedLayerId === id ? (nextIds[nextIds.length - 1] || null) : project.selectedLayerId)
      : id;
    setSelectedLayerIds(nextIds);
    modifyProject(p => ({ ...p, selectedLayerId: nextActiveId }), false);
  };

  const handleDeleteLayers = (ids: string[]) => {
    if (!project || ids.length === 0) return;
    const expanded = getExpandedSelection(project.layers, ids);
    modifyProject(p => {
      const nextLayers = p.layers
        .filter(l => !expanded.has(l.id))
        .map(l => {
          if (l.parentId && expanded.has(l.parentId)) return { ...l, parentId: undefined };
          if (l.type === 'group') {
            const nextChildren = (l.children || []).filter(cid => !expanded.has(cid));
            return { ...l, children: nextChildren };
          }
          return l;
        });

      const normalizedLayers = nextLayers
        .filter(l => l.type !== 'group' || (l.children || []).length > 0)
        .map(l => {
          if (l.type !== 'group') return l;
          const bounds = getGroupBounds(nextLayers, l.children || []);
          return { ...l, ...bounds };
        });

      const nextSelected = p.selectedLayerId && expanded.has(p.selectedLayerId) ? null : p.selectedLayerId;
      return { ...p, layers: normalizedLayers, selectedLayerId: nextSelected };
    });
    setSelectedLayerIds(prev => prev.filter(id => !expanded.has(id)));
  };

  const handleCloneLayers = (ids: string[]) => {
    if (!project || ids.length === 0) return;
    modifyProject(p => {
      const layerMap = new Map(p.layers.map(l => [l.id, l]));
      const expanded = getExpandedSelection(p.layers, ids);
      const idMap = new Map<string, string>();
      expanded.forEach(id => idMap.set(id, generateId()));

      const baseZ = Math.max(0, ...p.layers.map(l => l.zIndex));
      let zCursor = baseZ + 1;

      const clones: Layer[] = [];
      expanded.forEach(id => {
        const layer = layerMap.get(id);
        if (!layer) return;
        const newId = idMap.get(id) as string;
        const parentId = layer.parentId && idMap.has(layer.parentId) ? idMap.get(layer.parentId) : undefined;
        const nextLayer: Layer = {
          ...JSON.parse(JSON.stringify(layer)),
          id: newId,
          parentId,
          x: layer.x + 20,
          y: layer.y + 20,
          zIndex: zCursor++
        };
        if (nextLayer.type === 'group') {
          nextLayer.children = (layer.children || []).map(cid => idMap.get(cid) as string).filter(Boolean);
        }
        clones.push(nextLayer);
      });

      const nextSelectedIds = ids.map(id => idMap.get(id)).filter((val): val is string => Boolean(val));
      const nextActiveId = nextSelectedIds[nextSelectedIds.length - 1] || null;
      setSelectedLayerIds(nextSelectedIds);

      return { ...p, layers: [...p.layers, ...clones], selectedLayerId: nextActiveId };
    });
    showToast(t.layerCloned);
  };

  const handleMoveLayers = (ids: string[], toFront: boolean) => {
    if (!project || ids.length === 0) return;
    modifyProject(p => {
      const expanded = getExpandedSelection(p.layers, ids);
      const ordered = [...p.layers].sort((a, b) => a.zIndex - b.zIndex);
      const moving = ordered.filter(l => expanded.has(l.id));
      const staying = ordered.filter(l => !expanded.has(l.id));
      const nextOrder = toFront ? [...staying, ...moving] : [...moving, ...staying];
      return { ...p, layers: nextOrder.map((l, i) => ({ ...l, zIndex: i + 1 })) };
    });
  };

  const handleGroupLayers = (ids: string[]) => {
    if (!project) return;
    const selectedLayers = ids
      .map(id => project.layers.find(l => l.id === id))
      .filter((l): l is Layer => Boolean(l));
    if (selectedLayers.some(l => l.type === 'group' || l.parentId)) return;
    const candidates = selectedLayers.filter(l => l.type !== 'group');
    if (candidates.length < 2) return;

    const candidateIds = new Set(candidates.map(l => l.id));

    const groupId = generateId();
    const bounds = getGroupBounds(project.layers, candidates.map(l => l.id));
    const groupLayer: Layer = {
      id: groupId,
      name: t.groupName,
      type: 'group',
      content: '',
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      rotation: 0,
      zIndex: Math.max(0, ...project.layers.map(l => l.zIndex)) + 1,
      visible: true,
      locked: false,
      opacity: 1,
      children: candidates.map(l => l.id)
    };

    modifyProject(p => ({
      ...p,
      layers: p.layers.map(l => {
        if (candidateIds.has(l.id)) return { ...l, parentId: groupId };
        if (l.type === 'group') {
          const nextChildren = (l.children || []).filter(cid => !candidateIds.has(cid));
          return { ...l, children: nextChildren };
        }
        return l;
      }).concat(groupLayer),
      selectedLayerId: groupId
    }));
    setSelectedLayerIds([groupId]);
  };

  const handleUngroupLayer = (groupId: string) => {
    if (!project) return;
    const group = project.layers.find(l => l.id === groupId && l.type === 'group');
    if (!group) return;
    const childIds = group.children || [];
    modifyProject(p => ({
      ...p,
      layers: p.layers
        .filter(l => l.id !== groupId)
        .map(l => childIds.includes(l.id) ? { ...l, parentId: undefined } : l),
      selectedLayerId: childIds[0] || null
    }));
    setSelectedLayerIds(childIds);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported: ProjectState = JSON.parse(event.target?.result as string);
        if (imported.id && imported.layers) {
          const existingProjectIds = new Set(projects.map(p => p.id));
          if (existingProjectIds.has(imported.id)) {
            imported.id = generateId();
            imported.updatedAt = Date.now();
            imported.title += t.importedCopySuffix;
          }
          imported.layers = imported.layers.map(layer => ({ ...layer, id: generateId() }));
          imported.selectedLayerId = null;
          setProjects(prev => [imported, ...prev]);
          showToast(t.importSuccess);
        }
      } catch (err) {
        showToast(t.parseFailed, "error");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportJson = (targetProject: ProjectState) => {
    const json = JSON.stringify(targetProject, null, 2);
    downloadFile(json, `${targetProject.title}.json`, 'application/json');
  };

  const handleDuplicateProject = (targetProject: ProjectState) => {
    const idMap = new Map<string, string>();
    targetProject.layers.forEach(layer => idMap.set(layer.id, generateId()));

    const clonedLayers = targetProject.layers.map(layer => {
      const nextId = idMap.get(layer.id) as string;
      const nextParentId = layer.parentId ? idMap.get(layer.parentId) : undefined;
      const nextChildren = layer.children ? layer.children.map(cid => idMap.get(cid) as string).filter(Boolean) : undefined;
      return {
        ...JSON.parse(JSON.stringify(layer)),
        id: nextId,
        parentId: nextParentId,
        children: nextChildren
      };
    });

    const duplicated: ProjectState = {
      ...JSON.parse(JSON.stringify(targetProject)),
      id: generateId(),
      title: `${targetProject.title}${t.importedCopySuffix}`,
      updatedAt: Date.now(),
      layers: clonedLayers,
      selectedLayerId: null
    };

    setProjects(prev => [duplicated, ...prev]);
    showToast(t.importSuccess);
  };

  // 基于预览节点导出 PNG
  const handleExportImage = async (previewNode: HTMLDivElement | null, targetProject: ProjectState) => {
    if (!previewNode) {
      showToast(t.exportPreviewMissing, "error");
      return;
    }
    setIsExporting(true);
    try { 
      const { width, height } = targetProject.canvasConfig;
      const dataUrl = await htmlToImage.toPng(previewNode, {
        pixelRatio: 2,
        width,
        height,
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left',
          width: `${width}px`,
          height: `${height}px`
        }
      }); 
      const link = document.createElement('a'); 
      link.download = `${targetProject.title}.png`; 
      link.href = dataUrl; 
      link.click(); 
      showToast(t.exportSuccess);
    } catch (e) { 
      showToast(t.exportFailed, "error"); 
    } finally {
      setIsExporting(false);
    }
  };

  const addTextLayerWithContent = (text: string) => {
    if (!project) return;
    const newId = generateId();
    modifyProject(p => {
      const width = Math.min(Math.max(200, text.length * 18), p.canvasConfig.width * 0.9);
      const height = Math.min(120, p.canvasConfig.height * 0.5);
      return {
        ...p,
        layers: [...p.layers, {
          id: newId,
          name: t.textLayerName,
          type: 'text',
          content: text,
          x: p.canvasConfig.width / 2 - width / 2,
          y: p.canvasConfig.height / 2 - height / 2,
          width,
          height,
          fontSize: 32,
          fontFamily: 'Inter, sans-serif',
          fontWeight: 700,
          textAlign: 'center',
          writingMode: 'horizontal',
          rotation: 0,
          zIndex: p.layers.length + 1,
          visible: true,
          locked: false,
          opacity: 1,
          color: '#ffffff',
          ratioLocked: true
        }],
        selectedLayerId: newId
      };
    });
    setSelectedLayerIds([newId]);
    showToast(t.textLayerPasted);
  };

  const addSvgLayerWithContent = (svgText: string) => {
    if (!project) return;
    const newId = generateId();
    const normalized = normalizeSVG(svgText);
    const dims = getSVGDimensions(normalized);
    modifyProject(p => {
      const maxW = p.canvasConfig.width * 0.7;
      const maxH = p.canvasConfig.height * 0.7;
      const rawW = dims.width || 200;
      const rawH = dims.height || 200;
      const scale = Math.min(1, maxW / rawW, maxH / rawH);
      const width = Math.max(40, rawW * scale);
      const height = Math.max(40, rawH * scale);
      const newId = generateId();
      return {
        ...p,
        layers: [...p.layers, {
          id: newId,
          name: t.svgLayerName,
          type: 'svg',
          content: normalized,
          x: p.canvasConfig.width / 2 - width / 2,
          y: p.canvasConfig.height / 2 - height / 2,
          width,
          height,
          rotation: 0,
          zIndex: p.layers.length + 1,
          visible: true,
          locked: false,
          opacity: 1,
          color: '#3b82f6',
          ratioLocked: true
        }],
        selectedLayerId: newId
      };
    });
    setSelectedLayerIds([newId]);
    showToast(t.svgLayerPasted);
  };

  const addImageLayerWithContent = (dataUrl: string) => {
    if (!project) return;
    const newId = generateId();
    modifyProject(p => {
      const size = Math.min(320, p.canvasConfig.width * 0.6, p.canvasConfig.height * 0.6);
      return {
        ...p,
        layers: [...p.layers, {
          id: newId,
          name: t.imageLayerName,
          type: 'image',
          content: dataUrl,
          x: p.canvasConfig.width / 2 - size / 2,
          y: p.canvasConfig.height / 2 - size / 2,
          width: size,
          height: size,
          rotation: 0,
          zIndex: p.layers.length + 1,
          visible: true,
          locked: false,
          opacity: 1,
          ratioLocked: true
        }],
        selectedLayerId: newId
      };
    });
    setSelectedLayerIds([newId]);
    showToast(t.imageLayerPasted);
  };

  const applyProjectFromJson = (data: Partial<ProjectState>) => {
    if (!project) return;
    modifyProject(p => {
      const newLayers = (data.layers || []).map(l => ({
        ...l,
        id: generateId()
      }));

      return {
        ...p,
        layers: newLayers.length > 0 ? newLayers : p.layers,
        background: data.background || p.background,
        canvasConfig: data.canvasConfig || p.canvasConfig,
        selectedLayerId: null,
        updatedAt: Date.now()
      };
    });
    setSelectedLayerIds([]);
    showToast(t.projectJsonApplied);
  };

  // 统一处理粘贴：文字/SVG/图片/JSON
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

      if (trimmed.toLowerCase().includes('<svg')) {
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
  }, [view, project, lang]);

  const handleAddText = () => {
    if (!project) return;
    const newLayer: Layer = {
      id: generateId(),
      name: t.newTextLayerName,
      type: 'text',
      content: t.doubleClickToEdit,
      x: project.canvasConfig.width / 2 - 150,
      y: project.canvasConfig.height / 2 - 25,
      width: 300,
      height: 50,
      fontSize: 48,
      fontFamily: 'Inter, sans-serif',
      fontWeight: 700,
      textAlign: 'center',
      writingMode: 'horizontal',
      rotation: 0,
      zIndex: project.layers.length + 1,
      visible: true,
      locked: false,
      opacity: 1,
      color: '#ffffff',
      ratioLocked: true
    };
    modifyProject(p => ({ ...p, layers: [...p.layers, newLayer], selectedLayerId: newLayer.id }));
    setSelectedLayerIds([newLayer.id]);
  };

  // 选择图片并按画布尺寸约束初始大小
  const handleAddImage = () => {
    if (!project) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const content = ev.target?.result as string;
          const img = new Image();
          img.onload = () => {
            const maxW = project.canvasConfig.width * 0.8;
            const maxH = project.canvasConfig.height * 0.8;
            let w = img.width;
            let h = img.height;
            const ratio = w / h;
            if (w > maxW) { w = maxW; h = w / ratio; }
            if (h > maxH) { h = maxH; w = h * ratio; }

            const newLayer: Layer = {
              id: generateId(),
              name: t.newImageLayerName,
              type: 'image',
              content: content,
              x: (project.canvasConfig.width - w) / 2,
              y: (project.canvasConfig.height - h) / 2,
              width: w,
              height: h,
              rotation: 0,
              zIndex: project.layers.length + 1,
              visible: true,
              locked: false,
              opacity: 1,
              ratioLocked: true
            };
            modifyProject(p => ({ ...p, layers: [...p.layers, newLayer], selectedLayerId: newLayer.id }));
            setSelectedLayerIds([newLayer.id]);
          };
          img.src = content;
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  
    // 键盘快捷键处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
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
          const dr = e.key === 'ArrowLeft' ? -15 : 15;
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
  }, [project, handleUndo, handleRedo, updateLayer, lang, selectedLayerIds, handleDeleteLayers, handleCloneLayers, handleGroupLayers]);

  const groupedProjects = useMemo(() => {
    const filtered = projects.filter(p => p.title.toLowerCase().includes(projectSearchTerm.toLowerCase()));
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOfThisWeek = startOfToday - (now.getDay() * 86400000);
    const startOfLastWeek = startOfThisWeek - (7 * 86400000);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).getTime();

    const groups: { label: string, key: string, items: ProjectState[] }[] = [
      { label: t.dateGroups.today, key: 'today', items: [] },
      { label: t.dateGroups.yesterday, key: 'yesterday', items: [] },
      { label: t.dateGroups.thisWeek, key: 'thisWeek', items: [] },
      { label: t.dateGroups.lastWeek, key: 'lastWeek', items: [] },
      { label: t.dateGroups.lastMonth, key: 'lastMonth', items: [] },
      { label: t.dateGroups.older, key: 'older', items: [] }
    ];

    filtered.forEach(p => {
      const time = p.updatedAt;
      if (time >= startOfToday) groups[0].items.push(p);
      else if (time >= startOfYesterday) groups[1].items.push(p);
      else if (time >= startOfThisWeek) groups[2].items.push(p);
      else if (time >= startOfLastWeek) groups[3].items.push(p);
      else if (time >= startOfLastMonth) groups[4].items.push(p);
      else groups[5].items.push(p);
    });

    return groups.filter(g => g.items.length > 0);
  }, [projects, projectSearchTerm, t.dateGroups]);

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 p-8 md:p-16 flex flex-col gap-12 max-w-7xl mx-auto h-screen overflow-hidden">
        {toast && <Toast message={toast.msg} type={toast.type} />}
        {confirmDialog && <ConfirmModal isOpen={true} message={confirmDialog.message} lang={lang} onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />}
        <div className="flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-4"><div className="bg-blue-600 p-2.5 rounded-2xl shadow-xl shadow-blue-900/20"><Share2 className="w-8 h-8 text-white" /></div><div><h1 className="text-3xl font-black tracking-tight text-white">{t.title}</h1><p className="text-slate-500 text-sm font-medium">{t.landingHeader}</p></div></div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl hover:border-blue-500 cursor-pointer transition-all">
              <Upload className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-bold">{t.import}</span>
              <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
            </label>
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800"><button onClick={() => setLang('zh')} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${lang === 'zh' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200'}`}>中</button><button onClick={() => setLang('en')} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${lang === 'en' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200'}`}>EN</button></div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 flex-1 min-h-0">
          <div className="lg:col-span-4 flex flex-col gap-6 h-full overflow-hidden">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 flex-shrink-0"><Plus className="w-4 h-4" /> {t.createNew}</h2>
            <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-2 custom-scrollbar">
              {PRESET_RATIOS.map(ratio => (<button key={ratio.name} onClick={() => createNewProject(ratio)} className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl hover:border-blue-500 hover:bg-slate-800/50 transition-all group text-left flex-shrink-0"><div className="flex items-center gap-4"><div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center border border-slate-700 group-hover:bg-blue-900/20 transition-colors"><LayoutIcon className="w-6 h-6 text-slate-500 group-hover:text-blue-400" /></div><div><p className="text-sm font-bold text-slate-100">{lang === 'zh' ? ratio.nameZh : ratio.name}</p><p className="text-[10px] text-slate-500 uppercase font-bold tracking-tight">{ratio.width} × {ratio.height} PX</p></div></div><ChevronRight className="w-5 h-5 text-slate-700 group-hover:text-blue-400 group-hover:translate-x-1 transition-all" /></button>))}
            </div>
          </div>
          <div className="lg:col-span-8 flex flex-col gap-6 h-full overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 flex-shrink-0">
              <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><Clock className="w-4 h-4" /> {t.recentProjects}</h2>
              <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <input 
                  type="text" 
                  placeholder={t.searchProjects}
                  value={projectSearchTerm}
                  onChange={(e) => setProjectSearchTerm(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 pl-12 pr-4 text-xs font-medium text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500 transition-all"
                />
                {projectSearchTerm && (
                  <button 
                    onClick={() => setProjectSearchTerm('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-slate-500 hover:text-slate-300"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar space-y-10 pb-16">
              {projects.length === 0 ? (
                <div className="bg-slate-900/50 border-2 border-dashed border-slate-800 rounded-3xl h-80 flex flex-col items-center justify-center text-slate-600 gap-4"><LayoutGrid className="w-12 h-12 opacity-20" /><p className="text-sm font-medium">{t.noProjects}</p></div>
              ) : groupedProjects.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-slate-600 opacity-50 italic">
                  <p className="text-sm">{t.noMatchingProjects}</p>
                </div>
              ) : (
                groupedProjects.map(group => (
                  <div key={group.key} className="space-y-6">
                    <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] flex items-center gap-4">
                      <span>{group.label}</span>
                      <div className="flex-1 h-px bg-slate-900"></div>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {group.items.map(p => (
                        <ProjectCard 
                          key={p.id} 
                          project={p} 
                          lang={lang} 
                          onClick={() => { setProject(JSON.parse(JSON.stringify(p))); setView('editor'); initProjectHistory(p); }} 
                          onDelete={(e) => { 
                            e.stopPropagation(); 
                            setConfirmDialog({ 
                              message: t.confirmDeleteProject, 
                              onConfirm: () => setProjects(prev => prev.filter(pr => pr.id !== p.id)) 
                            }); 
                          }} 
                          onDuplicate={(e) => { e.stopPropagation(); handleDuplicateProject(p); }}
                          onDownloadJson={(e) => { e.stopPropagation(); handleExportJson(p); }}
                          onDownloadImage={(node, e) => { e.stopPropagation(); handleExportImage(node, p); }}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 overflow-hidden">
      {toast && <Toast message={toast.msg} type={toast.type} />}
      {confirmDialog && <ConfirmModal isOpen={true} message={confirmDialog.message} lang={lang} onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />}
      <header className="h-14 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-4">
          <button onClick={() => { setProject(null); setView('landing'); }} className="p-2 hover:bg-slate-800 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-slate-400" />
          </button>
          <div className="flex items-center gap-2">
            <input value={project.title} onChange={(e) => modifyProject(p => ({ ...p, title: e.target.value }))} className="bg-transparent font-bold text-sm outline-none hover:bg-slate-800 rounded px-1" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 mr-4 bg-slate-800 p-1 rounded-lg">
            <button 
              onClick={handleUndo} 
              disabled={historyIndex <= 0}
              className="p-1.5 rounded hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-all text-slate-300"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button 
              onClick={handleRedo} 
              disabled={historyIndex >= history.length - 1}
              className="p-1.5 rounded hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-all text-slate-300"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
          <button onClick={() => handleExportJson(project)} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-lg text-slate-300 border border-slate-700 transition-colors">
            <FileOutput className="w-4 h-4" />
            {t.exportJson}
          </button>
          <button onClick={() => handleExportImage(document.getElementById('export-target') as HTMLDivElement, project)} disabled={isExporting} className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-lg text-white shadow-lg shadow-blue-900/20 disabled:opacity-50">
            {isExporting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Download className="w-4 h-4" />}
            {t.export}
          </button>
        </div>
      </header>
      <main className="flex-1 flex overflow-hidden min-h-0 relative">
        <Sidebar lang={lang} activeTab={activeTab} setActiveTab={setActiveTab} background={project.background} onAddLayer={(l) => modifyProject(p => ({ ...p, layers: [...p.layers, { id: generateId(), name: l.name || t.defaultLayerName, type: l.type || 'svg', x: p.canvasConfig.width/2-50, y: p.canvasConfig.height/2-50, width: l.width || 100, height: l.height || 100, rotation: 0, zIndex: p.layers.length+1, visible: true, locked: false, opacity: 1, color: l.color || '#3b82f6', ratioLocked: true, content: l.content || '' }] }))} onUpdateBackground={(bg) => modifyProject(p => ({ ...p, background: { ...p.background, ...bg } }))} />
        <div className="flex-1 flex flex-col min-h-0 relative">
          <Canvas
            lang={lang}
            project={project}
            onSelectLayer={(id) => handleSelectLayer(id, 'replace')}
            updateLayer={updateLayer}
            onCommit={saveHistorySnapshot}
          />
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl p-2 shadow-2xl z-40">
            <button onClick={handleAddText} className="flex items-center gap-2 px-4 py-2 hover:bg-blue-600/10 hover:text-blue-400 rounded-xl transition-all text-xs font-bold group">
              <div className="p-1.5 bg-slate-800 rounded-lg group-hover:bg-blue-600/20"><TextIcon className="w-4 h-4" /></div>
              {t.addHeadline}
            </button>
            <div className="w-px h-6 bg-slate-800" />
            <button onClick={handleAddImage} className="flex items-center gap-2 px-4 py-2 hover:bg-blue-600/10 hover:text-blue-400 rounded-xl transition-all text-xs font-bold group">
              <div className="p-1.5 bg-slate-800 rounded-lg group-hover:bg-blue-600/20"><ImagePlus className="w-4 h-4" /></div>
              {t.addImage}
            </button>
          </div>
        </div>
        <LayersPanel
          lang={lang}
          project={project}
          selectedLayerIds={selectedLayerIds}
          onUpdateLayer={updateLayer}
          onDeleteLayer={(id) => setConfirmDialog({ message: t.confirmDelete, onConfirm: () => handleDeleteLayers([id]) })}
          onSelectLayer={handleSelectLayer}
          onReorderLayers={(newLayers) => modifyProject(p => ({ ...p, layers: newLayers.map((l, i) => ({ ...l, zIndex: i + 1 })) }))}
          onCloneLayers={handleCloneLayers}
          onDeleteLayers={(ids) => setConfirmDialog({ message: t.confirmDelete, onConfirm: () => handleDeleteLayers(ids) })}
          onMoveLayersTop={(ids) => handleMoveLayers(ids, true)}
          onMoveLayersBottom={(ids) => handleMoveLayers(ids, false)}
          onGroupLayers={handleGroupLayers}
          onUngroupLayer={handleUngroupLayer}
          onCommit={saveHistorySnapshot}
        />
      </main>
    </div>
  );
};

export default App;
