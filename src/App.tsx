// 模块：应用入口与主编辑流程
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Sidebar from './components/Sidebar.tsx';
import Canvas from './components/Canvas.tsx';
import LayersPanel from './components/LayersPanel.tsx';
import Toast from './components/Toast.tsx';
import ConfirmModal from './components/ConfirmModal.tsx';
import BackgroundCropModal from './components/BackgroundCropModal.tsx';
import ImageLayerCropModal from './components/ImageLayerCropModal.tsx';
import LandingView from './views/LandingView.tsx';
import ProjectPresetModal from './components/ProjectPresetModal.tsx';
import ExportModal from './components/ExportModal.tsx';
import PagesPanel from './components/PagesPanel.tsx';
import { usePageThumbnails } from './hooks/usePageThumbnails.ts';
import AiAssistant from './features/ai/components/AiAssistant.tsx';
import type { WorkspaceOptions } from './features/ai/services/workspace.ts';
import { updateProjectLayer } from './features/ai/domain/layerOperations.ts';
import { ensureProjectFonts } from './features/ai/services/fontLoading.ts';
import { applyRemovalResult } from './features/background-removal/layerResult.ts';
import type { RemovalResult } from './features/background-removal/types.ts';
import { PWAUpdatePrompt } from './components/pwa/PWAUpdatePrompt.tsx';
import { OfflineIndicator } from './components/pwa/OfflineIndicator.tsx';
// Tauri 环境下的本地文件适配器
import { useLocalProjects, type RecentProjectItem } from './hooks/useLocalProjects.ts';
import { useProjectHistory } from './hooks/useProjectHistory.ts';
import { useProjectAutoSave } from './hooks/useProjectAutoSave.ts';
import { useEditorShortcuts } from './hooks/useEditorShortcuts.ts';
import { ProjectState, Layer, DecorationTemplate, PresetRatio } from './types.ts';
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
import { getAssetFolder } from './storage/assets.ts';
import { PRESET_RATIOS } from './constants.ts';
import { generateId, downloadFile, normalizeSVG, isNewerProjectVersion } from './utils/helpers.ts';
import { buildProjectSvg } from './utils/svgExport.ts';
import { readProject, syncProjectPages, writeProject } from './storage/projectCompatibility.ts';
import { copyProject, deleteProjectPage, insertProjectPage, moveProjectPage, pageNumber, renameProjectPage, selectProjectPage } from './utils/projectPages.ts';
import { exportProjectPages } from './utils/exportPages.ts';
import { clampDecorationSize } from './utils/decorationStyles.ts';
import { getCroppedImage } from './utils/imageCrop.ts';
import { computeCroppedLayerGeometry } from './utils/imageLayer.ts';
import { encodeWebp, MAX_IMAGE_EDGE } from './features/ai/services/imageAttachments.ts';
import { type Area } from 'react-easy-crop';
import {
  Download, ArrowLeft, Type as TextIcon, ImagePlus, FileOutput, Undo2, Redo2, X, Save, Bot
} from 'lucide-react';
import * as htmlToImage from 'html-to-image';
import packageInfo from '../package.json';

const APP_VERSION = packageInfo.version;
const GITHUB_REPO_URL = 'https://github.com/sangyuxiaowu/CoverFlow';
const isCloudMode = import.meta.env.VITE_APP_MODE === 'cloud';
const CLOUD_PAGE_SIZE = 9;

type ExportFormat = 'png' | 'jpeg' | 'webp' | 'svg' | 'pptx';
type ExportCompression = 'lossless' | 'balanced' | 'small';

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
  
  const [view, setView] = useState<'landing' | 'editor'>('landing');
  const [aiBusy, setAiBusy] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [project, setProjectState] = useState<ProjectState | null>(null);
  const setProject = useCallback<React.Dispatch<React.SetStateAction<ProjectState | null>>>((update) => {
    setProjectState(previous => {
      const next = typeof update === 'function' ? update(previous) : update;
      return next ? syncProjectPages(next) : null;
    });
  }, []);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>('assets');
  const [isExporting, setIsExporting] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' | 'warning' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string, onConfirm: () => void } | null>(null);
  const [isStorageSettingsOpen, setIsStorageSettingsOpen] = useState(false);
  const [projectSearchTerm, setProjectSearchTerm] = useState('');
  const [cloudPage, setCloudPage] = useState(1);
  const [cloudHasMore, setCloudHasMore] = useState(true);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [isPageModalOpen, setIsPageModalOpen] = useState(false);
  const [newPageName, setNewPageName] = useState('');
  const pageThumbnails = usePageThumbnails(view === 'editor' ? project : null);
  const [selectedPreset, setSelectedPreset] = useState<PresetRatio>(() => PRESET_RATIOS[0]);
  const [customPresetSize, setCustomPresetSize] = useState(() => ({
    width: PRESET_RATIOS[0].width,
    height: PRESET_RATIOS[0].height
  }));
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportRange, setExportRange] = useState<'current' | 'multiple' | 'all'>('current');
  const [exportPageIds, setExportPageIds] = useState<string[]>([]);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [exportSettings, setExportSettings] = useState<{
    pixelRatio: 0.5 | 1 | 1.5 | 2;
    format: ExportFormat;
    compression: ExportCompression;
  }>({
    pixelRatio: 1,
    format: 'png',
    compression: 'lossless'
  });
  const [exportEstimatedSize, setExportEstimatedSize] = useState<number | null>(null);
  const [exportPreviewUrl, setExportPreviewUrl] = useState<string | null>(null);
  const [exportEstimating, setExportEstimating] = useState(false);
  
  const { initProjectHistory, modifyProject, saveHistorySnapshot, handleUndo, handleRedo, canUndo, canRedo } = useProjectHistory(project, setProject);

  const [bgCropModal, setBgCropModal] = useState<{ src: string } | null>(null);
  const [bgCropPosition, setBgCropPosition] = useState({ x: 0, y: 0 });
  const [bgCropZoom, setBgCropZoom] = useState(1);
  const [bgCropRotation, setBgCropRotation] = useState(0);
  const [bgCropFlip, setBgCropFlip] = useState({ horizontal: false, vertical: false });
  const [bgCropAreaPixels, setBgCropAreaPixels] = useState<Area | null>(null);
  const [bgCropSaving, setBgCropSaving] = useState(false);
  const [croppingImageLayerId, setCroppingImageLayerId] = useState<string | null>(null);


  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'warning' = 'success') => {
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), type === 'warning' ? 6000 : 3000);
  }, []);

  const warnIfNewerProject = useCallback((nextProject: ProjectState) => {
    if (!isNewerProjectVersion(nextProject.version, APP_VERSION)) return false;
    showToast(t.newerProjectVersion
      .replace('{projectVersion}', nextProject.version!)
      .replace('{currentVersion}', APP_VERSION), 'warning');
    return true;
  }, [showToast, t.newerProjectVersion]);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void ensureProjectFonts(project).catch(error => {
      if (!cancelled) showToast(error instanceof Error ? error.message : String(error), 'error');
    });
    return () => { cancelled = true; };
  }, [project?.layers, showToast]);

  const reportStorageError = useCallback((error: unknown, operation: string, message: string, projectId?: string, path?: string | null) => {
    console.error('[CoverFlow storage]', { operation, storageType: path ? 'tauri-file' : storageAdapter.type, projectId, path }, error);
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    showToast(`${message}: ${detail}`, 'error');
  }, [showToast, storageAdapter]);


  const handleLocalProjectUpdate = useCallback((nextProject: ProjectState) => {
    setProject(nextProject);
  }, []);

  const {
    isTauri,
    localRecentItems,
    activeLocalFilePath,
    openLocalProjectDialog,
    openLocalProjectFromPath,
    removeLocalRecentByPath,
    saveLocalProjectToFile,
    clearActiveLocalFilePath
  } = useLocalProjects({
    view,
    parseFailedMessage: t.parseFailed,
    showToast,
    onOpenProject: (nextProject) => {
      warnIfNewerProject(nextProject);
      setProject(nextProject);
      setView('editor');
      initProjectHistory(nextProject);
    },
    onUpdateProject: handleLocalProjectUpdate
  });

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
        return next;
      });
      setCloudPage(page);
      setCloudHasMore(page * CLOUD_PAGE_SIZE < result.total);
    } catch (err) {
      reportStorageError(err, 'list-projects', t.storageLoadFailed);
    } finally {
      setCloudLoading(false);
    }
  }, [storageAdapter, reportStorageError, t.storageLoadFailed]);

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
        if (storageType === 'localfile') {
          setStorageFolderName(localFileAdapter.getFolderName());
        }
      } catch (err) {
        if (active) reportStorageError(err, 'load-projects', t.storageLoadFailed);
      } finally {
        if (active) storageReadyRef.current = true;
      }
    };

    loadProjects();
    return () => {
      active = false;
    };
  }, [storageAdapter, storageType, localFileAdapter, t.storageLoadFailed, isCloudMode, reportStorageError]);

  const { performAutoSave, persistProject, latestProjectRef, cancelPendingSave } = useProjectAutoSave({
    project, view, storageAdapter, storageReadyRef, isCloudMode, isTauri, activeLocalFilePath,
    saveLocalProjectToFile, clearActiveLocalFilePath, showToast, reportStorageError,
    savedMessage: t.save || 'Saved', saveFailedMessage: t.storageSaveFailed
  });

  const removeStoredProject = useCallback(async (projectId: string) => {
    try {
      await storageAdapter.deleteProject(projectId);
    } catch (err) {
      reportStorageError(err, 'delete-project', t.storageDeleteFailed, projectId);
    }
  }, [storageAdapter, reportStorageError, t.storageDeleteFailed]);

  const deleteProjectById = useCallback((projectId: string) => {
    setProjects(prev => prev.filter(pr => pr.id !== projectId));
    if (project?.id === projectId) {
      setProject(null);
      setView('landing');
    }
    removeStoredProject(projectId);
  }, [project?.id, removeStoredProject]);


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
      modifyProject(p => p.id !== project.id || p.activePageId !== project.activePageId ? p : ({
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


  const clampPresetSize = (value: number) => Math.max(10, Math.round(value));

  const createNewProject = (preset: PresetRatio, overrides?: { width?: number; height?: number }) => {
    const width = clampPresetSize(overrides?.width ?? preset.width);
    const height = clampPresetSize(overrides?.height ?? preset.height);
    const ratioLabel = (width === preset.width && height === preset.height)
      ? preset.ratio
      : `${width}x${height}`;
    const textWidth = Math.max(10, width - 40);
    const textHeight = Math.max(10, Math.min(100, height - 40));
    const textX = Math.max(0, (width - textWidth) / 2);
    const textY = Math.max(0, (height - textHeight) / 2);
    const newProject = syncProjectPages({
      id: generateId(), version: APP_VERSION, title: t.untitled, updatedAt: Date.now(),
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
    });
    setProject(newProject);
    setProjects(prev => [newProject, ...prev]);
    setView('editor');
    initProjectHistory(newProject);
    clearActiveLocalFilePath();
    persistProject(newProject);
  };

  const openPresetModal = () => {
    const preset = PRESET_RATIOS[0];
    setSelectedPreset(preset);
    setCustomPresetSize({ width: preset.width, height: preset.height });
    setIsPresetModalOpen(true);
  };

  const openPageModal = () => {
    if (!project || (project.pages?.length ?? 1) >= 99) return;
    const config = project.canvasConfig;
    setSelectedPreset(PRESET_RATIOS.find(preset => preset.width === config.width && preset.height === config.height) ?? { name: 'Current', nameZh: '当前尺寸', ...config });
    setCustomPresetSize({ width: config.width, height: config.height });
    setNewPageName('');
    setIsPageModalOpen(true);
  };

  const switchPage = (pageId: string) => {
    saveHistorySnapshot();
    modifyProject(current => selectProjectPage(current, pageId));
    setSelectedLayerIds([]);
    setBgCropModal(null);
    setCroppingImageLayerId(null);
  };

  const updateExportSettings = useCallback((updates: Partial<typeof exportSettings>) => {
    setExportSettings(prev => {
      const next = { ...prev, ...updates };
      if (next.format === 'png' || next.format === 'svg' || next.format === 'pptx') {
        next.compression = 'lossless';
      }
      return next;
    });
  }, []);

  const getExportQuality = (settings: typeof exportSettings) => {
    if (settings.format === 'png' || settings.format === 'svg' || settings.format === 'pptx') return undefined;
    if (settings.compression === 'lossless') return 0.92;
    if (settings.compression === 'balanced') return 0.8;
    return 0.6;
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const buildExportOptions = (targetProject: ProjectState, pixelRatio: number) => {
    const { width, height } = targetProject.canvasConfig;
    return {
      pixelRatio,
      width,
      height,
      style: {
        transform: 'scale(1)',
        transformOrigin: 'top left',
        width: `${width}px`,
        height: `${height}px`
      }
    };
  };

  const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create blob'));
    }, type, quality);
  });

  const dataUrlToBlob = async (dataUrl: string) => {
    const res = await fetch(dataUrl);
    return res.blob();
  };

  const buildExportBlob = async (
    previewNode: HTMLDivElement,
    targetProject: ProjectState,
    settings: typeof exportSettings
  ) => {
    await ensureProjectFonts(targetProject);
    if (settings.format === 'svg') {
      const svgMarkup = buildProjectSvg(targetProject);
      return new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    }

    const options = buildExportOptions(targetProject, settings.pixelRatio);
    const quality = getExportQuality(settings);

    if (settings.format === 'png' || settings.format === 'pptx') {
      const blob = await htmlToImage.toBlob(previewNode, options);
      if (!blob) throw new Error('Export failed');
      return blob;
    }

    if (settings.format === 'jpeg') {
      const dataUrl = await htmlToImage.toJpeg(previewNode, { ...options, quality });
      return dataUrlToBlob(dataUrl);
    }

    const canvas = await htmlToImage.toCanvas(previewNode, options);
    return canvasToBlob(canvas, 'image/webp', quality);
  };

  const buildExportDataUrl = async (
    previewNode: HTMLDivElement,
    targetProject: ProjectState,
    settings: typeof exportSettings
  ) => {
    await ensureProjectFonts(targetProject);
    if (settings.format === 'svg') {
      const svgMarkup = buildProjectSvg(targetProject);
      const bytes = new TextEncoder().encode(svgMarkup);
      let binary = '';
      bytes.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      return `data:image/svg+xml;base64,${btoa(binary)}`;
    }

    const options = buildExportOptions(targetProject, settings.pixelRatio);
    const quality = getExportQuality(settings);

    if (settings.format === 'png' || settings.format === 'pptx') {
      return htmlToImage.toPng(previewNode, options);
    }

    if (settings.format === 'jpeg') {
      return htmlToImage.toJpeg(previewNode, { ...options, quality });
    }

    const canvas = await htmlToImage.toCanvas(previewNode, options);
    return canvas.toDataURL('image/webp', quality);
  };

  const copyTextToClipboard = async (value: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }
    } catch (err) {
      // fall back to execCommand path below
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!copied) {
      throw new Error('Clipboard copy failed');
    }
  };

  const withDeselectedExportPreview = async <Result,>(action: () => Promise<Result>): Promise<Result | undefined> => {
    if (!project) return undefined;
    const prevSelectedId = project.selectedLayerId;
    const prevSelectedIds = [...selectedLayerIds];

    if (prevSelectedId || prevSelectedIds.length > 0) {
      setSelectedLayerIds([]);
      modifyProject(p => ({ ...p, selectedLayerId: null }), false);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }

    try {
      return await action();
    } finally {
      if (prevSelectedId || prevSelectedIds.length > 0) {
        setSelectedLayerIds(prevSelectedIds);
        modifyProject(p => ({ ...p, selectedLayerId: prevSelectedId }), false);
      }
    }
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
      if (!p.layers.some(layer => layer.id === id)) return p;
      return updateProjectLayer(p, id, updates);
    }, record);
  }, []);

  const handleRemoveBackground = (result: RemovalResult) => {
    const projectId = project?.id;
    const pageId = project?.activePageId;
    const copyId = generateId();
    modifyProject(current => current.id === projectId && current.activePageId === pageId ? applyRemovalResult(current, result, copyId) : current);
  };

  const getExpandedSelection = (layers: Layer[], ids: string[]) => {
    const expanded = new Set(ids);
    layers.forEach(l => {
      if (l.type === 'group' && expanded.has(l.id)) {
        (l.children || []).forEach(childId => expanded.add(childId));
      }
    });
    return expanded;
  };

  const handleSelectLayer = (
    id: string | null,
    mode: 'replace' | 'toggle' | 'range' | 'range-add' = 'replace',
    orderedIds?: string[]
  ) => {
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

    if (mode === 'range' || mode === 'range-add') {
      const idsInOrder = orderedIds && orderedIds.length > 0 ? orderedIds : [...project.layers]
        .sort((a, b) => b.zIndex - a.zIndex)
        .map(l => l.id);
      const anchorId = project.selectedLayerId || selectedLayerIds[selectedLayerIds.length - 1] || id;
      const start = idsInOrder.indexOf(anchorId);
      const end = idsInOrder.indexOf(id);

      if (start === -1 || end === -1) {
        setSelectedLayerIds([id]);
        modifyProject(p => ({ ...p, selectedLayerId: id }), false);
        return;
      }

      const [from, to] = start < end ? [start, end] : [end, start];
      const rangeIds = idsInOrder.slice(from, to + 1);
      const nextIds = mode === 'range-add'
        ? Array.from(new Set([...selectedLayerIds, ...rangeIds]))
        : rangeIds;
      setSelectedLayerIds(nextIds);
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
        const imported = readProject(JSON.parse(event.target?.result as string));
        if (imported.id && imported.layers) {
          const existingProjectIds = new Set(projects.map(p => p.id));
          if (existingProjectIds.has(imported.id)) {
            imported.id = generateId();
            imported.updatedAt = Date.now();
            imported.title += t.importedCopySuffix;
          }
          imported.selectedLayerId = null;
          setProjects(prev => [imported, ...prev]);
          persistProject(imported);
          if (!warnIfNewerProject(imported)) showToast(t.importSuccess);
        }
      } catch (err) {
        showToast(t.parseFailed, "error");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportJson = (targetProject: ProjectState) => {
    const json = JSON.stringify({ ...writeProject(targetProject), github: GITHUB_REPO_URL }, null, 2);
    downloadFile(json, `${targetProject.title}.cfj`, 'application/json');
    showToast(t.exportSuccess);
  };

  const handleDuplicateProject = (targetProject: ProjectState) => {
    const duplicated = copyProject(targetProject, `${targetProject.title}(${t.importedCopySuffix})`);

    setProjects(prev => [duplicated, ...prev]);
    persistProject(duplicated);
    showToast(t.importedCopySuffix);
  };

  // 基于预览节点导出 PNG
  const handleExportImage = async (previewNode: HTMLDivElement | null, targetProject: ProjectState) => {
    if (!previewNode) {
      showToast(t.exportPreviewMissing, "error");
      return;
    }
    setIsExporting(true);
    try { 
      await ensureProjectFonts(targetProject);
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

  const handleExportPages = async () => {
    if (!project || isExporting) return;
    setIsExporting(true);
    try {
      const ids = exportRange === 'current' ? [project.activePageId!] : exportRange === 'all' ? project.pages!.map(page => page.id) : exportPageIds;
      const result = await exportProjectPages(project, ids, exportSettings, (done, total) => setExportProgress({ done, total }));
      downloadBlob(result.blob, result.filename);
      setIsExportModalOpen(false);
      showToast(t.exportSuccess);
    } catch (error) {
      console.error('[CoverFlow export]', error);
      showToast(t.exportFailed, 'error');
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  const handleCopyExportBase64WithDeselect = async (
    previewNode: HTMLDivElement | null,
    targetProject: ProjectState,
    settings: typeof exportSettings
  ) => {
    await withDeselectedExportPreview(async () => {
      try {
        if (!previewNode) {
          showToast(t.exportPreviewMissing, 'error');
          return;
        }
        setIsExporting(true);
        const dataUrl = await buildExportDataUrl(previewNode, targetProject, settings);
        await copyTextToClipboard(dataUrl);
        showToast(t.copyBase64Success);
      } catch (e) {
        showToast(t.copyBase64Failed, 'error');
      } finally {
        setIsExporting(false);
      }
    });
  };

  const handleCopyExportImageWithDeselect = async (
    previewNode: HTMLDivElement | null,
    targetProject: ProjectState,
    settings: typeof exportSettings
  ) => {
    await withDeselectedExportPreview(async () => {
      try {
        if (!previewNode) {
          showToast(t.exportPreviewMissing, 'error');
          return;
        }
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
          throw new Error('Clipboard image write unsupported');
        }
        setIsExporting(true);
        await ensureProjectFonts(targetProject);
        const options = buildExportOptions(targetProject, settings.pixelRatio);
        const rawBlob = await htmlToImage.toBlob(previewNode, options);
        if (!rawBlob) {
          throw new Error('Failed to generate PNG blob');
        }
        const blob = rawBlob.type === 'image/png' ? rawBlob : new Blob([rawBlob], { type: 'image/png' });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast(t.copyImageSuccess);
      } catch (e) {
        showToast(t.copyImageFailed, 'error');
      } finally {
        setIsExporting(false);
      }
    });
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

  const createDecorationLayer = (
    cssText: string,
    canvasWidth: number,
    canvasHeight: number,
    layerName: string,
    options?: { width?: number; height?: number }
  ) => {
    const width = clampDecorationSize(options?.width ?? Math.min(280, canvasWidth * 0.4), 220);
    const height = clampDecorationSize(options?.height ?? Math.min(180, canvasHeight * 0.3), 120);

    return {
      id: generateId(),
      name: layerName,
      type: 'decoration' as const,
      content: cssText,
      x: canvasWidth / 2 - width / 2,
      y: canvasHeight / 2 - height / 2,
      width,
      height,
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      opacity: 1,
      ratioLocked: false
    };
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
          imageSource: 'upload',
          imageDescription: '',
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
            if (latestProjectRef.current?.id !== project.id || latestProjectRef.current?.activePageId !== project.activePageId) return;
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
              imageSource: 'upload',
              imageDescription: file.name,
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

  const handleApplyDecorationTemplate = (template: DecorationTemplate) => {
    if (!project || template.layers.length === 0) return;
    const offsetX = (project.canvasConfig.width - template.width) / 2;
    const offsetY = (project.canvasConfig.height - template.height) / 2;
    const baseZIndex = Math.max(0, ...project.layers.map((layer) => layer.zIndex));
    const nextLayers = [...template.layers]
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((layer, index) => ({
        ...JSON.parse(JSON.stringify(layer)),
        id: generateId(),
        x: offsetX + layer.x,
        y: offsetY + layer.y,
        zIndex: baseZIndex + index + 1,
        visible: true,
        locked: false,
        parentId: undefined,
        children: undefined
      }));

    const nextSelectedIds = nextLayers.map((layer) => layer.id);
    const nextActiveId = nextSelectedIds[nextSelectedIds.length - 1] || null;
    modifyProject((currentProject) => ({
      ...currentProject,
      layers: [...currentProject.layers, ...nextLayers],
      selectedLayerId: nextActiveId
    }));
    setSelectedLayerIds(nextSelectedIds);
  };

  
  useEditorShortcuts({
    view, project, aiBusy, selectedLayerIds, handleUndo, handleRedo, performAutoSave, modifyProject,
    updateLayer, handleDeleteLayers, handleCloneLayers, handleGroupLayers, addSvgLayerWithContent,
    addImageLayerWithContent, addTextLayerWithContent, applyProjectFromJson
  });

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

  useEffect(() => {
    if (!isExportModalOpen || !project) {
      setExportPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const node = document.getElementById('export-target') as HTMLDivElement | null;
    if (!node) return;

    let cancelled = false;
    setExportEstimating(true);
    const handle = window.setTimeout(async () => {
      try {
        const blob = await buildExportBlob(node, project, exportSettings);
        if (!cancelled) {
          setExportEstimatedSize(blob.size);
          const nextUrl = URL.createObjectURL(blob);
          setExportPreviewUrl(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return nextUrl;
          });
        }
      } catch (err) {
        if (!cancelled) {
          setExportEstimatedSize(null);
        }
      } finally {
        if (!cancelled) setExportEstimating(false);
      }
    }, 240);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [isExportModalOpen, exportSettings, project?.id, project?.activePageId, project?.layers, project?.background, project?.canvasConfig]);

  const cropAspect = project ? project.canvasConfig.width / project.canvasConfig.height : 1;
  const aiWorkspace: WorkspaceOptions = {
    project,
    getAssetFolder: () => getAssetFolder(storageType, localFileAdapter),
    getCanvasPreview: async () => {
      const preview = await withDeselectedExportPreview(async () => {
        const node = document.getElementById('export-target') as HTMLDivElement | null;
        if (!node || !project) throw new Error('No canvas is available to preview.');
        await ensureProjectFonts(project);
        const { width, height } = project.canvasConfig;
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
        const canvas = await htmlToImage.toCanvas(node, {
          ...buildExportOptions(project, 1),
          canvasWidth: Math.max(1, Math.round(width * scale)),
          canvasHeight: Math.max(1, Math.round(height * scale))
        });
        return encodeWebp(canvas);
      });
      if (!preview) throw new Error('No project is open.');
      return preview;
    },
    getLayerPreview: async layerId => {
      const layer = project?.layers.find(item => item.id === layerId);
      if (!layer || layer.type !== 'image') throw new Error('Image layer is unavailable.');
      const response = await fetch(layer.content);
      if (!response.ok) throw new Error('Image could not be loaded for preview.');
      return encodeWebp(await response.blob());
    },
    selectedLayerIds,
    storage: storageAdapter,
    localProjects: localRecentItems,
    activeLocalPath: activeLocalFilePath,
    chatStorageKey: `directory:${storageFolderName}`,
    getChatDirectory: async () => {
      if (!await localFileAdapter.ensureReady({ prompt: false })) throw new Error('Select a storage folder and grant file access first.');
      const directory = localFileAdapter.getRootHandle();
      if (!directory) throw new Error('No storage folder selected.');
      return directory;
    },
    onCommit: next => {
      latestProjectRef.current = next;
      setProject(next);
      setSelectedLayerIds(next.selectedLayerId ? [next.selectedLayerId] : []);
    },
    onOpen: async (next, localPath) => {
      if (localPath) {
        const opened = await openLocalProjectFromPath(localPath);
        if (!opened) throw new Error('Unable to open local project.');
        return opened;
      }
      clearActiveLocalFilePath();
      warnIfNewerProject(next);
      latestProjectRef.current = next;
      setProject(structuredClone(next));
      setSelectedLayerIds(next.selectedLayerId ? [next.selectedLayerId] : []);
      setView('editor');
      initProjectHistory(next);
    },
    onUpsert: next => setProjects(previous => [next, ...previous.filter(item => item.id !== next.id)]),
    onDelete: (id, localPath) => {
      if (localPath) removeLocalRecentByPath(localPath);
      else setProjects(previous => previous.filter(item => item.id !== id));
      if (project?.id === id) {
        latestProjectRef.current = null;
        cancelPendingSave();
        clearActiveLocalFilePath();
        setProject(null);
        setSelectedLayerIds([]);
        setView('landing');
      }
    },
    onSearch: setProjectSearchTerm,
    saveLocal: saveLocalProjectToFile
  };
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

  const handleOpenRecentProject = (item: RecentProjectItem) => {
        if (item.source === 'local' && item.localPath) {
          openLocalProjectFromPath(item.localPath);
          return;
        }
        warnIfNewerProject(item.project);
        const opened = item.project.pages?.[0] ? selectProjectPage(item.project, item.project.pages[0].id) : syncProjectPages(item.project);
        setProject(opened);
        setView('editor');
        initProjectHistory(opened);
        clearActiveLocalFilePath();
  };

  const handleDeleteRecentProject = (item: RecentProjectItem) => {
        if (item.source === 'local' && item.localPath) {
          setConfirmDialog({
            message: t.confirmRemoveLocalProject,
            onConfirm: () => removeLocalRecentByPath(item.localPath as string)
          });
          return;
        }
        setConfirmDialog({
          message: t.confirmDeleteProject,
          onConfirm: () => deleteProjectById(item.project.id)
        });
  };

  return (
    <>
      {view === 'landing' ? (
      <LandingView
        lang={lang} aiBusy={aiBusy} isAiOpen={isAiOpen} isTauri={isTauri} isCloudMode={isCloudMode}
        projects={projects} localRecentItems={localRecentItems} projectSearchTerm={projectSearchTerm}
        setProjectSearchTerm={setProjectSearchTerm} cloudLoading={cloudLoading}
        handleProjectsScroll={handleProjectsScroll} handleOpenRecentProject={handleOpenRecentProject}
        handleDeleteRecentProject={handleDeleteRecentProject} handleDuplicateProject={handleDuplicateProject}
        handleExportJson={handleExportJson} handleExportImage={handleExportImage}
        openPresetModal={openPresetModal} openLocalProjectDialog={openLocalProjectDialog} handleImportJson={handleImportJson}
        onToggleAi={() => setIsAiOpen(prev => !prev)} onOpenStorageSettings={() => setIsStorageSettingsOpen(true)}
        onLanguageChange={setLang}
      >
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
      </LandingView>
      ) : project ? (
      <div inert={aiBusy} className="flex flex-col h-screen bg-slate-950 text-slate-200 overflow-hidden">
      {toast && <Toast message={toast.msg} type={toast.type} />}
      {confirmDialog && <ConfirmModal isOpen={true} message={confirmDialog.message} lang={lang} onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />}
      <ProjectPresetModal
        isOpen={isPageModalOpen} lang={lang} presets={PRESET_RATIOS} selectedPreset={selectedPreset} size={customPresetSize}
        pageName={newPageName} onPageNameChange={setNewPageName} pagePlaceholder={pageNumber((project.pages?.findIndex(page => page.id === project.activePageId) ?? 0) + 1)}
        onClose={() => setIsPageModalOpen(false)} onSizeChange={setCustomPresetSize}
        onSelectPreset={preset => { setSelectedPreset(preset); setCustomPresetSize({ width: preset.width, height: preset.height }); }}
        onCreate={() => {
          modifyProject(current => insertProjectPage(current, newPageName, { ...customPresetSize, ratio: `${customPresetSize.width}x${customPresetSize.height}` }));
          setSelectedLayerIds([]);
          setIsPageModalOpen(false);
        }}
      />
      <ExportModal
        isOpen={isExportModalOpen}
        lang={lang}
        project={project}
        previewUrl={exportPreviewUrl}
        settings={exportSettings}
        estimatedSize={exportEstimatedSize}
        estimating={exportEstimating}
        range={exportRange}
        onRangeChange={range => { setExportRange(range); if (range !== 'current') setActiveTab('pages'); }}
        selectedPageIds={exportPageIds}
        onSelectedPagesChange={setExportPageIds}
        onPageChange={pageId => {
          setExportPreviewUrl(previous => { if (previous) URL.revokeObjectURL(previous); return null; });
          setExportEstimatedSize(null);
          switchPage(pageId);
        }}
        thumbnails={pageThumbnails}
        busy={isExporting}
        progress={exportProgress}
        onClose={() => setIsExportModalOpen(false)}
        onChange={updateExportSettings}
        onCopyImage={() => {
          const node = document.getElementById('export-target') as HTMLDivElement | null;
          if (!project) return;
          handleCopyExportImageWithDeselect(node, project, exportSettings);
          setIsExportModalOpen(false);
        }}
        onCopyBase64={() => {
          const node = document.getElementById('export-target') as HTMLDivElement | null;
          if (!project) return;
          handleCopyExportBase64WithDeselect(node, project, exportSettings);
          setIsExportModalOpen(false);
        }}
        onConfirm={() => { void handleExportPages(); }}
      />
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
      <ImageLayerCropModal
        isOpen={Boolean(croppingImageLayerId)}
        layer={project.layers.find(l => l.id === croppingImageLayerId && l.type === 'image') || null}
        lang={lang}
        onCancel={() => setCroppingImageLayerId(null)}
        onConfirm={(crop, flipX, flipY) => {
          const target = project.layers.find(l => l.id === croppingImageLayerId && l.type === 'image');
          if (target) {
            updateLayer(
              target.id,
              {
                ...computeCroppedLayerGeometry(target, crop),
                flipX,
                flipY
              },
              true
            );
          }
          setCroppingImageLayerId(null);
        }}
      />
      <header className="h-14 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            onClick={() => {
              performAutoSave('leave');
              setProject(null);
              setView('landing');
            }}
            className="p-2 hover:bg-slate-800 rounded-lg shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-slate-400" />
          </button>
          <div className="flex items-center gap-3 min-w-0">
            <div className="inline-grid items-center min-w-[60px] max-w-xs">
              <span className="invisible col-start-1 row-start-1 px-1.5 py-1 font-bold text-sm whitespace-pre truncate pointer-events-none">
                {project.title || ' '}
              </span>
              <input
                value={project.title}
                onChange={(e) => modifyProject(p => ({ ...p, title: e.target.value }))}
                className="col-start-1 row-start-1 bg-transparent font-bold text-sm outline-none hover:bg-slate-800 focus:bg-slate-800 rounded px-1.5 py-1 w-full min-w-0 transition-colors"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          
          <div className="flex items-center gap-1 mr-4 bg-slate-800 p-1 rounded-lg">
            <button 
              onClick={handleUndo} 
              disabled={!canUndo}
              className="p-1.5 rounded hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-all text-slate-300"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button 
              onClick={handleRedo} 
              disabled={!canRedo}
              className="p-1.5 rounded hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-all text-slate-300"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
          {/* 云端或 Tauri 的本地文件模式才显示保存按钮 */}
          {(isCloudMode || (activeLocalFilePath && isTauri)) && (
            <button
              onClick={() => performAutoSave('manual')}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-lg text-slate-300 border border-slate-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              {t.save || 'Save'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsAiOpen(prev => !prev)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
              isAiOpen
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-sm shadow-emerald-950/40'
                : 'bg-slate-800/90 hover:bg-slate-700 text-slate-300 border-slate-700 hover:text-white hover:border-emerald-500/40'
            }`}
            title={lang === 'en' ? 'AI Assistant' : 'AI 助手'}
            aria-label={lang === 'en' ? 'AI Assistant' : 'AI 助手'}
            aria-expanded={isAiOpen}
          >
            <Bot className={`w-4 h-4 ${isAiOpen ? 'text-emerald-400' : 'text-emerald-500'}`} />
            <span>{lang === 'en' ? 'AI Assistant' : 'AI 助手'}</span>
            {aiBusy && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
          </button>
          
          <button onClick={() => handleExportJson(project)} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-lg text-slate-300 border border-slate-700 transition-colors">
            <FileOutput className="w-4 h-4" />
            {t.exportJson}
          </button>
          <button onClick={() => { setExportRange('current'); setExportPageIds([project.activePageId!]); setIsExportModalOpen(true); }} disabled={isExporting} className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-lg text-white shadow-lg shadow-blue-900/20 disabled:opacity-50">
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
          project={project}
          onAddPage={openPageModal}
          pagesPanel={<PagesPanel lang={lang} pages={project.pages ?? []} activePageId={project.activePageId} thumbnails={pageThumbnails}
            onSelect={switchPage}
            onRename={(id, name) => modifyProject(current => renameProjectPage(current, id, name))}
            onDuplicate={id => { modifyProject(current => insertProjectPage(current, '', current.canvasConfig, id)); setSelectedLayerIds([]); }}
            onDelete={id => setConfirmDialog({ message: t.confirmDeletePage, onConfirm: () => { modifyProject(current => deleteProjectPage(current, id)); setSelectedLayerIds([]); } })}
            onMove={(id, targetId) => modifyProject(current => moveProjectPage(current, id, targetId))}
          />}
          selectedLayerIds={selectedLayerIds}
          background={project.background} 
          onOpenBackgroundCrop={handleOpenBackgroundCrop}
          storageType={isCloudMode ? 'indexeddb' : storageType}
          localFileAdapter={localFileAdapter}
          onApplyTemplate={handleApplyDecorationTemplate}
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

            if (l.type === 'decoration' && l.content) {
              const newLayer = createDecorationLayer(
                l.content,
                project.canvasConfig.width,
                project.canvasConfig.height,
                l.name || t.defaultLayerName,
                { width: l.width, height: l.height }
              );
              newLayer.zIndex = project.layers.length + 1;

              modifyProject(p => ({
                ...p,
                layers: [...p.layers, newLayer],
                selectedLayerId: newLayer.id
              }));
              setSelectedLayerIds([newLayer.id]);
              return;
            }

            if (l.type === 'image' && l.content) {
              const img = new Image();
              img.onload = () => {
                if (latestProjectRef.current?.id !== project.id || latestProjectRef.current?.activePageId !== project.activePageId) return;
                let width = img.width || 100;
                let height = img.height || 100;
                const maxWidth = project.canvasConfig.width * 0.8;
                const maxHeight = project.canvasConfig.height * 0.8;
                const ratio = width / Math.max(height, 1);

                if (width > maxWidth) {
                  width = maxWidth;
                  height = width / ratio;
                }
                if (height > maxHeight) {
                  height = maxHeight;
                  width = height * ratio;
                }

                const newLayer: Layer = {
                  id: generateId(),
                  name: l.name || t.defaultLayerName,
                  type: 'image',
                  content: l.content,
                  imageSource: l.imageSource || 'import',
                  imageDescription: l.imageDescription || l.name || '',
                  x: (project.canvasConfig.width - width) / 2,
                  y: (project.canvasConfig.height - height) / 2,
                  width,
                  height,
                  rotation: 0,
                  zIndex: project.layers.length + 1,
                  visible: true,
                  locked: false,
                  opacity: 1,
                  ratioLocked: true
                };

                modifyProject(p => ({
                  ...p,
                  layers: [...p.layers, newLayer],
                  selectedLayerId: newLayer.id
                }));
                setSelectedLayerIds([newLayer.id]);
              };
              img.src = l.content;
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
            key={`${project.id}:${project.activePageId}`}
            lang={lang}
            project={isExportModalOpen ? { ...project, selectedLayerId: null } : project}
            onSelectLayer={(id) => handleSelectLayer(id, 'replace')}
            updateLayer={updateLayer}
            onCommit={saveHistorySnapshot}
            onOpenImageCrop={(id) => setCroppingImageLayerId(id)}
          />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl px-2 py-1 shadow-xl z-40">
            <button
              onClick={handleAddText}
              className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-slate-800 hover:text-blue-400 rounded-lg transition-all text-[11px] font-semibold text-slate-200 group active:scale-95"
            >
              <div className="p-1 bg-slate-800 rounded group-hover:bg-blue-600/20 text-slate-300 group-hover:text-blue-400 transition-colors">
                <TextIcon className="w-3.5 h-3.5" />
              </div>
              <span>{t.addHeadline}</span>
            </button>
            <div className="w-px h-3.5 bg-slate-800" />
            <button
              onClick={handleAddImage}
              className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-slate-800 hover:text-blue-400 rounded-lg transition-all text-[11px] font-semibold text-slate-200 group active:scale-95"
            >
              <div className="p-1 bg-slate-800 rounded group-hover:bg-blue-600/20 text-slate-300 group-hover:text-blue-400 transition-colors">
                <ImagePlus className="w-3.5 h-3.5" />
              </div>
              <span>{t.addImage}</span>
            </button>
          </div>
        </div>
        <LayersPanel
          lang={lang}
          project={project}
          selectedLayerIds={selectedLayerIds}
          onUpdateLayer={updateLayer}
          onRemoveBackground={handleRemoveBackground}
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
          onOpenImageCrop={(id) => setCroppingImageLayerId(id)}
        />
      </main>
    </div>
      ) : null}
      <AiAssistant
        workspace={aiWorkspace}
        lang={lang}
        onBusyChange={setAiBusy}
        open={isAiOpen}
        onOpenChange={setIsAiOpen}
      />
      <PWAUpdatePrompt lang={lang} onShowToast={showToast} />
      <OfflineIndicator lang={lang} />
    </>
  );
};

export default App;
  