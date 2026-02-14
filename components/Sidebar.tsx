// 模块：侧边栏资源与背景设置
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CATEGORIZED_ASSETS, PRESET_COLORS, PRESET_GRADIENTS } from '../constants.ts';
import { BackgroundConfig, Layer, FAIconMetadata, FACategory } from '../types.ts';
import { translations, Language } from '../translations.ts';
import { Box, Palette, Search, Image as ImageIcon, PaintBucket, Grid, Trash2, Save, Upload, Sliders, X, Check, Flag, FileJson, FileCode, AlertCircle, ExternalLink, Folder, RotateCw, Trash, HelpCircle, Keyboard } from 'lucide-react';
import * as yaml from 'js-yaml';
import { normalizeSVG } from '../utils/helpers.ts';
import { buildBackgroundStyles } from '../utils/backgroundStyles.ts';
import {
  clearFaCache,
  clearStoredAssetFolderHandle,
  LocalFileAdapter,
  scanAssetFolder,
  StorageAdapterType,
  getFaCategoriesCache,
  getFaIconsCache,
  getStoredAssetFolderHandle,
  getStoredBackgroundPresets,
  isAssetFolderSupported,
  pickAssetFolderHandle,
  setStoredAssetFolderHandle,
  verifyAssetFolderPermission,
  setFaCategoriesCache,
  setFaIconsCache,
  setStoredBackgroundPresets
} from '../storage/storage.ts';

interface SidebarProps {
  lang: Language;
  onAddLayer: (layer: Partial<Layer>) => void;
  onUpdateBackground: (bg: Partial<BackgroundConfig>) => void;
  onOpenBackgroundCrop?: (dataUrl: string) => void;
  background: BackgroundConfig;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  storageType: StorageAdapterType;
  localFileAdapter: LocalFileAdapter;
}

interface ExternalAssetItem {
  key: string;
  name: string;
  fileHandle: FileSystemFileHandle;
}

interface AssetGroup {
  category: string;
  categoryZh: string;
  items: Array<
    | { key: string; name: string; content: string; isExternal?: false }
    | { key: string; name: string; fileHandle: FileSystemFileHandle; isExternal: true }
  >;
}

const ASSET_PAGE_SIZE = 120;

// 侧边栏：资源库与背景配置。
const Sidebar: React.FC<SidebarProps> = ({
  lang,
  onAddLayer,
  onUpdateBackground,
  onOpenBackgroundCrop,
  background,
  activeTab,
  setActiveTab,
  storageType,
  localFileAdapter
}) => {
  const FA_PAGE_SIZE = 180;
  const [searchTerm, setSearchTerm] = useState('');
  const [faSearchTerm, setFaSearchTerm] = useState('');
  const [faVisibleCount, setFaVisibleCount] = useState(FA_PAGE_SIZE);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  const faListRef = useRef<HTMLDivElement | null>(null);
  const t = translations[lang];
  const fsSupported = isAssetFolderSupported();
  const isLocalFileStorage = storageType === 'localfile';

  const [assetVisibleCount, setAssetVisibleCount] = useState(ASSET_PAGE_SIZE);
  const [externalFolderHandle, setExternalFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [externalFolderName, setExternalFolderName] = useState('');
  const [externalGroups, setExternalGroups] = useState<AssetGroup[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [externalCacheVersion, setExternalCacheVersion] = useState(0);
  const [isAssetSettingsOpen, setIsAssetSettingsOpen] = useState(false);
  const externalSvgCacheRef = useRef<Map<string, string>>(new Map());
  const externalSvgLoadingRef = useRef<Set<string>>(new Set());

  // Font Awesome 数据状态
  const [faIcons, setFaIcons] = useState<Record<string, FAIconMetadata> | null>(null);
  const [faCategories, setFaCategories] = useState<Record<string, FACategory> | null>(null);

  const [savedPresets, setSavedPresets] = useState<BackgroundConfig[]>(() => getStoredBackgroundPresets());

  useEffect(() => {
    let active = true;

    const loadFaFromLocalFolder = async () => {
      const ready = await localFileAdapter.ensureReady({ prompt: false });
      if (!ready) return;
      const rootHandle = localFileAdapter.getRootHandle();
      if (!rootHandle) return;

      const fontDir = await rootHandle.getDirectoryHandle('font', { create: true });
      let icons: Record<string, FAIconMetadata> | null = null;
      let cats: Record<string, FACategory> | null = null;

      try {
        const iconsHandle = await fontDir.getFileHandle('icon-families.json');
        const iconsFile = await iconsHandle.getFile();
        const text = await iconsFile.text();
        icons = JSON.parse(text) as Record<string, FAIconMetadata>;
      } catch (err) {
        icons = null;
      }

      try {
        const catsHandle = await fontDir.getFileHandle('categories.yml');
        const catsFile = await catsHandle.getFile();
        const text = await catsFile.text();
        cats = yaml.load(text) as Record<string, FACategory>;
      } catch (err) {
        cats = null;
      }

      if (!active) return;
      setFaIcons(icons);
      setFaCategories(cats);
    };

    const loadFaCache = async () => {
      try {
        const [icons, cats] = await Promise.all([
          getFaIconsCache(),
          getFaCategoriesCache()
        ]);
        if (!active) return;
        setFaIcons(icons);
        setFaCategories(cats);
      } catch (err) {
        // ignore cache read errors
      }
    };

    if (storageType === 'localfile') {
      setFaIcons(null);
      setFaCategories(null);
      loadFaFromLocalFolder();
    } else {
      loadFaCache();
    }

    return () => {
      active = false;
    };
  }, [localFileAdapter, storageType]);

  useEffect(() => {
    setStoredBackgroundPresets(savedPresets);
  }, [savedPresets]);

  useEffect(() => {
    if (isLocalFileStorage && isAssetSettingsOpen) {
      setIsAssetSettingsOpen(false);
    }
  }, [isLocalFileStorage, isAssetSettingsOpen]);

  const scanExternalFolder = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setExternalLoading(true);
    setExternalError(null);
    externalSvgCacheRef.current.clear();
    externalSvgLoadingRef.current.clear();
    setExternalCacheVersion(prev => prev + 1);

    try {
      const scanned = await scanAssetFolder(handle);
      const groups: AssetGroup[] = scanned.map(group => ({
        category: group.category,
        categoryZh: group.categoryZh,
        items: group.items.map(item => ({
          key: item.key,
          name: item.name,
          fileHandle: item.fileHandle,
          isExternal: true
        }))
      }));
      setExternalGroups(groups);
      setAssetVisibleCount(ASSET_PAGE_SIZE);
    } catch (err) {
      setExternalError(t.assetFolderReadFailed);
    } finally {
      setExternalLoading(false);
    }
  }, [t.assetFolderReadFailed]);

  const loadExternalSvg = useCallback(async (item: ExternalAssetItem) => {
    if (externalSvgCacheRef.current.has(item.key)) return;
    if (externalSvgLoadingRef.current.has(item.key)) return;
    externalSvgLoadingRef.current.add(item.key);
    try {
      const file = await item.fileHandle.getFile();
      const text = await file.text();
      const normalized = normalizeSVG(text);
      externalSvgCacheRef.current.set(item.key, normalized);
      setExternalCacheVersion(prev => prev + 1);
    } catch (err) {
      // ignore single file read errors
    } finally {
      externalSvgLoadingRef.current.delete(item.key);
    }
  }, []);

  const handleChooseAssetFolder = useCallback(async () => {
    if (!fsSupported) {
      setExternalError(t.assetFolderUnsupported);
      return;
    }
    try {
      const handle = await pickAssetFolderHandle();
      if (!handle) {
        setExternalError(t.assetFolderPickFailed);
        return;
      }
      const granted = await verifyAssetFolderPermission(handle, true, 'read');
      if (!granted) {
        setExternalError(t.assetFolderPermissionDenied);
        return;
      }
      await setStoredAssetFolderHandle(handle);
      setExternalFolderHandle(handle);
      setExternalFolderName(handle.name);
      await scanExternalFolder(handle);
    } catch (err) {
      setExternalError(t.assetFolderPickFailed);
    }
  }, [fsSupported, scanExternalFolder, t.assetFolderPermissionDenied, t.assetFolderPickFailed, t.assetFolderUnsupported]);

  const handleRefreshAssetFolder = useCallback(async () => {
    if (!externalFolderHandle) return;
    const granted = await verifyAssetFolderPermission(externalFolderHandle, true, 'read');
    if (!granted) {
      setExternalError(t.assetFolderPermissionDenied);
      return;
    }
    await scanExternalFolder(externalFolderHandle);
  }, [externalFolderHandle, scanExternalFolder, t.assetFolderPermissionDenied]);

  const handleClearAssetFolder = useCallback(async () => {
    await clearStoredAssetFolderHandle();
    setExternalFolderHandle(null);
    setExternalFolderName('');
    setExternalGroups([]);
    externalSvgCacheRef.current.clear();
    externalSvgLoadingRef.current.clear();
    setExternalCacheVersion(prev => prev + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const restoreHandle = async () => {
      try {
        if (storageType === 'localfile') {
          const ready = await localFileAdapter.ensureReady({ prompt: false });
          if (!ready || !active) return;
          const rootHandle = localFileAdapter.getRootHandle();
          if (!rootHandle || !active) return;
          const libHandle = await rootHandle.getDirectoryHandle('lib', { create: true });
          const granted = await verifyAssetFolderPermission(libHandle, false, 'read');
          setExternalFolderHandle(libHandle);
          setExternalFolderName(`${localFileAdapter.getFolderName()}/lib`);
          if (granted) {
            await scanExternalFolder(libHandle);
          }
          return;
        }

        const handle = await getStoredAssetFolderHandle();
        if (!handle || !active) return;
        const granted = await verifyAssetFolderPermission(handle, false, 'read');
        setExternalFolderHandle(handle);
        setExternalFolderName(handle.name);
        if (granted) {
          await scanExternalFolder(handle);
        }
      } catch (err) {
        // ignore restore errors
      }
    };
    restoreHandle();
    return () => { active = false; };
  }, [scanExternalFolder, storageType, localFileAdapter]);

  useEffect(() => {
    if (activeTab !== 'assets') return;
    setAssetVisibleCount(ASSET_PAGE_SIZE);
  }, [activeTab, searchTerm, externalGroups]);

  const saveCurrentPreset = () => {
    setSavedPresets(prev => [JSON.parse(JSON.stringify(background)), ...prev]);
  };

  const confirmDeletePreset = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setDeletingIndex(index);
  };

  const executeDeletePreset = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setSavedPresets(prev => prev.filter((_, i) => i !== index));
    setDeletingIndex(null);
  };

  const handleTypeChange = (newType: 'color' | 'gradient' | 'image') => {
    let newValue = background.value;
    const hexMatch = newValue.match(/#[a-fA-F0-9]{3,6}/gi) || [];
    const isGradient = newValue.includes('gradient');
    const isImage = newValue.startsWith('http') || newValue.startsWith('data:');

    if (newType === 'color') {
      if (isGradient && hexMatch.length > 0) newValue = hexMatch[0];
      else if (isImage || !newValue.startsWith('#')) newValue = '#1e293b';
    } else if (newType === 'gradient') {
      if (!isGradient) {
        const start = hexMatch.length > 0 ? hexMatch[0] : '#3b82f6';
        const end = hexMatch.length > 1 ? hexMatch[1] : (start.toLowerCase() === '#ffffff' ? '#000000' : '#8b5cf6');
        newValue = `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;
      }
    } else if (newType === 'image') {
      if (!isImage) newValue = '';
    }
    onUpdateBackground({ type: newType, value: newValue });
  };

  // 生成背景预览样式（缩放纹理密度）
  const getPreviewStyles = (bg: BackgroundConfig): React.CSSProperties =>
    buildBackgroundStyles(bg, { patternScale: 0.2 });

  const combinedAssetGroups = useMemo<AssetGroup[]>(() => {
    const baseGroups: AssetGroup[] = CATEGORIZED_ASSETS.map(group => ({
      category: group.category,
      categoryZh: group.categoryZh || group.category,
      items: group.items.map(item => ({
        key: `base:${group.category}:${item.name}`,
        name: item.name,
        content: item.content,
        isExternal: false
      }))
    }));
    return [...baseGroups, ...externalGroups];
  }, [externalGroups]);

  const assetRenderData = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    let remaining = assetVisibleCount;
    let hasMore = false;
    const groups: { label: string; items: Array<{ key: string; name: string; content: string; isExternal?: boolean; fileHandle?: FileSystemFileHandle }> }[] = [];
    const pendingExternal: ExternalAssetItem[] = [];

    for (const group of combinedAssetGroups) {
      if (remaining <= 0) {
        hasMore = true;
        break;
      }
      const label = lang === 'zh' ? group.categoryZh : group.category;
      const items: Array<{ key: string; name: string; content: string; isExternal?: boolean; fileHandle?: FileSystemFileHandle }> = [];

      for (const item of group.items) {
        if (remaining <= 0) {
          hasMore = true;
          break;
        }
        if (search && !item.name.toLowerCase().includes(search)) continue;

        if (item.isExternal) {
          const cached = externalSvgCacheRef.current.get(item.key) || '';
          items.push({
            key: item.key,
            name: item.name,
            content: cached,
            isExternal: true,
            fileHandle: item.fileHandle
          });
          if (!cached) {
            pendingExternal.push({
              key: item.key,
              name: item.name,
              fileHandle: item.fileHandle
            });
          }
        } else {
          items.push({
            key: item.key,
            name: item.name,
            content: item.content,
            isExternal: false
          });
        }
        remaining -= 1;
      }

      if (items.length > 0) {
        groups.push({ label, items });
      }
    }

    return { groups, hasMore, pendingExternal };
  }, [assetVisibleCount, combinedAssetGroups, externalCacheVersion, lang, searchTerm]);

  useEffect(() => {
    if (assetRenderData.pendingExternal.length === 0) return;
    assetRenderData.pendingExternal.forEach(item => loadExternalSvg(item));
  }, [assetRenderData.pendingExternal, loadExternalSvg]);

  const renderResources = () => (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
        <input
          type="text"
          placeholder={t.searchPlaceholder}
          className="w-full bg-slate-800 border border-slate-700 rounded-md py-1 pl-9 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-200"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4">
        {assetRenderData.groups.map((cat) => (
          <div key={cat.label}>
            <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              {cat.label}
            </h3>
            <div className="grid grid-cols-3 gap-1">
              {cat.items.map((item) => (
                <button
                  key={item.key}
                  onClick={async () => {
                    if (item.isExternal && item.fileHandle) {
                      await loadExternalSvg({ key: item.key, name: item.name, fileHandle: item.fileHandle });
                      const svg = externalSvgCacheRef.current.get(item.key);
                      if (!svg) return;
                      onAddLayer({ name: item.name, type: 'svg', content: svg, color: '#3b82f6' });
                      return;
                    }
                    onAddLayer({ name: item.name, type: 'svg', content: item.content, color: '#3b82f6' });
                  }}
                  className="bg-slate-800 border border-slate-700 p-1.5 rounded hover:border-blue-500 transition-colors group flex flex-col items-center"
                >
                  <div className="w-full h-10 flex items-center justify-center mb-0.5">
                    {item.content ? (
                      <svg viewBox="0 0 100 100" className="w-full h-full text-slate-400 group-hover:text-blue-400 transition-colors" dangerouslySetInnerHTML={{ __html: item.content }} />
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-slate-700 border-t-slate-500 animate-spin opacity-40" />
                    )}
                  </div>
                  <span className="text-[9px] text-slate-400 truncate w-full text-center">{item.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {assetRenderData.hasMore && (
        <button
          type="button"
          onClick={() => setAssetVisibleCount(prev => prev + ASSET_PAGE_SIZE)}
          className="w-full py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-200 border border-slate-800 rounded-xl hover:border-slate-600 transition-all"
        >
          {t.loadingMore}
        </button>
      )}
    </div>
  );

  const renderAssetSettingsModal = () => {
    if (!isAssetSettingsOpen || isLocalFileStorage) return null;
    return (
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm" onClick={() => setIsAssetSettingsOpen(false)}>
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <div className="text-xs font-black uppercase tracking-widest text-slate-500">{t.assetFolderSettings}</div>
            <button type="button" onClick={() => setIsAssetSettingsOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t.assetFolder}</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleChooseAssetFolder}
                  disabled={!fsSupported}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-blue-600 transition-all disabled:opacity-40 disabled:pointer-events-none"
                  title={externalFolderHandle ? t.assetFolderChange : t.assetFolderChoose}
                >
                  <Folder className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleRefreshAssetFolder}
                  disabled={!externalFolderHandle || externalLoading}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-blue-600 transition-all disabled:opacity-40 disabled:pointer-events-none"
                  title={t.assetFolderRefresh}
                >
                  <RotateCw className={`w-4 h-4 ${externalLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={handleClearAssetFolder}
                  disabled={!externalFolderHandle}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-red-500 transition-all disabled:opacity-40 disabled:pointer-events-none"
                  title={t.assetFolderClear}
                >
                  <Trash className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="text-xs text-slate-400 truncate">
              {externalFolderName || t.assetFolderEmpty}
            </div>
            {!fsSupported && (
              <div className="text-[10px] text-amber-400 font-bold uppercase">{t.assetFolderUnsupported}</div>
            )}
            {externalError && (
              <div className="text-[10px] text-red-400 font-bold uppercase">{externalError}</div>
            )}
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            {t.assetFolderHint}
          </p>
        </div>
      </div>
    );
  };

  const renderBackgroundSettings = () => (
    <div className="space-y-5 pb-4">
      <section className="space-y-3">
        <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest">{t.backgroundStyle}</h3>
        <div className="flex bg-slate-800 p-0.5 rounded-lg border border-slate-700 gap-1">
          {[
            { id: 'color', icon: PaintBucket, title: t.bgTypeColor },
            { id: 'gradient', icon: Palette, title: t.bgTypeGradient },
            { id: 'image', icon: ImageIcon, title: t.bgTypeImage }
          ].map(item => (
            <button
              key={item.id}
              title={item.title}
              onClick={() => handleTypeChange(item.id as any)}
              className={`flex-1 flex items-center justify-center py-1.5 px-2 rounded-md transition-all ${background.type === item.id
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
            >
              <item.icon className="w-4 h-4" />
            </button>
          ))}
        </div>
        <div className="space-y-2.5 pt-1.5">
          {background.type === 'color' && (
            <div className="space-y-2.5 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex gap-2">
                <input type="color" value={background.value.startsWith('#') && !background.value.includes('gradient') ? background.value : '#ffffff'} onChange={(e) => onUpdateBackground({ value: e.target.value })} className="w-12 h-8 rounded-md bg-slate-900 border border-slate-700 cursor-pointer overflow-hidden p-0.5 flex-shrink-0" />
                <input type="text" value={background.value} onChange={(e) => onUpdateBackground({ value: e.target.value })} className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-md px-2 text-xs text-slate-200 font-mono focus:ring-1 focus:ring-blue-500 outline-none" placeholder="#FFFFFF" />
              </div>
              <div className="grid grid-cols-4 gap-1">
                {PRESET_COLORS.map(c => (
                  <button key={c} onClick={() => onUpdateBackground({ value: c })} className={`aspect-square rounded-lg border-2 transition-all hover:scale-110 ${background.value === c ? 'border-blue-500 shadow-md' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          )}
          {background.type === 'gradient' && (
            <div className="space-y-2.5 animate-in fade-in zoom-in-95 duration-200">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">{t.startColor}</span>
                  <input type="color" value={(background.value.match(/#[a-fA-F0-9]{3,6}/gi) || [])[0] || '#3b82f6'} onChange={(e) => {
                    const deg = (background.value.match(/(\d+)deg/) || [])[1] || 135;
                    const end = (background.value.match(/#[a-fA-F0-9]{3,6}/gi) || [])[1] || '#8b5cf6';
                    onUpdateBackground({ value: `linear-gradient(${deg}deg, ${e.target.value} 0%, ${end} 100%)` });
                  }} className="w-full h-7 rounded-md bg-slate-900 border border-slate-700 cursor-pointer" />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">{t.endColor}</span>
                  <input type="color" value={(background.value.match(/#[a-fA-F0-9]{3,6}/gi) || [])[1] || '#8b5cf6'} onChange={(e) => {
                    const deg = (background.value.match(/(\d+)deg/) || [])[1] || 135;
                    const start = (background.value.match(/#[a-fA-F0-9]{3,6}/gi) || [])[0] || '#3b82f6';
                    onUpdateBackground({ value: `linear-gradient(${deg}deg, ${start} 0%, ${e.target.value} 100%)` });
                  }} className="w-full h-7 rounded-md bg-slate-900 border border-slate-700 cursor-pointer" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase"><span>{t.angle}</span><span>{(background.value.match(/(\d+)deg/) || [])[1] || '135'}°</span></div>
                <input type="range" min="0" max="360" value={(background.value.match(/(\d+)deg/) || [])[1] || 135} onChange={(e) => {
                  const colors = background.value.match(/#[a-fA-F0-9]{3,6}/gi) || ['#3b82f6', '#8b5cf6'];
                  onUpdateBackground({ value: `linear-gradient(${e.target.value}deg, ${colors[0]} 0%, ${colors[1]} 100%)` });
                }} className="w-full accent-blue-600" />
              </div>
              <div className="grid grid-cols-2 gap-1">
                {PRESET_GRADIENTS.map(g => (
                  <button key={g} onClick={() => onUpdateBackground({ value: g })} className="h-6 rounded-md border border-slate-700 transition-all hover:border-slate-500" style={{ background: g }} />
                ))}
              </div>
            </div>
          )}
          {background.type === 'image' && (
            <div className="space-y-2.5 animate-in fade-in zoom-in-95 duration-200">
              <label className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-slate-700 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors group">
                <Upload className="w-4 h-4 text-slate-500 group-hover:text-blue-500 mb-1" />
                <span className="text-[10px] text-slate-500 font-bold uppercase">{t.uploadImage}</span>
                <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const result = ev.target?.result as string;
                    if (!result) return;
                    if (onOpenBackgroundCrop) onOpenBackgroundCrop(result);
                    else onUpdateBackground({ value: result });
                  };
                  reader.readAsDataURL(file);
                  e.currentTarget.value = '';
                }} />
              </label>
              <input type="text" value={background.value.startsWith('http') || background.value.startsWith('data:') ? background.value : ''} onChange={(e) => onUpdateBackground({ value: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none" placeholder="https://..." />
            </div>
          )}
        </div>
      </section>
      <section className="space-y-2.5 pt-3 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest">{t.overlayType}</h3>
        </div>
        <div className="flex bg-slate-800 p-0.5 rounded-lg border border-slate-700 gap-1">
          {[{ id: 'none', icon: X, label: t.none }, { id: 'dots', icon: Grid, label: t.dots }, { id: 'grid', icon: Grid, label: t.grid }, { id: 'stripes', icon: Sliders, label: t.stripes }].map(item => (
            <button
              key={item.id}
              onClick={() => onUpdateBackground({ overlayType: item.id as any })}
              className={`flex-1 flex items-center justify-center py-1.5 px-2 rounded-md transition-all ${background.overlayType === item.id
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
              title={item.label}
            >
              <item.icon className="w-4 h-4" />
            </button>
          ))}
        </div>
        {background.overlayType !== 'none' && (
          <div className="space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="space-y-1">
              <span className="text-[9px] font-bold text-slate-500 uppercase">{t.overlayColor}</span>
              <div className="flex gap-2">
                <input type="color" value={background.overlayColor} onChange={(e) => onUpdateBackground({ overlayColor: e.target.value })} className="w-12 h-8 rounded-md bg-slate-900 border border-slate-700 p-0.5 cursor-pointer flex-shrink-0" />
                <input type="text" value={background.overlayColor} onChange={(e) => onUpdateBackground({ overlayColor: e.target.value })} className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono focus:ring-1 focus:ring-blue-500 outline-none" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase"><span>{t.opacity}</span><span>{Math.round(background.overlayOpacity * 100)}%</span></div><input type="range" min="0" max="1" step="0.01" value={background.overlayOpacity} onChange={(e) => onUpdateBackground({ overlayOpacity: parseFloat(e.target.value) })} className="w-full accent-blue-600" /></div>
              <div className="space-y-1"><div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase"><span>{t.overlayScale}</span><span>{background.overlayScale}px</span></div><input type="range" min="5" max="100" step="1" value={background.overlayScale} onChange={(e) => onUpdateBackground({ overlayScale: parseInt(e.target.value) })} className="w-full accent-blue-600" /></div>
            </div>
          </div>
        )}
      </section>
    </div>
  );

  // Font Awesome 数据处理
  const writeFontFile = useCallback(async (fileName: string, text: string) => {
    const ready = await localFileAdapter.ensureReady({ prompt: true });
    if (!ready) return false;
    const rootHandle = localFileAdapter.getRootHandle();
    if (!rootHandle) return false;
    const fontDir = await rootHandle.getDirectoryHandle('font', { create: true });
    const fileHandle = await fontDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    return true;
  }, [localFileAdapter]);

  const handleUploadMetadata = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, FAIconMetadata>;
      setFaIcons(data);
      if (isLocalFileStorage) {
        await writeFontFile('icon-families.json', text);
      } else {
        setFaIconsCache(data).catch(() => undefined);
      }
    } catch (err) {
      alert(t.faMetadataParseError);
    }
    e.target.value = '';
  };

  const handleUploadCategories = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = yaml.load(text) as Record<string, FACategory>;
      setFaCategories(data);
      if (isLocalFileStorage) {
        await writeFontFile('categories.yml', text);
      } else {
        setFaCategoriesCache(data as Record<string, FACategory>).catch(() => undefined);
      }
    } catch (err) {
      alert(t.faCategoriesParseError);
    }
    e.target.value = '';
  };

  const clearFAData = () => {
    setFaIcons(null);
    setFaCategories(null);
    clearFaCache().catch(() => undefined);
  };

  // 根据搜索词过滤并按需渲染，避免一次性渲染过多图标
  const faRenderData = useMemo(() => {
    if (!faIcons || !faCategories || activeTab !== 'fa') return { groups: [], hasMore: false };

    let remaining = faVisibleCount;
    let hasMore = false;
    const groups: { label: string; items: {
      key: string;
      label: string;
      style: string;
      raw: string;
      innerHtml: string;
      viewBox: string;
      width: number;
      height: number;
    }[] }[] = [];

    const searchVal = faSearchTerm.trim().toLowerCase();
    let stop = false;

    for (const [, cat] of Object.entries(faCategories)) {
      if (remaining <= 0) { hasMore = true; break; }
      const items: { key: string; label: string; style: string; raw: string; innerHtml: string; viewBox: string; width: number; height: number }[] = [];

      for (const iconId of cat.icons) {
        if (remaining <= 0) { hasMore = true; stop = true; break; }
        const metadata = faIcons[iconId];
        if (!metadata || !metadata.svgs) continue;
        if (searchVal) {
          const matched = iconId.toLowerCase().includes(searchVal) ||
            metadata.label.toLowerCase().includes(searchVal) ||
            metadata.search?.terms?.some(term => term.toLowerCase().includes(searchVal));
          if (!matched) continue;
        }

        // 扁平化该图标在不同家族下的可用样式
        for (const [family, styles] of Object.entries(metadata.svgs)) {
          for (const [style, data] of Object.entries(styles as Record<string, any>)) {
            if (remaining <= 0) { hasMore = true; stop = true; break; }
            const svgData = data as { raw: string; viewBox?: number[] };
            const vb = svgData.viewBox || [0, 0, 512, 512];
            const widthVal = vb[2] || 512;
            const heightVal = vb[3] || 512;
            const maxInitialSize = 120;
            const scale = Math.min(maxInitialSize / widthVal, maxInitialSize / heightVal);
            items.push({
              key: `${iconId}-${family}-${style}`,
              label: metadata.label,
              style,
              raw: svgData.raw,
              innerHtml: svgData.raw.replace(/<svg[^>]*>/i, '').replace(/<\/svg>/i, ''),
              viewBox: `0 0 ${vb[2]} ${vb[3]}`,
              width: Math.round(widthVal * scale),
              height: Math.round(heightVal * scale)
            });
            remaining -= 1;
          }
          if (stop) break;
        }
        if (stop) break;
      }

      if (items.length > 0) {
        groups.push({ label: cat.label, items });
      }
      if (stop) break;
    }

    return { groups, hasMore };
  }, [faIcons, faCategories, faSearchTerm, faVisibleCount, activeTab]);

  useEffect(() => {
    if (activeTab !== 'fa') return;
    setFaVisibleCount(FA_PAGE_SIZE);
    if (faListRef.current) {
      faListRef.current.scrollTop = 0;
    }
  }, [activeTab, faSearchTerm, faIcons, faCategories]);

  const handleFaScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!faRenderData.hasMore) return;
    const target = e.currentTarget;
    const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 200;
    if (nearBottom) {
      setFaVisibleCount(prev => prev + FA_PAGE_SIZE);
    }
  };

  const renderFontAwesome = () => {
    if (!faIcons || !faCategories) {
      return (
        <div className="flex flex-col gap-4 items-center justify-center p-8 text-center bg-slate-900/40 rounded-3xl border-2 border-dashed border-slate-800">
          <Flag className="w-12 h-12 text-slate-700 opacity-30 mb-2" />
          <p className="text-xs text-slate-500 leading-relaxed max-w-[200px]">{t.uploadFAHint}</p>
          
          <div className="flex flex-col gap-2 w-full mt-2">
            <label className="flex items-center gap-2 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl hover:border-blue-500 cursor-pointer transition-all group">
              <FileJson className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" />
              <span className="text-[10px] font-bold uppercase tracking-tight">{t.uploadFAMetadata}</span>
              <input type="file" accept=".json" onChange={handleUploadMetadata} className="hidden" />
            </label>
            <label className="flex items-center gap-2 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl hover:border-blue-500 cursor-pointer transition-all group">
              <FileCode className="w-4 h-4 text-green-500 group-hover:scale-110 transition-transform" />
              <span className="text-[10px] font-bold uppercase tracking-tight">{t.uploadFACategories}</span>
              <input type="file" accept=".yml,.yaml" onChange={handleUploadCategories} className="hidden" />
            </label>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800 w-full">
            <p className="text-[10px] text-slate-600 font-bold uppercase mb-2 tracking-widest">{t.faDownloadGuide}</p>
            <a 
              href="https://fontawesome.com/download" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase"
            >
              <ExternalLink className="w-3 h-3" />
              {t.faDownloadLink}
            </a>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder={t.searchFA}
              className="w-full bg-slate-800 border border-slate-700 rounded-md py-1 pl-9 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-200"
              value={faSearchTerm}
              onChange={(e) => setFaSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div
          ref={faListRef}
          onScroll={handleFaScroll}
          className="space-y-5 max-h-[calc(100vh-280px)] overflow-y-auto pr-2 custom-scrollbar"
        >
          {faRenderData.groups.map(group => (
            <div key={group.label}>
              <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5 border-b border-slate-800 pb-1">{group.label}</h3>
              <div className="grid grid-cols-3 gap-1.5">
                {group.items.map(item => (
                  <button
                    key={item.key}
                    onClick={() => onAddLayer({
                      name: `${item.label} (${item.style})`,
                      type: 'svg',
                      content: item.raw,
                      color: '#3b82f6',
                      width: item.width,
                      height: item.height
                    })}
                    title={`${item.label} - ${item.style}`}
                    className="aspect-square bg-slate-800 border border-slate-700 p-1.5 rounded-md hover:border-blue-500 transition-all group flex items-center justify-center hover:bg-slate-750 overflow-hidden relative shadow-sm"
                  >
                    <div className="w-full h-full text-slate-400 group-hover:text-blue-400 transition-colors flex items-center justify-center p-1">
                      <svg
                        viewBox={item.viewBox}
                        className="w-full h-full max-h-full max-w-full pointer-events-none drop-shadow-sm"
                        preserveAspectRatio="xMidYMid meet"
                        dangerouslySetInnerHTML={{ __html: item.innerHtml }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {faRenderData.groups.length === 0 && (
            <div className="py-12 flex flex-col items-center opacity-30">
               <AlertCircle className="w-8 h-8 mb-2" />
               <span className="text-xs font-bold uppercase">{t.faNoMatches}</span>
            </div>
          )}
          {faRenderData.hasMore && (
            <div className="text-[10px] text-slate-600 font-bold uppercase tracking-widest text-center py-2">
              {t.loadingMore}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderHelp = () => (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
          <Keyboard className="w-3.5 h-3.5" /> {t.helpShortcutsTitle}
        </h3>
        <div className="grid grid-cols-1 gap-1.5">
          {t.helpShortcuts.map(item => (
            <div key={item.keys} className="flex items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 rounded-md px-2 py-1.5">
              <span className="text-[9px] text-slate-300 font-bold uppercase tracking-wider">{item.desc}</span>
              <span className="text-[9px] text-slate-400 font-mono bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 whitespace-nowrap">
                {item.keys}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-1.5 pt-2">
        <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
          <ExternalLink className="w-3.5 h-3.5" /> {t.helpResourcesTitle}
        </h3>
        <div className="grid grid-cols-1 gap-1.5">
          {t.helpResources.map(item => (
            <a
              key={item.url}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 rounded-md px-2 py-1.5 hover:border-blue-500/60 transition-colors"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[9px] text-slate-200 font-bold truncate">{item.name}</span>
                <span className="text-[8px] text-slate-500 truncate">{item.desc}</span>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-72 flex bg-slate-900 border-r border-slate-800 flex-shrink-0 relative h-full">
      <div className="w-14 border-r border-slate-800 flex flex-col items-center py-5 gap-4 flex-shrink-0">
        <button
          title={t.assets}
          onClick={() => setActiveTab('assets')}
          className={`p-2.5 rounded-lg transition-all ${activeTab === 'assets' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'}`}
        >
          <Box className="w-5 h-5" />
        </button>
        <button
          title={t.fontAwesome}
          onClick={() => setActiveTab('fa')}
          className={`p-2.5 rounded-lg transition-all ${activeTab === 'fa' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'}`}
        >
          <Flag className="w-5 h-5" />
        </button>
        <button
          title={t.layout}
          onClick={() => setActiveTab('layout')}
          className={`p-2.5 rounded-lg transition-all ${activeTab === 'layout' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'}`}
        >
          <Palette className="w-5 h-5" />
        </button>
        <button
          title={t.help}
          onClick={() => setActiveTab('help')}
          className={`p-2.5 rounded-lg transition-all ${activeTab === 'help' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'}`}
        >
          <HelpCircle className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <div className="p-5 pb-2 border-b border-slate-800/50 flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2 text-slate-100 uppercase tracking-tighter">
            {activeTab === 'assets'
              ? t.assets
              : activeTab === 'fa'
                ? t.fontAwesome
                : activeTab === 'layout'
                  ? t.layout
                  : t.help}
          </h2>
          {activeTab === 'assets' && !isLocalFileStorage && (
            <button
              onClick={() => setIsAssetSettingsOpen(true)}
              className="p-1 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-all"
              title={t.assetFolderSettings}
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
          )}
          {activeTab === 'fa' && !isLocalFileStorage && (faIcons || faCategories) && (
            <button 
              onClick={clearFAData} 
              className="p-1 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-all"
              title={t.clearFAData}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-5 scrollbar-hide">
          {activeTab === 'assets'
            ? renderResources()
            : activeTab === 'fa'
              ? renderFontAwesome()
              : activeTab === 'layout'
                ? renderBackgroundSettings()
                : renderHelp()}
        </div>

        {activeTab === 'layout' && (
          <div className="p-5 border-t border-slate-800 bg-slate-900/80 backdrop-blur-md flex flex-col h-[250px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{t.savedPresets}</h3>
              <button onClick={saveCurrentPreset} className="p-1 bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white rounded-md transition-all active:scale-95 flex items-center gap-1">
                <Save className="w-3.5 h-3.5" />
                <span className="text-[9px] font-bold">{t.savePreset}</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pr-1 scrollbar-hide">
              {savedPresets.length === 0 ? (
                <div className="h-full min-h-[160px] flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-xl bg-slate-900/40">
                  <p className="text-[10px] text-slate-600 font-bold uppercase tracking-tighter">{t.noSavedPresets}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 pb-4">
                  {savedPresets.map((preset, idx) => (
                    <div
                      key={idx}
                      onClick={() => onUpdateBackground(preset)}
                      className="group relative aspect-video rounded-xl border border-slate-700 cursor-pointer overflow-hidden transition-all hover:border-blue-500 hover:shadow-lg hover:shadow-blue-900/20"
                      style={getPreviewStyles(preset)}
                    >
                      <button onClick={(e) => confirmDeletePreset(e, idx)} className={`absolute top-1 right-1 p-1 bg-red-600/80 text-white rounded-full transition-all hover:bg-red-500 opacity-0 group-hover:opacity-100 ${deletingIndex === idx ? 'hidden' : 'block'}`}>
                        <X className="w-2.5 h-2.5" />
                      </button>
                      {deletingIndex === idx && (
                        <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center animate-in fade-in duration-200 z-10">
                          <span className="text-[8px] font-black text-white uppercase mb-1 tracking-tighter">{t.confirmDeleteShort}</span>
                          <div className="flex gap-1.5">
                            <button onClick={(e) => executeDeletePreset(e, idx)} className="p-1 bg-red-600 text-white rounded-md hover:bg-red-500 shadow-lg"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={(e) => { e.stopPropagation(); setDeletingIndex(null); }} className="p-1 bg-slate-700 text-white rounded-md hover:bg-slate-600"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      )}
                      <div className="absolute bottom-1 right-1 px-1 py-0.5 bg-black/40 backdrop-blur-md rounded text-[7px] text-slate-300 font-black uppercase tracking-tighter">{preset.type}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {renderAssetSettingsModal()}
    </div>
  );
};

export default Sidebar;
