import { ProjectState } from '../types.ts';
import { ListProjectsOptions, StorageAdapter, StorageAdapterType } from './StorageAdapter.ts';

const FS_DB_NAME = 'coverflow_fs_handles_v1';
const FS_STORE_NAME = 'handles';
const FS_PROJECT_KEY = 'projectStorageFolder';
const DATA_DIR = 'data';
const FONT_DIR = 'font';
const LIB_DIR = 'lib';
const PROJECT_FILE_EXT = 'cfj';

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

  listProjects = async (options?: ListProjectsOptions) => {
    const ready = await this.ensureReady({ prompt: false });
    if (!ready || !this.rootHandle) return { items: [], total: 0 };

    const dataHandle = await this.rootHandle.getDirectoryHandle(DATA_DIR, { create: true });
    const entries: Array<{ handle: FileSystemFileHandle; lastModified: number }> = [];

    for await (const entry of dataHandle.values()) {
      if (entry.kind !== 'file') continue;
      if (!entry.name.toLowerCase().endsWith(`.${PROJECT_FILE_EXT}`)) continue;
      try {
        const file = await entry.getFile();
        entries.push({ handle: entry, lastModified: file.lastModified });
      } catch (err) {
        // Skip unreadable entries
      }
    }

    const sorted = entries.sort((a, b) => b.lastModified - a.lastModified);
    const query = options?.query?.trim().toLowerCase() || '';

    if (!options && !query) {
      const projects: ProjectState[] = [];
      for (const item of sorted) {
        try {
          const text = await readFileText(item.handle);
          projects.push(JSON.parse(text) as ProjectState);
        } catch (err) {
          // Skip invalid entries
        }
      }
      return { items: projects, total: projects.length };
    }

    if (query) {
      const filtered: Array<{ project: ProjectState; lastModified: number }> = [];
      for (const item of sorted) {
        try {
          const text = await readFileText(item.handle);
          const parsed = JSON.parse(text) as ProjectState;
          if (!parsed?.title) continue;
          if (parsed.title.toLowerCase().includes(query)) {
            filtered.push({ project: parsed, lastModified: item.lastModified });
          }
        } catch (err) {
          // Skip invalid entries
        }
      }
      const page = options?.page ?? 1;
      const pageSize = options?.pageSize ?? 20;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      return {
        items: filtered.slice(start, end).map(item => item.project),
        total: filtered.length
      };
    }

    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageEntries = sorted.slice(start, end);
    const pageProjects: ProjectState[] = [];

    for (const item of pageEntries) {
      try {
        const text = await readFileText(item.handle);
        pageProjects.push(JSON.parse(text) as ProjectState);
      } catch (err) {
        // Skip invalid entries
      }
    }

    return { items: pageProjects, total: sorted.length };
  };

  saveProject = async (project: ProjectState) => {
    const ready = await this.ensureReady({ prompt: false });
    if (!ready || !this.rootHandle) return;

    this.writeQueue = this.writeQueue.then(async () => {
      const dataHandle = await this.rootHandle!.getDirectoryHandle(DATA_DIR, { create: true });
      const fileHandle = await dataHandle.getFileHandle(`${project.id}.${PROJECT_FILE_EXT}`, { create: true });
      await writeFileText(fileHandle, JSON.stringify(project, null, 2));
    });

    return this.writeQueue;
  };

  deleteProject = async (projectId: string) => {
    const ready = await this.ensureReady({ prompt: false });
    if (!ready || !this.rootHandle) return;

    this.writeQueue = this.writeQueue.then(async () => {
      const dataHandle = await this.rootHandle!.getDirectoryHandle(DATA_DIR, { create: true });
      try {
        await dataHandle.removeEntry(`${projectId}.${PROJECT_FILE_EXT}`);
      } catch (err) {
        // Ignore delete failures
      }
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
  };
}

// 创建本地文件适配器实例。
export const createLocalFileAdapter = () => new LocalFileAdapter();
