import { BackgroundConfig, FAIconMetadata, FACategory } from '../types.ts';
import { Language } from '../translations.ts';
import { StorageAdapterType } from './StorageAdapter.ts';

export * from './StorageAdapter.ts';
export * from './IndexedDBAdapter.ts';
export * from './LocalFileAdapter.ts';

const LANG_KEY = 'coverflow_lang';
const STORAGE_TYPE_KEY = 'coverflow_storage_adapter';
const BG_PRESETS_KEY = 'coverflow_bg_presets_v3';

const safeJsonParse = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (err) {
    return fallback;
  }
};

export const getStoredLanguage = (fallback: Language = 'zh') => {
  return (localStorage.getItem(LANG_KEY) as Language) || fallback;
};

export const setStoredLanguage = (lang: Language) => {
  localStorage.setItem(LANG_KEY, lang);
};

export const getStoredStorageType = (fallback: StorageAdapterType = 'indexeddb') => {
  return (localStorage.getItem(STORAGE_TYPE_KEY) as StorageAdapterType) || fallback;
};

export const setStoredStorageType = (storageType: StorageAdapterType) => {
  localStorage.setItem(STORAGE_TYPE_KEY, storageType);
};

export const getStoredBackgroundPresets = () => {
  return safeJsonParse<BackgroundConfig[]>(localStorage.getItem(BG_PRESETS_KEY), []);
};

export const setStoredBackgroundPresets = (presets: BackgroundConfig[]) => {
  localStorage.setItem(BG_PRESETS_KEY, JSON.stringify(presets));
};

const FA_DB_NAME = 'coverflow_fa_cache_v1';
const FA_STORE_NAME = 'fa_cache';
const FA_KEY_ICONS = 'icons';
const FA_KEY_CATS = 'cats';

const openFaDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(FA_DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(FA_STORE_NAME)) {
      request.result.createObjectStore(FA_STORE_NAME);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const getFaCacheItem = async <T,>(key: string): Promise<T | null> => {
  const db = await openFaDb();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(FA_STORE_NAME, 'readonly');
    const store = tx.objectStore(FA_STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T) || null);
    req.onerror = () => reject(req.error);
  });
};

const setFaCacheItem = async (key: string, value: unknown) => {
  const db = await openFaDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FA_STORE_NAME, 'readwrite');
    const store = tx.objectStore(FA_STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const removeFaCacheItem = async (key: string) => {
  const db = await openFaDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FA_STORE_NAME, 'readwrite');
    const store = tx.objectStore(FA_STORE_NAME);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

export const getFaIconsCache = () => getFaCacheItem<Record<string, FAIconMetadata>>(FA_KEY_ICONS);
export const getFaCategoriesCache = () => getFaCacheItem<Record<string, FACategory>>(FA_KEY_CATS);
export const setFaIconsCache = (data: Record<string, FAIconMetadata>) => setFaCacheItem(FA_KEY_ICONS, data);
export const setFaCategoriesCache = (data: Record<string, FACategory>) => setFaCacheItem(FA_KEY_CATS, data);
export const clearFaCache = async () => {
  await Promise.all([removeFaCacheItem(FA_KEY_ICONS), removeFaCacheItem(FA_KEY_CATS)]);
};

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

export const isAssetFolderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export const pickAssetFolderHandle = async () => {
  if (!isAssetFolderSupported()) return null;
  const picker = (window as any).showDirectoryPicker;
  if (!picker) return null;
  return picker();
};

export const getStoredAssetFolderHandle = async () => {
  const db = await openFsHandleDb();
  return new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readonly');
    const store = tx.objectStore(FS_STORE_NAME);
    const req = store.get(FS_ASSET_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
};

export const setStoredAssetFolderHandle = async (handle: FileSystemDirectoryHandle) => {
  const db = await openFsHandleDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(FS_STORE_NAME);
    const req = store.put(handle, FS_ASSET_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

export const clearStoredAssetFolderHandle = async () => {
  const db = await openFsHandleDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(FS_STORE_NAME);
    const req = store.delete(FS_ASSET_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

export type AssetFolderItem = {
  key: string;
  name: string;
  fileHandle: FileSystemFileHandle;
};

export type AssetFolderGroup = {
  category: string;
  categoryZh: string;
  items: AssetFolderItem[];
};

const parseGroupName = (folderName: string) => {
  const parts = folderName.split('-');
  const en = (parts[0] || folderName).trim() || folderName;
  const zh = parts.length > 1 ? parts.slice(1).join('-').trim() || en : en;
  return { en, zh };
};

export const verifyAssetFolderPermission = async (
  handle: FileSystemDirectoryHandle,
  request: boolean,
  mode: 'read' | 'readwrite' = 'read'
) => {
  const options = { mode } as const;
  if ((await handle.queryPermission(options)) === 'granted') return true;
  if (!request) return false;
  return (await handle.requestPermission(options)) === 'granted';
};

export const scanAssetFolder = async (handle: FileSystemDirectoryHandle) => {
  const groupsMap = new Map<string, AssetFolderGroup>();

  for await (const [folderName, entry] of handle.entries()) {
    if (entry.kind !== 'directory') continue;
    const { en, zh } = parseGroupName(folderName);
    const groupKey = folderName;
    const group: AssetFolderGroup = groupsMap.get(groupKey) || {
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
        fileHandle: fileEntry
      });
    }

    if (group.items.length > 0) {
      group.items.sort((a, b) => a.name.localeCompare(b.name, 'en'));
      groupsMap.set(groupKey, group);
    }
  }

  const groups = Array.from(groupsMap.values());
  groups.sort((a, b) => a.category.localeCompare(b.category, 'en'));
  return groups;
};

