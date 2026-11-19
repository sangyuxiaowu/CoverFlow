import { ProjectState } from '../types.ts';
import { ListProjectsOptions, StorageAdapter, StorageAdapterType } from './StorageAdapter.ts';
import { decodeProjectArchive, encodeProjectArchive } from './projectArchive.ts';
import { readLegacyCfj } from './legacyCfj.ts';
import { readFileBlob, readFileText, writeFileContent } from './fileAccess.ts';

const FS_DB_NAME = 'coverflow_fs_handles_v1';
const FS_STORE_NAME = 'handles';
const FS_PROJECT_KEY = 'projectStorageFolder';
const DATA_DIR = 'data';
const FONT_DIR = 'font';
const LIB_DIR = 'lib';
const DECORATION_DIR = 'decoration';
const PROJECT_FILE_EXT = 'cfjx';

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
      const fileHandle = entry as FileSystemFileHandle;
      if (!/\.(cfj|cfjx)$/i.test(fileHandle.name)) continue;
      try {
        const file = await fileHandle.getFile();
        entries.push({ handle: fileHandle, lastModified: file.lastModified });
      } catch (err) {
        // Skip unreadable entries
      }
    }

    const sorted = entries.sort((a, b) => Number(b.handle.name.toLowerCase().endsWith('.cfjx')) - Number(a.handle.name.toLowerCase().endsWith('.cfjx')) || b.lastModified - a.lastModified);
    const query = options?.query?.trim().toLowerCase() || '';
    const projects = new Map<string, { project: ProjectState; lastModified: number }>();
    for (const item of sorted) {
      try {
        const project = item.handle.name.toLowerCase().endsWith('.cfjx')
          ? await decodeProjectArchive(new Uint8Array(await (await readFileBlob(item.handle, 'application/zip')).arrayBuffer()))
          : readLegacyCfj(await readFileText(item.handle));
        if (!projects.has(project.id)) projects.set(project.id, { project, lastModified: item.lastModified });
      } catch (err) {
        // Skip invalid entries
      }
    }
    const filtered = [...projects.values()].filter(item => !query || item.project.title.toLowerCase().includes(query)).sort((left, right) => right.lastModified - left.lastModified);
    if (!options) return { items: filtered.map(item => item.project), total: filtered.length };
    const start = ((options.page ?? 1) - 1) * (options.pageSize ?? 20);
    return { items: filtered.slice(start, start + (options.pageSize ?? 20)).map(item => item.project), total: filtered.length };
  };

  saveProject = async (project: ProjectState) => {
    const ready = await this.ensureReady({ prompt: false });
    if (!ready || !this.rootHandle) throw new Error('Project storage folder is unavailable or write permission was not granted.');

    const operation = this.writeQueue.then(async () => {
      const dataHandle = await this.rootHandle!.getDirectoryHandle(DATA_DIR, { create: true });
      const fileHandle = await dataHandle.getFileHandle(`${project.id}.${PROJECT_FILE_EXT}`, { create: true });
      const bytes = await encodeProjectArchive(project);
      await writeFileContent(fileHandle, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
    });

    this.writeQueue = operation.catch(() => {});
    return operation;
  };

  deleteProject = async (projectId: string) => {
    const ready = await this.ensureReady({ prompt: false });
    if (!ready || !this.rootHandle) throw new Error('Project storage folder is unavailable or write permission was not granted.');

    const operation = this.writeQueue.then(async () => {
      const dataHandle = await this.rootHandle!.getDirectoryHandle(DATA_DIR, { create: true });
      for (const extension of [PROJECT_FILE_EXT, 'cfj']) {
        try {
          await dataHandle.removeEntry(`${projectId}.${extension}`);
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'NotFoundError')) throw err;
        }
      }
    });

    this.writeQueue = operation.catch(() => {});
    return operation;
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
    await handle.getDirectoryHandle(DECORATION_DIR, { create: true });
  };
}

// 创建本地文件适配器实例。
export const createLocalFileAdapter = () => new LocalFileAdapter();
