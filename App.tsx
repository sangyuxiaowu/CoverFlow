// 模块：应用入口与主编辑流程
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Sidebar from './components/Sidebar.tsx';
import Canvas from './components/Canvas.tsx';
import LayersPanel from './components/LayersPanel.tsx';
import Toast from './components/Toast.tsx';
import ConfirmModal from './components/ConfirmModal.tsx';
import BackgroundCropModal from './components/BackgroundCropModal.tsx';
import LivePreview from './components/LivePreview.tsx';
import ProjectPresetModal from './components/ProjectPresetModal.tsx';
import { ProjectState, Layer } from './types.ts';
import {
  createIndexedDBAdapter,
  createLocalFileAdapter,
  createCloudAdapter,
  getStoredLanguage,
  getStoredStorageType,
  setStoredLanguage,
  setStoredStorageType,
  StorageAdapterType
} from './storage/storage.ts';
import { translations, Language } from './translations.ts';
import { PRESET_RATIOS } from './constants.ts';
import { generateId, downloadFile, normalizeSVG } from './utils/helpers.ts';
import { getCroppedImage } from './utils/imageCrop.ts';
import { type Area } from 'react-easy-crop';
import { 
  Download, Trash2, Plus, ArrowLeft, Clock, 
  LayoutGrid,
  Upload, Type as TextIcon, ImagePlus, FileOutput, Undo2, Redo2, Search, X,
  FileJson, ImageIcon as ImageIconLucide, Copy, Settings, Save
} from 'lucide-react';
import * as htmlToImage from 'html-to-image';
import logoSvg from './doc/logo.svg?raw';
import packageInfo from './package.json';

const APP_VERSION = packageInfo.version;
const GITHUB_REPO_URL = 'https://github.com/sangyuxiaowu/CoverFlow';
const isCloudMode = import.meta.env.VITE_APP_MODE === 'cloud';
const CLOUD_PAGE_SIZE = 9;

// 项目卡片组件
const ProjectCard = ({
  project,
  lang,
  onClick,
  onDelete,
  onDownloadJson,
  onDownloadImage,
  onDuplicate
}: {
  project: ProjectState;
  lang: Language;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onDownloadJson: (e: React.MouseEvent) => void;
  onDownloadImage: (previewNode: HTMLDivElement | null, e: React.MouseEvent) => void;
  onDuplicate: (e: React.MouseEvent) => void;
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

// 应用主组件
const App: React.FC = () => {
  const [lang, setLang] = useState<Language>(() => getStoredLanguage('zh'));
  const t = translations[lang];
  const [projects, setProjects] = useState<ProjectState[]>([]);
  const indexedDbAdapter = useMemo(() => createIndexedDBAdapter(), []);
  const localFileAdapter = useMemo(() => createLocalFileAdapter(), []);
  const cloudAdapter = useMemo(() => createCloudAdapter(), []);
  const [storageType, setStorageType] = useState<StorageAdapterType>(() => (
    getStoredStorageType('indexeddb')
  ));
  const storageAdapter = useMemo(() => {
    if (isCloudMode) return cloudAdapter;
    return storageType === 'localfile' ? localFileAdapter : indexedDbAdapter;
  }, [storageType, localFileAdapter, indexedDbAdapter, cloudAdapter]);
  const [storageFolderName, setStorageFolderName] = useState('');
  const storageReadyRef = useRef(false);
  const lastSavedAtRef = useRef(0);
  const lastSavedSnapshotRef = useRef('');
  const saveTimerRef = useRef<number | null>(null);
  const latestProjectsRef = useRef<ProjectState[]>([]);
  const prevViewRef = useRef<'landing' | 'editor'>('landing');
  
  const [view, setView] = useState<'landing' | 'editor'>('landing');
  const [project, setProject] = useState<ProjectState | null>(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('assets');
  const [isExporting, setIsExporting] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string, onConfirm: () => void } | null>(null);
  const [isStorageSettingsOpen, setIsStorageSettingsOpen] = useState(false);
  const [projectSearchTerm, setProjectSearchTerm] = useState('');
  const [cloudPage, setCloudPage] = useState(1);
  const [cloudHasMore, setCloudHasMore] = useState(true);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(() => PRESET_RATIOS[0]);
  const [customPresetSize, setCustomPresetSize] = useState(() => ({
    width: PRESET_RATIOS[0].width,
    height: PRESET_RATIOS[0].height
  }));
  
  const [history, setHistory] = useState<ProjectState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [bgCropModal, setBgCropModal] = useState<{ src: string } | null>(null);
  const [bgCropPosition, setBgCropPosition] = useState({ x: 0, y: 0 });
  const [bgCropZoom, setBgCropZoom] = useState(1);
  const [bgCropRotation, setBgCropRotation] = useState(0);
  const [bgCropFlip, setBgCropFlip] = useState({ horizontal: false, vertical: false });
  const [bgCropAreaPixels, setBgCropAreaPixels] = useState<Area | null>(null);
  const [bgCropSaving, setBgCropSaving] = useState(false);

  const isUndoRedoAction = useRef(false);
  const ignoreHistoryChange = useRef(false);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);


  const handlePickStorageFolder = useCallback(async () => {
    if (!localFileAdapter.isAvailable()) {
      showToast(t.storageFolderUnsupported, 'error');
      return;
    }
    const ready = await localFileAdapter.ensureReady({ prompt: true });
    if (!ready) {
      showToast(t.storageFolderPickFailed, 'error');
      return;
    }
    setStorageFolderName(localFileAdapter.getFolderName());
    if (storageType !== 'localfile') {
      storageReadyRef.current = false;
      setStorageType('localfile');
    }
  }, [localFileAdapter, showToast, storageType, t.storageFolderPickFailed, t.storageFolderUnsupported]);

  const handleStorageTypeChange = useCallback(async (nextType: StorageAdapterType) => {
    if (nextType === storageType) return;
    if (nextType === 'localfile') {
      if (!localFileAdapter.isAvailable()) {
        showToast(t.storageFolderUnsupported, 'error');
        return;
      }
      const ready = await localFileAdapter.ensureReady({ prompt: true });
      if (!ready) {
        showToast(t.storageFolderPickFailed, 'error');
        return;
      }
      setStorageFolderName(localFileAdapter.getFolderName());
    }
    storageReadyRef.current = false;
    setStorageType(nextType);
  }, [localFileAdapter, showToast, storageType, t.storageFolderPickFailed, t.storageFolderUnsupported]);

  useEffect(() => {
    if (isCloudMode) return;
    setStoredStorageType(storageType);
  }, [storageType]);

  const loadCloudProjects = useCallback(async (page: number, query: string, replace: boolean) => {
    setCloudLoading(true);
    try {
      const result = await storageAdapter.listProjects({
        page,
        pageSize: CLOUD_PAGE_SIZE,
        query
      });
      setProjects(prev => {
        const next = replace ? result.items : [...prev, ...result.items];
        lastSavedSnapshotRef.current = JSON.stringify(next);
        return next;
      });
      setCloudPage(page);
      setCloudHasMore(page * CLOUD_PAGE_SIZE < result.total);
    } catch (err) {
      showToast(t.storageLoadFailed, 'error');
    } finally {
      setCloudLoading(false);
    }
  }, [storageAdapter, showToast, t.storageLoadFailed]);

  useEffect(() => {
    let active = true;
    storageReadyRef.current = false;

    const loadProjects = async () => {
      try {
        const ready = await storageAdapter.ensureReady({ prompt: false });
        if (!active) return;
        if (!ready) {
          if (storageAdapter.type === 'localfile') {
            setStorageFolderName('');
          }
          setProjects([]);
          return;
        }

        if (isCloudMode) {
          // Cloud 模式的数据加载由单独的分页/搜索逻辑处理
          return;
        }

        const list = await storageAdapter.listProjects();
        if (!active) return;
        setProjects(list.items);
        // 记录已加载的快照，避免启动后立刻触发无意义的保存
        lastSavedSnapshotRef.current = JSON.stringify(list.items);
        if (storageType === 'localfile') {
          setStorageFolderName(localFileAdapter.getFolderName());
        }
      } catch (err) {
        if (active) showToast(t.storageLoadFailed, 'error');
      } finally {
        if (active) storageReadyRef.current = true;
      }
    };

    loadProjects();
    return () => {
      active = false;
    };
  }, [storageAdapter, storageType, localFileAdapter, t.storageLoadFailed, isCloudMode, showToast]);

  useEffect(() => {
    latestProjectsRef.current = projects;
  }, [projects]);

  const performAutoSave = useCallback((reason: 'auto' | 'leave' | 'manual') => {
    if (!storageReadyRef.current) return;

    const snapshot = JSON.stringify(latestProjectsRef.current);
    // 文件内容未变化时不保存
    if (snapshot === lastSavedSnapshotRef.current) return;

    const now = Date.now();
    if (reason === 'auto' && now - lastSavedAtRef.current < 5000) {
      const delay = 5000 - (now - lastSavedAtRef.current);
      if (saveTimerRef.current === null) {
        // 延迟到 5s 后再保存最新内容
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null;
          performAutoSave('auto');
        }, delay);
      }
      return;
    }

    storageAdapter.saveProjects(latestProjectsRef.current).then(() => {
      lastSavedAtRef.current = Date.now();
      lastSavedSnapshotRef.current = snapshot;
      if (reason === 'manual') {
        showToast(t.save || 'Saved');
      }
    }).catch(() => {
      showToast(t.storageSaveFailed, 'error');
    });
  }, [storageAdapter, showToast, t.storageSaveFailed]);

  useEffect(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [storageAdapter]);

  useEffect(() => {
    if (isCloudMode) return;
    performAutoSave('auto');
  }, [projects, performAutoSave]);

  useEffect(() => {
    if (prevViewRef.current === 'editor' && view !== 'editor') {
      // 离开编辑页时强制尝试保存（跳过 5s 限制）
      performAutoSave('leave');
    }
    prevViewRef.current = view;
  }, [view, performAutoSave]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      // 关闭浏览器时尝试保存最新内容
      performAutoSave('leave');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [performAutoSave]);

  useEffect(() => {
    if (project && view === 'editor') {
      setProjects(prev => prev.map(p => p.id === project.id ? { ...project, updatedAt: Date.now() } : p));
    }
  }, [project, view]);

  useEffect(() => { setStoredLanguage(lang); }, [lang]);

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

  const modifyProject = (modifier: (p: ProjectState) => ProjectState, saveToHistory: boolean = true) => {
    if (!saveToHistory) ignoreHistoryChange.current = true;
    setProject(prev => prev ? modifier(prev) : null);
  };

  const handleOpenBackgroundCrop = useCallback((src: string) => {
    setBgCropModal({ src });
    setBgCropPosition({ x: 0, y: 0 });
    setBgCropZoom(1);
    setBgCropRotation(0);
    setBgCropFlip({ horizontal: false, vertical: false });
    setBgCropAreaPixels(null);
  }, []);

  const handleConfirmBackgroundCrop = useCallback(async () => {
    if (!project || !bgCropModal || !bgCropAreaPixels) return;
    setBgCropSaving(true);
    try {
      const nextValue = await getCroppedImage(
        bgCropModal.src,
        bgCropAreaPixels,
        bgCropRotation,
        bgCropFlip,
        { width: project.canvasConfig.width, height: project.canvasConfig.height }
      );
      modifyProject(p => ({
        ...p,
        background: { ...p.background, type: 'image', value: nextValue }
      }));
      setBgCropModal(null);
    } catch (err) {
      showToast(t.cropFailed, 'error');
    } finally {
      setBgCropSaving(false);
    }
  }, [project, bgCropModal, bgCropAreaPixels, bgCropRotation, bgCropFlip, modifyProject, showToast, t.cropFailed]);

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

  const clampPresetSize = (value: number) => Math.max(10, Math.round(value));

  const createNewProject = (preset: typeof PRESET_RATIOS[0], overrides?: { width?: number; height?: number }) => {
    const width = clampPresetSize(overrides?.width ?? preset.width);
    const height = clampPresetSize(overrides?.height ?? preset.height);
    const ratioLabel = (width === preset.width && height === preset.height)
      ? preset.ratio
      : `${width}x${height}`;
    const textWidth = Math.max(10, width - 40);
    const textHeight = Math.max(10, Math.min(100, height - 40));
    const textX = Math.max(0, (width - textWidth) / 2);
    const textY = Math.max(0, (height - textHeight) / 2);
    const newProject: ProjectState = {
      id: generateId(), title: t.untitled, updatedAt: Date.now(),
      layers: [{ id: generateId(), name: t.defaultHeadlineName, type: 'text', content: t.doubleClickToEdit, x: textX, y: textY, width: textWidth, height: textHeight, fontSize: 64, fontFamily: 'Inter, sans-serif', fontWeight: 700, textAlign: 'center', writingMode: 'horizontal', rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1, color: '#ffffff', ratioLocked: true }],
      background: { 
        type: 'color', 
        value: '#1e293b', 
        overlayType: 'none', 
        overlayColor: '#ffffff', 
        overlayOpacity: 0.1, 
        overlayScale: 20 
      },
      canvasConfig: { width, height, ratio: ratioLabel },
      selectedLayerId: null
    };
    setProject(newProject);
    setProjects(prev => [newProject, ...prev]);
    setView('editor');
    initProjectHistory(newProject);
  };

  const openPresetModal = () => {
    const preset = PRESET_RATIOS[0];
    setSelectedPreset(preset);
    setCustomPresetSize({ width: preset.width, height: preset.height });
    setIsPresetModalOpen(true);
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
    const json = JSON.stringify({ ...targetProject, version: APP_VERSION, github: GITHUB_REPO_URL }, null, 2);
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
        pixelRatio: 1,
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

  const handleExportImageWithDeselect = async (previewNode: HTMLDivElement | null, targetProject: ProjectState) => {
    if (!project) return;
    const prevSelectedId = project.selectedLayerId;
    const prevSelectedIds = [...selectedLayerIds];

    if (prevSelectedId || prevSelectedIds.length > 0) {
      setSelectedLayerIds([]);
      modifyProject(p => ({ ...p, selectedLayerId: null }), false);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }

    try {
      await handleExportImage(previewNode, targetProject);
    } finally {
      if (prevSelectedId || prevSelectedIds.length > 0) {
        setSelectedLayerIds(prevSelectedIds);
        modifyProject(p => ({ ...p, selectedLayerId: prevSelectedId }), false);
      }
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

  // 提取公共的 SVG 处理函数
const createSvgLayer = (svgContent: string, canvasWidth: number, canvasHeight: number, layerName: string) => {
    try {
      // 解析 SVG 获取 viewBox 信息
      const svgElement = new DOMParser().parseFromString(svgContent, 'image/svg+xml').documentElement;
      let viewBox = svgElement.getAttribute('viewBox');
      let svgWidth: number, svgHeight: number;
      
      if (viewBox) {
        const vbParts = viewBox.split(/[ ,]+/).map(Number);
        if (vbParts.length === 4) {
          svgWidth = vbParts[2];
          svgHeight = vbParts[3];
        } else {
          svgWidth = parseFloat(svgElement.getAttribute('width') || '200');
          svgHeight = parseFloat(svgElement.getAttribute('height') || '200');
        }
      } else {
        svgWidth = parseFloat(svgElement.getAttribute('width') || '200');
        svgHeight = parseFloat(svgElement.getAttribute('height') || '200');
      }
      
      svgWidth = Math.max(svgWidth, 1);
      svgHeight = Math.max(svgHeight, 1);
      
      // 计算初始大小：最大不超过画布的70%，并保持原始宽高比
      const maxSize = Math.min(canvasWidth * 0.7, canvasHeight * 0.7);
      const svgRatio = svgWidth / svgHeight;
      
      let width, height;
      if (svgRatio > 1) {
        width = maxSize;
        height = maxSize / svgRatio;
      } else {
        height = maxSize;
        width = maxSize * svgRatio;
      }
      
      width = Math.max(40, width);
      height = Math.max(40, height);
      
      return {
        id: generateId(),
        name: layerName,
        type: 'svg' as const,
        content: svgContent,
        x: canvasWidth / 2 - width / 2,
        y: canvasHeight / 2 - height / 2,
        width,
        height,
        rotation: 0,
        zIndex: 0, // 调用时再设置
        visible: true,
        locked: false,
        opacity: 1,
        color: '#3b82f6',
        ratioLocked: true
      };
    } catch (e) {
      // 解析失败时使用默认大小
      const defaultSize = Math.min(200, canvasWidth * 0.5, canvasHeight * 0.5);
      return {
        id: generateId(),
        name: layerName,
        type: 'svg' as const,
        content: svgContent,
        x: canvasWidth / 2 - defaultSize / 2,
        y: canvasHeight / 2 - defaultSize / 2,
        width: defaultSize,
        height: defaultSize,
        rotation: 0,
        zIndex: 0,
        visible: true,
        locked: false,
        opacity: 1,
        color: '#3b82f6',
        ratioLocked: true
      };
    }
  };

  const addSvgLayerWithContent = (svgText: string) => {
    if (!project) return;
    const normalized = normalizeSVG(svgText);
    const newLayer = createSvgLayer(
      normalized,
      project.canvasConfig.width,
      project.canvasConfig.height,
      t.svgLayerName
    );
    newLayer.zIndex = project.layers.length + 1;
    
    modifyProject(p => ({
      ...p,
      layers: [...p.layers, newLayer],
      selectedLayerId: newLayer.id
    }));
    setSelectedLayerIds([newLayer.id]);
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
  }, [project, handleUndo, handleRedo, updateLayer, lang, selectedLayerIds, handleDeleteLayers, handleCloneLayers, handleGroupLayers, performAutoSave]);

  const groupedProjects = useMemo(() => {
    const filtered = isCloudMode
      ? projects
      : projects.filter(p => p.title.toLowerCase().includes(projectSearchTerm.toLowerCase()));
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

  const renderStorageSettingsModal = () => {
    if (!isStorageSettingsOpen) return null;
    const storageHint = storageType === 'localfile'
      ? t.storageLocalFolder
      : t.storageIndexedDb;
    return (
      <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm" onClick={() => setIsStorageSettingsOpen(false)}>
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <div className="text-xs font-black uppercase tracking-widest text-slate-500">{t.storageSettings}</div>
            <button type="button" onClick={() => setIsStorageSettingsOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t.storageMode}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleStorageTypeChange('indexeddb')}
                title={t.storageIndexedDb}
                className={`flex-1 px-3 py-2 text-[10px] font-bold uppercase rounded-lg border transition-all ${storageType === 'indexeddb'
                  ? 'bg-blue-600 text-white border-blue-400 shadow-lg'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-600'}`}
              >
                DB
              </button>
              <button
                type="button"
                onClick={() => handleStorageTypeChange('localfile')}
                title={t.storageLocalFolder}
                className={`flex-1 px-3 py-2 text-[10px] font-bold uppercase rounded-lg border transition-all ${storageType === 'localfile'
                  ? 'bg-blue-600 text-white border-blue-400 shadow-lg'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-600'}`}
              >
                Folder
              </button>
              {storageType === 'localfile' && (
                <button
                  type="button"
                  onClick={handlePickStorageFolder}
                  title={t.storageFolderPick}
                  className="px-3 py-2 text-[10px] font-bold uppercase rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  {t.storageFolderPick}
                </button>
              )}
            </div>
            <div className="text-[10px] text-slate-500 truncate" title={storageHint}>
              {storageHint}
            </div>
            {storageType === 'localfile' && (
              <div className="text-[10px] text-slate-400 truncate" title={storageFolderName || t.storageFolderUnset}>
                {storageFolderName || t.storageFolderUnset}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };


  const handleProjectsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!isCloudMode || cloudLoading || !cloudHasMore) return;
    const target = e.currentTarget;
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remaining > 120) return;
    loadCloudProjects(cloudPage + 1, projectSearchTerm.trim(), false);
  };

  useEffect(() => {
    if (!isCloudMode) return;
    const handle = window.setTimeout(() => {
      loadCloudProjects(1, projectSearchTerm.trim(), true);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [projectSearchTerm, isCloudMode, loadCloudProjects]);

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 p-8 flex flex-col gap-12 max-w-8xl mx-auto h-screen overflow-hidden" style={{ maxWidth: '95%' }}>
        {toast && <Toast message={toast.msg} type={toast.type} />}
        {confirmDialog && <ConfirmModal isOpen={true} message={confirmDialog.message} lang={lang} onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />}
        {!isCloudMode && renderStorageSettingsModal()}
        <ProjectPresetModal
          isOpen={isPresetModalOpen}
          lang={lang}
          presets={PRESET_RATIOS}
          selectedPreset={selectedPreset}
          size={customPresetSize}
          onClose={() => setIsPresetModalOpen(false)}
          onSelectPreset={(preset) => {
            setSelectedPreset(preset);
            setCustomPresetSize({ width: preset.width, height: preset.height });
          }}
          onSizeChange={(next) => setCustomPresetSize(next)}
          onCreate={() => {
            createNewProject(selectedPreset, customPresetSize);
            setIsPresetModalOpen(false);
          }}
        />
        <div className="flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-4"><div className="bg-blue-600 p-2.5 rounded-2xl shadow-xl shadow-blue-900/20 text-white"><span className="w-8 h-8 block" dangerouslySetInnerHTML={{ __html: logoSvg }} /></div><div className="relative"><h1 className="text-3xl font-black tracking-tight text-white">{t.title}</h1><p className="text-slate-500 text-sm font-medium">{t.landingHeader}</p>
          <a href={GITHUB_REPO_URL}
                target="_blank"
                rel="noreferrer"
                title={`GitHub Repository v${APP_VERSION}`}>
                  <span className="absolute top-0 left-full ml-2 px-1.5 py-0.5 rounded-full bg-slate-900 text-[9px] font-black tracking-tight text-white border border-slate-700">v{APP_VERSION}</span>
          </a></div></div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={openPresetModal}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-900/20 transition-all"
            >
              <Plus className="w-4 h-4" />
              {t.createNew}
            </button>
            <label className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl hover:border-blue-500 cursor-pointer transition-all">
              <Upload className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-bold">{t.import}</span>
              <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
            </label>
            {!isCloudMode && (
              <button
                type="button"
                onClick={() => setIsStorageSettingsOpen(true)}
                className="flex items-center gap-2 px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl hover:border-blue-500 transition-all"
              >
                <Settings className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold">{t.storageSettings}</span>
              </button>
            )}
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800"><button onClick={() => setLang('zh')} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${lang === 'zh' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200'}`}>中</button><button onClick={() => setLang('en')} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${lang === 'en' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200'}`}>EN</button></div>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col gap-6 overflow-hidden">
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
          
          <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar space-y-10 pb-16" onScroll={handleProjectsScroll}>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6">
                    {group.items.map(p => (
                      <ProjectCard 
                        key={p.id} 
                        project={p} 
                        lang={lang} 
                        onClick={() => { 
                          setProject(JSON.parse(JSON.stringify(p))); 
                          setView('editor'); 
                          initProjectHistory(p); 
                        }} 
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
            {isCloudMode && cloudLoading && (
              <div className="flex items-center justify-center py-6 text-xs text-slate-500">{t.loading || 'Loading...'}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!project) return null;

  const cropAspect = project.canvasConfig.width / project.canvasConfig.height;
  const cropSize = (() => {
    const maxWidth = 720;
    const maxHeight = 420;
    let width = maxWidth;
    let height = width / cropAspect;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * cropAspect;
    }
    return { width: Math.round(width), height: Math.round(height) };
  })();

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 overflow-hidden">
      {toast && <Toast message={toast.msg} type={toast.type} />}
      {confirmDialog && <ConfirmModal isOpen={true} message={confirmDialog.message} lang={lang} onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />}
      <BackgroundCropModal
        isOpen={Boolean(bgCropModal)}
        imageSrc={bgCropModal?.src || null}
        aspect={cropAspect}
        cropSize={cropSize}
        crop={bgCropPosition}
        zoom={bgCropZoom}
        rotation={bgCropRotation}
        flip={bgCropFlip}
        onCropChange={setBgCropPosition}
        onZoomChange={setBgCropZoom}
        onRotationChange={setBgCropRotation}
        onCropAreaChange={setBgCropAreaPixels}
        onFlipChange={(updates) => setBgCropFlip(prev => ({ ...prev, ...updates }))}
        onCancel={() => setBgCropModal(null)}
        onConfirm={handleConfirmBackgroundCrop}
        isSaving={bgCropSaving}
        lang={lang}
      />
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
          {isCloudMode && (
            <button
              onClick={() => performAutoSave('manual')}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-lg text-slate-300 border border-slate-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              {t.save || 'Save'}
            </button>
          )}
          <button onClick={() => handleExportJson(project)} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-lg text-slate-300 border border-slate-700 transition-colors">
            <FileOutput className="w-4 h-4" />
            {t.exportJson}
          </button>
          <button onClick={() => handleExportImageWithDeselect(document.getElementById('export-target') as HTMLDivElement, project)} disabled={isExporting} className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-lg text-white shadow-lg shadow-blue-900/20 disabled:opacity-50">
            {isExporting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Download className="w-4 h-4" />}
            {t.export}
          </button>
        </div>
      </header>
      <main className="flex-1 flex overflow-hidden min-h-0 relative">
        <Sidebar 
          lang={lang} 
          activeTab={activeTab} 
          setActiveTab={setActiveTab} 
          background={project.background} 
          onOpenBackgroundCrop={handleOpenBackgroundCrop}
          storageType={isCloudMode ? 'indexeddb' : storageType}
          localFileAdapter={localFileAdapter}
          onAddLayer={(l) => {
            // 处理 SVG 图层的特殊逻辑
            if (l.type === 'svg' && l.content) {
              const newLayer = createSvgLayer(
                l.content,
                project.canvasConfig.width,
                project.canvasConfig.height,
                l.name || t.defaultLayerName
              );
              newLayer.zIndex = project.layers.length + 1;
              newLayer.color = l.color || '#3b82f6';
              
              modifyProject(p => ({
                ...p,
                layers: [...p.layers, newLayer]
              }));
              return;
            }
            
            // 非 SVG 图层保持原有逻辑
            modifyProject(p => ({
              ...p,
              layers: [...p.layers, {
                id: generateId(),
                name: l.name || t.defaultLayerName,
                type: l.type || 'svg',
                content: l.content || '',
                x: p.canvasConfig.width / 2 - (l.width || 100) / 2,
                y: p.canvasConfig.height / 2 - (l.height || 100) / 2,
                width: l.width || 100,
                height: l.height || 100,
                rotation: 0,
                zIndex: p.layers.length + 1,
                visible: true,
                locked: false,
                opacity: 1,
                color: l.color || '#3b82f6',
                ratioLocked: true
              }]
            }));
          }}
          onUpdateBackground={(bg) => modifyProject(p => ({ ...p, background: { ...p.background, ...bg } }))} 
        />
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
