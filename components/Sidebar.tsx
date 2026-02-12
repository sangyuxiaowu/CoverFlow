// 模块：侧边栏资源与背景设置
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CATEGORIZED_ASSETS, PRESET_COLORS, PRESET_GRADIENTS } from '../constants.ts';
import { BackgroundConfig, Layer, FAIconMetadata, FACategory } from '../types.ts';
import { translations, Language } from '../translations.ts';
import { Box, Palette, Search, Plus, Image as ImageIcon, PaintBucket, Grid, Trash2, Save, Upload, Sliders, X, Check, Flag, FileJson, FileCode, AlertCircle, ExternalLink, Folder, RotateCw, Trash } from 'lucide-react';
import * as yaml from 'js-yaml';
import { normalizeSVG } from '../utils/helpers.ts';

interface SidebarProps {
  lang: Language;
  onAddLayer: (layer: Partial<Layer>) => void;
  onUpdateBackground: (bg: Partial<BackgroundConfig>) => void;
  background: BackgroundConfig;
  activeTab: string;
  setActiveTab: (tab: string) => void;
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

const FA_STORAGE_KEY_ICONS = 'coverflow_fa_icons_v2';
const FA_STORAGE_KEY_CATS = 'coverflow_fa_cats_v2';
const ASSET_PAGE_SIZE = 120;
const FS_DB_NAME = 'coverflow_fs_handles_v1';
const FS_STORE_NAME = 'handles';
const FS_ASSET_KEY = 'assetsFolder';

const openFsHandleDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(FS_DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(FS_STORE_NAME)) {
      request.result.createObjectStore(FS_STORE_NAME);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const getStoredDirectoryHandle = async () => {
  const db = await openFsHandleDb();
  return new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readonly');
    const store = tx.objectStore(FS_STORE_NAME);
    const req = store.get(FS_ASSET_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
};

const setStoredDirectoryHandle = async (handle: FileSystemDirectoryHandle) => {
  const db = await openFsHandleDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(FS_STORE_NAME);
    const req = store.put(handle, FS_ASSET_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const clearStoredDirectoryHandle = async () => {
  const db = await openFsHandleDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(FS_STORE_NAME);
    const req = store.delete(FS_ASSET_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const parseGroupName = (folderName: string) => {
  const parts = folderName.split('-');
  const en = (parts[0] || folderName).trim() || folderName;
  const zh = parts.length > 1 ? parts.slice(1).join('-').trim() || en : en;
  return { en, zh };
};

const Sidebar: React.FC<SidebarProps> = ({ lang, onAddLayer, onUpdateBackground, background, activeTab, setActiveTab }) => {
  const FA_PAGE_SIZE = 180;
  const [searchTerm, setSearchTerm] = useState('');
  const [faSearchTerm, setFaSearchTerm] = useState('');
  const [faVisibleCount, setFaVisibleCount] = useState(FA_PAGE_SIZE);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  const faListRef = useRef<HTMLDivElement | null>(null);
  const t = translations[lang];
  const fsSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

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
  const [faIcons, setFaIcons] = useState<Record<string, FAIconMetadata>>(() => {
    try {
      const saved = localStorage.getItem(FA_STORAGE_KEY_ICONS);
      return saved ? JSON.parse(saved) : null;
    } catch (e) { return null; }
  });
  const [faCategories, setFaCategories] = useState<Record<string, FACategory>>(() => {
    try {
      const saved = localStorage.getItem(FA_STORAGE_KEY_CATS);
      return saved ? JSON.parse(saved) : null;
    } catch (e) { return null; }
  });

  const [savedPresets, setSavedPresets] = useState<BackgroundConfig[]>(() => {
    try {
      const saved = localStorage.getItem('coverflow_bg_presets_v3');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  useEffect(() => {
    localStorage.setItem('coverflow_bg_presets_v3', JSON.stringify(savedPresets));
  }, [savedPresets]);

  const verifyFolderPermission = useCallback(async (handle: FileSystemDirectoryHandle, request: boolean) => {
    const options = { mode: 'read' as const };
    if ((await handle.queryPermission(options)) === 'granted') return true;
    if (!request) return false;
    return (await handle.requestPermission(options)) === 'granted';
  }, []);

  const scanExternalFolder = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setExternalLoading(true);
    setExternalError(null);
    externalSvgCacheRef.current.clear();
    externalSvgLoadingRef.current.clear();
    setExternalCacheVersion(prev => prev + 1);

    const groupsMap = new Map<string, AssetGroup>();
    try {
      for await (const [folderName, entry] of handle.entries()) {
        if (entry.kind !== 'directory') continue;
        const { en, zh } = parseGroupName(folderName);
        const groupKey = folderName;
        const group: AssetGroup = groupsMap.get(groupKey) || {
          category: en,
          categoryZh: zh,
          items: []
        };

        for await (const [fileName, fileEntry] of entry.entries()) {
          if (fileEntry.kind !== 'file') continue;
          if (!fileName.toLowerCase().endsWith('.svg')) continue;
          const name = fileName.replace(/\.svg$/i, '');
          group.items.push({
            key: `${groupKey}/${fileName}`,
            name,
            fileHandle: fileEntry,
            isExternal: true
          });
        }

        if (group.items.length > 0) {
          group.items.sort((a, b) => a.name.localeCompare(b.name, 'en'));
          groupsMap.set(groupKey, group);
        }
      }
      const groups = Array.from(groupsMap.values());
      groups.sort((a, b) => a.category.localeCompare(b.category, 'en'));
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
      const handle = await (window as any).showDirectoryPicker();
      const granted = await verifyFolderPermission(handle, true);
      if (!granted) {
        setExternalError(t.assetFolderPermissionDenied);
        return;
      }
      await setStoredDirectoryHandle(handle);
      setExternalFolderHandle(handle);
      setExternalFolderName(handle.name);
      await scanExternalFolder(handle);
    } catch (err) {
      setExternalError(t.assetFolderPickFailed);
    }
  }, [fsSupported, scanExternalFolder, t.assetFolderPermissionDenied, t.assetFolderPickFailed, t.assetFolderUnsupported, verifyFolderPermission]);

  const handleRefreshAssetFolder = useCallback(async () => {
    if (!externalFolderHandle) return;
    const granted = await verifyFolderPermission(externalFolderHandle, true);
    if (!granted) {
      setExternalError(t.assetFolderPermissionDenied);
      return;
    }
    await scanExternalFolder(externalFolderHandle);
  }, [externalFolderHandle, scanExternalFolder, t.assetFolderPermissionDenied, verifyFolderPermission]);

  const handleClearAssetFolder = useCallback(async () => {
    await clearStoredDirectoryHandle();
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
        const handle = await getStoredDirectoryHandle();
        if (!handle || !active) return;
        const granted = await verifyFolderPermission(handle, false);
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
  }, [scanExternalFolder, verifyFolderPermission]);

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

  // 生成背景预览样式（含叠加纹理）
  const getPreviewStyles = (bg: BackgroundConfig): React.CSSProperties => {
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
      const scale = bg.overlayScale || 20;
      if (bg.overlayType === 'dots') patternImage = `radial-gradient(${rgba} 2px, transparent 2px)`;
      else if (bg.overlayType === 'grid') patternImage = `linear-gradient(${rgba} 1px, transparent 1px), linear-gradient(90deg, ${rgba} 1px, transparent 1px)`;
      else if (bg.overlayType === 'stripes') patternImage = `repeating-linear-gradient(45deg, ${rgba}, ${rgba} 2px, transparent 2px, transparent ${scale / 2}px)`;
      patternSize = `${scale / 5}px ${scale / 5}px`;
    }

    const backgroundImages: string[] = [];
    const backgroundSizes: string[] = [];
    if (patternImage) { backgroundImages.push(patternImage); backgroundSizes.push(patternSize); }
    if (baseBackground) { backgroundImages.push(baseBackground); backgroundSizes.push(bg.type === 'image' ? 'cover' : '100% 100%'); }

    if (backgroundImages.length > 0) {
      styles.backgroundImage = backgroundImages.join(', ');
      styles.backgroundSize = backgroundSizes.join(', ');
    }
    return styles;
  };

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
    <div className="space-y-6">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder={t.searchPlaceholder}
          className="w-full bg-slate-800 border border-slate-700 rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-200"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-6">
        {assetRenderData.groups.map((cat) => (
          <div key={cat.label}>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              {cat.label}
            </h3>
            <div className="grid grid-cols-3 gap-2">
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
                  className="bg-slate-800 border border-slate-700 p-2 rounded hover:border-blue-500 transition-colors group flex flex-col items-center"
                >
                  <div className="w-full h-12 flex items-center justify-center mb-1">
                    {item.content ? (
                      <svg viewBox="0 0 100 100" className="w-full h-full text-slate-400 group-hover:text-blue-400 transition-colors" dangerouslySetInnerHTML={{ __html: item.content }} />
                    ) : (
                      <div className="w-6 h-6 rounded-full border border-slate-700 border-t-slate-500 animate-spin opacity-40" />
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 truncate w-full text-center">{item.name}</span>
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
    if (!isAssetSettingsOpen) return null;
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
    <div className="space-y-8 pb-6">
      <section className="space-y-4">
        <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">{t.backgroundStyle}</h3>
        <div className="flex bg-slate-800 p-1.5 rounded-xl border border-slate-700 gap-1">
          {[
            { id: 'color', icon: PaintBucket, title: t.bgTypeColor },
            { id: 'gradient', icon: Palette, title: t.bgTypeGradient },
            { id: 'image', icon: ImageIcon, title: t.bgTypeImage }
          ].map(item => (
            <button
              key={item.id}
              title={item.title}
              onClick={() => handleTypeChange(item.id as any)}
              className={`flex-1 flex items-center justify-center py-2.5 px-3 rounded-lg transition-all ${background.type === item.id
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
            >
              <item.icon className="w-5 h-5" />
            </button>
          ))}
        </div>
        <div className="space-y-4 pt-2">
          {background.type === 'color' && (
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex gap-2">
                <input type="color" value={background.value.startsWith('#') && !background.value.includes('gradient') ? background.value : '#ffffff'} onChange={(e) => onUpdateBackground({ value: e.target.value })} className="w-16 h-10 rounded-lg bg-slate-900 border border-slate-700 cursor-pointer overflow-hidden p-0.5 flex-shrink-0" />
                <input type="text" value={background.value} onChange={(e) => onUpdateBackground({ value: e.target.value })} className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 text-sm text-slate-200 font-mono focus:ring-1 focus:ring-blue-500 outline-none" placeholder="#FFFFFF" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {PRESET_COLORS.map(c => (
                  <button key={c} onClick={() => onUpdateBackground({ value: c })} className={`aspect-square rounded-lg border-2 transition-all hover:scale-110 ${background.value === c ? 'border-blue-500 shadow-md' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          )}
          {background.type === 'gradient' && (
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">{t.startColor}</span>
                  <input type="color" value={(background.value.match(/#[a-fA-F0-9]{3,6}/gi) || [])[0] || '#3b82f6'} onChange={(e) => {
                    const deg = (background.value.match(/(\d+)deg/) || [])[1] || 135;
                    const end = (background.value.match(/#[a-fA-F0-9]{3,6}/gi) || [])[1] || '#8b5cf6';
                    onUpdateBackground({ value: `linear-gradient(${deg}deg, ${e.target.value} 0%, ${end} 100%)` });
                  }} className="w-full h-8 rounded-lg bg-slate-900 border border-slate-700 cursor-pointer" />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">{t.endColor}</span>
                  <input type="color" value={(background.value.match(/#[a-fA-F0-9]{3,6}/gi) || [])[1] || '#8b5cf6'} onChange={(e) => {
                    const deg = (background.value.match(/(\d+)deg/) || [])[1] || 135;
                    const start = (background.value.match(/#[a-fA-F0-9]{3,6}/gi) || [])[0] || '#3b82f6';
                    onUpdateBackground({ value: `linear-gradient(${deg}deg, ${start} 0%, ${e.target.value} 100%)` });
                  }} className="w-full h-8 rounded-lg bg-slate-900 border border-slate-700 cursor-pointer" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase"><span>{t.angle}</span><span>{(background.value.match(/(\d+)deg/) || [])[1] || '135'}°</span></div>
                <input type="range" min="0" max="360" value={(background.value.match(/(\d+)deg/) || [])[1] || 135} onChange={(e) => {
                  const colors = background.value.match(/#[a-fA-F0-9]{3,6}/gi) || ['#3b82f6', '#8b5cf6'];
                  onUpdateBackground({ value: `linear-gradient(${e.target.value}deg, ${colors[0]} 0%, ${colors[1]} 100%)` });
                }} className="w-full accent-blue-600" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_GRADIENTS.map(g => (
                  <button key={g} onClick={() => onUpdateBackground({ value: g })} className="h-8 rounded-lg border border-slate-700 transition-all hover:border-slate-500" style={{ background: g }} />
                ))}
              </div>
            </div>
          )}
          {background.type === 'image' && (
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-slate-700 rounded-xl cursor-pointer hover:bg-slate-800 transition-colors group">
                <Upload className="w-6 h-6 text-slate-500 group-hover:text-blue-500 mb-2" />
                <span className="text-[10px] text-slate-500 font-bold uppercase">{t.uploadImage}</span>
                <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => onUpdateBackground({ value: ev.target?.result as string });
                    reader.readAsDataURL(file);
                  }
                }} />
              </label>
              <input type="text" value={background.value.startsWith('http') || background.value.startsWith('data:') ? background.value : ''} onChange={(e) => onUpdateBackground({ value: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none" placeholder="https://..." />
            </div>
          )}
        </div>
      </section>
      <section className="space-y-4 pt-4 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">{t.overlayType}</h3>
          {background.overlayType !== 'none' && (
            <button onClick={() => onUpdateBackground({ overlayType: 'none' })} className="text-[10px] font-bold text-red-400 hover:text-red-300 flex items-center gap-1">
              <X className="w-3 h-3" /> {t.none}
            </button>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[{ id: 'none', icon: X, label: t.none }, { id: 'dots', icon: Grid, label: t.dots }, { id: 'grid', icon: Grid, label: t.grid }, { id: 'stripes', icon: Sliders, label: t.stripes }].map(item => (
            <button key={item.id} onClick={() => onUpdateBackground({ overlayType: item.id as any })} className={`aspect-square flex flex-col items-center justify-center rounded-xl border-2 transition-all ${background.overlayType === item.id ? 'bg-blue-600 border-blue-400 text-white shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-500 hover:bg-slate-750'}`} title={item.label}><item.icon className="w-5 h-5" /></button>
          ))}
        </div>
        {background.overlayType !== 'none' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase">{t.overlayColor}</span>
              <div className="flex gap-2">
                <input type="color" value={background.overlayColor} onChange={(e) => onUpdateBackground({ overlayColor: e.target.value })} className="w-14 h-10 rounded-lg bg-slate-900 border border-slate-700 p-0.5 cursor-pointer flex-shrink-0" />
                <input type="text" value={background.overlayColor} onChange={(e) => onUpdateBackground({ overlayColor: e.target.value })} className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono focus:ring-1 focus:ring-blue-500 outline-none" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase"><span>{t.opacity}</span><span>{Math.round(background.overlayOpacity * 100)}%</span></div><input type="range" min="0" max="1" step="0.01" value={background.overlayOpacity} onChange={(e) => onUpdateBackground({ overlayOpacity: parseFloat(e.target.value) })} className="w-full accent-blue-600" /></div>
              <div className="space-y-1"><div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase"><span>{t.overlayScale}</span><span>{background.overlayScale}px</span></div><input type="range" min="5" max="100" step="1" value={background.overlayScale} onChange={(e) => onUpdateBackground({ overlayScale: parseInt(e.target.value) })} className="w-full accent-blue-600" /></div>
            </div>
          </div>
        )}
      </section>
    </div>
  );

  // Font Awesome 数据处理
  const handleUploadMetadata = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        setFaIcons(data);
        localStorage.setItem(FA_STORAGE_KEY_ICONS, JSON.stringify(data));
      } catch (err) { alert(t.faMetadataParseError); }
    };
    reader.readAsText(file);
  };

  const handleUploadCategories = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = yaml.load(ev.target?.result as string);
        setFaCategories(data as Record<string, FACategory>);
        localStorage.setItem(FA_STORAGE_KEY_CATS, JSON.stringify(data));
      } catch (err) { alert(t.faCategoriesParseError); }
    };
    reader.readAsText(file);
  };

  const clearFAData = () => {
    setFaIcons(null);
    setFaCategories(null);
    localStorage.removeItem(FA_STORAGE_KEY_ICONS);
    localStorage.removeItem(FA_STORAGE_KEY_CATS);
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
      <div className="space-y-6">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder={t.searchFA}
              className="w-full bg-slate-800 border border-slate-700 rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-200"
              value={faSearchTerm}
              onChange={(e) => setFaSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div
          ref={faListRef}
          onScroll={handleFaScroll}
          className="space-y-8 max-h-[calc(100vh-280px)] overflow-y-auto pr-2 custom-scrollbar"
        >
          {faRenderData.groups.map(group => (
            <div key={group.label}>
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 border-b border-slate-800 pb-1">{group.label}</h3>
              <div className="grid grid-cols-3 gap-3">
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
                    className="aspect-square bg-slate-800 border border-slate-700 p-2.5 rounded-xl hover:border-blue-500 transition-all group flex items-center justify-center hover:bg-slate-750 overflow-hidden relative shadow-sm"
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

  return (
    <div className="w-80 flex bg-slate-900 border-r border-slate-800 flex-shrink-0 relative h-full">
      <div className="w-16 border-r border-slate-800 flex flex-col items-center py-6 gap-6 flex-shrink-0">
        <button
          title={t.assets}
          onClick={() => setActiveTab('assets')}
          className={`p-3 rounded-xl transition-all ${activeTab === 'assets' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'}`}
        >
          <Box className="w-6 h-6" />
        </button>
        <button
          title={t.fontAwesome}
          onClick={() => setActiveTab('fa')}
          className={`p-3 rounded-xl transition-all ${activeTab === 'fa' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'}`}
        >
          <Flag className="w-6 h-6" />
        </button>
        <button
          title={t.layout}
          onClick={() => setActiveTab('layout')}
          className={`p-3 rounded-xl transition-all ${activeTab === 'layout' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'}`}
        >
          <Palette className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <div className="p-6 pb-2 border-b border-slate-800/50 flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2 text-slate-100 uppercase tracking-tighter">
            {activeTab === 'assets' ? t.assets : activeTab === 'fa' ? t.fontAwesome : t.layout}
          </h2>
          {activeTab === 'assets' && (
            <button
              onClick={() => setIsAssetSettingsOpen(true)}
              className="p-1.5 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all"
              title={t.assetFolderSettings}
            >
              <Sliders className="w-4 h-4" />
            </button>
          )}
          {activeTab === 'fa' && (faIcons || faCategories) && (
            <button 
              onClick={clearFAData} 
              className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
              title={t.clearFAData}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
          {activeTab === 'assets' ? renderResources() : activeTab === 'fa' ? renderFontAwesome() : renderBackgroundSettings()}
        </div>

        {activeTab === 'layout' && (
          <div className="p-6 border-t border-slate-800 bg-slate-900/80 backdrop-blur-md flex flex-col h-[280px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.savedPresets}</h3>
              <button onClick={saveCurrentPreset} className="p-1.5 bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white rounded-lg transition-all active:scale-95 flex items-center gap-1">
                <Save className="w-4 h-4" />
                <span className="text-[10px] font-bold">{t.savePreset}</span>
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
