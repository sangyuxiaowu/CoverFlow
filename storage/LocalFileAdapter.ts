import { ProjectState } from '../types.ts';
import { StorageAdapter, StorageAdapterType } from './StorageAdapter.ts';

const FS_DB_NAME = 'coverflow_fs_handles_v1';
const FS_STORE_NAME = 'handles';
const FS_PROJECT_KEY = 'projectStorageFolder';
const CONFIG_FILE = 'config.json';
const DATA_DIR = 'data';
const FONT_DIR = 'font';
const LIB_DIR = 'lib';

type LocalFileConfig = {
  version: number;
  projects: Array<{ id: string; title: string; updatedAt: number; fileName: string }>;
};

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

const getStoredProjectDirectoryHandle = async () => {
  const db = await openFsHandleDb();
  return new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readonly');
    const store = tx.objectStore(FS_STORE_NAME);
    const req = store.get(FS_PROJECT_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
};

const setStoredProjectDirectoryHandle = async (handle: FileSystemDirectoryHandle) => {
  const db = await openFsHandleDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(FS_STORE_NAME);
    const req = store.put(handle, FS_PROJECT_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const readFileText = async (handle: FileSystemFileHandle) => {
  const file = await handle.getFile();
  return file.text();
};

const writeFileText = async (handle: FileSystemFileHandle, text: string) => {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
};

// 本地文件系统存储适配器。
export class LocalFileAdapter implements StorageAdapter {
  type: StorageAdapterType = 'localfile';
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  isAvailable = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  getFolderName = () => this.rootHandle?.name || '';

  getRootHandle = () => this.rootHandle;

  ensureReady = async (options?: { prompt?: boolean }) => {
    if (!this.isAvailable()) return false;

    if (!this.rootHandle) {
      this.rootHandle = await getStoredProjectDirectoryHandle();
    }

    if (!this.rootHandle && options?.prompt) {
      const picker = (window as any).showDirectoryPicker;
      if (!picker) return false;
      this.rootHandle = await picker();
      if (this.rootHandle) {
        await setStoredProjectDirectoryHandle(this.rootHandle);
      }
    }

    if (!this.rootHandle) return false;

    const granted = await this.verifyFolderPermission(this.rootHandle, Boolean(options?.prompt));
    if (!granted) return false;

    await this.ensureFolderStructure(this.rootHandle);
    return true;
  };

  listProjects = async () => {
    const ready = await this.ensureReady({ prompt: false });
    if (!ready || !this.rootHandle) return { items: [], total: 0 };

    const config = await this.readConfig(this.rootHandle);
    const dataHandle = await this.rootHandle.getDirectoryHandle(DATA_DIR, { create: true });
    const projects: ProjectState[] = [];

    for (const item of config.projects) {
      try {
        const fileHandle = await dataHandle.getFileHandle(item.fileName);
        const text = await readFileText(fileHandle);
        projects.push(JSON.parse(text) as ProjectState);
      } catch (err) {
        // Skip invalid or missing entries
      }
    }

    return { items: projects, total: projects.length };
  };

  saveProjects = async (projects: ProjectState[]) => {
    const ready = await this.ensureReady({ prompt: false });
    if (!ready || !this.rootHandle) return;

    this.writeQueue = this.writeQueue.then(async () => {
      const dataHandle = await this.rootHandle!.getDirectoryHandle(DATA_DIR, { create: true });
      const nextConfig: LocalFileConfig = {
        version: 1,
        projects: projects.map(project => ({
          id: project.id,
          title: project.title,
          updatedAt: project.updatedAt,
          fileName: `${project.id}.json`
        }))
      };

      const prevConfig = await this.readConfig(this.rootHandle!);
      const prevFiles = new Set(prevConfig.projects.map(item => item.fileName));
      const nextFiles = new Set(nextConfig.projects.map(item => item.fileName));

      for (const project of projects) {
        const fileHandle = await dataHandle.getFileHandle(`${project.id}.json`, { create: true });
        await writeFileText(fileHandle, JSON.stringify(project, null, 2));
      }

      for (const fileName of prevFiles) {
        if (!nextFiles.has(fileName)) {
          try {
            await dataHandle.removeEntry(fileName);
          } catch (err) {
            // Ignore delete failures
          }
        }
      }

      await this.writeConfig(this.rootHandle!, nextConfig);
    });

    return this.writeQueue;
  };

  private verifyFolderPermission = async (handle: FileSystemDirectoryHandle, request: boolean) => {
    const options = { mode: 'readwrite' as const };
    if ((await handle.queryPermission(options)) === 'granted') return true;
    if (!request) return false;
    return (await handle.requestPermission(options)) === 'granted';
  };

  private ensureFolderStructure = async (handle: FileSystemDirectoryHandle) => {
    await handle.getDirectoryHandle(DATA_DIR, { create: true });
    await handle.getDirectoryHandle(FONT_DIR, { create: true });
    await handle.getDirectoryHandle(LIB_DIR, { create: true });

    const configHandle = await handle.getFileHandle(CONFIG_FILE, { create: true });
    const file = await configHandle.getFile();
    if (file.size === 0) {
      const config: LocalFileConfig = { version: 1, projects: [] };
      await writeFileText(configHandle, JSON.stringify(config, null, 2));
    }
  };

  private readConfig = async (handle: FileSystemDirectoryHandle): Promise<LocalFileConfig> => {
    try {
      const configHandle = await handle.getFileHandle(CONFIG_FILE, { create: true });
      const text = await readFileText(configHandle);
      if (!text.trim()) return { version: 1, projects: [] };
      const parsed = JSON.parse(text) as LocalFileConfig;
      if (!parsed.projects) return { version: 1, projects: [] };
      return parsed;
    } catch (err) {
      return { version: 1, projects: [] };
    }
  };

  private writeConfig = async (handle: FileSystemDirectoryHandle, config: LocalFileConfig) => {
    const configHandle = await handle.getFileHandle(CONFIG_FILE, { create: true });
    await writeFileText(configHandle, JSON.stringify(config, null, 2));
  };
}

// 创建本地文件适配器实例。
export const createLocalFileAdapter = () => new LocalFileAdapter();
