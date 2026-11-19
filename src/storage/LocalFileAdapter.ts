import { ProjectState } from '../types.ts';
import { ListProjectsOptions, StorageAdapter, StorageAdapterType, type ProjectSummary, summarizeProject } from './StorageAdapter.ts';
import { decodeProjectArchive, encodeProjectArchive, prepareProjectArchivePreviews, readProjectArchiveManifest, sameStoredValue } from './projectArchive.ts';
import { readLegacyCfj } from './legacyCfj.ts';
import { readFileBlob, readFileBytes, readFileText, writeFileContent, writeFileContentOnce } from './fileAccess.ts';
import { writeProject } from './projectCompatibility.ts';
import { notifyProjectPreview, projectPreviews } from './projectPreviews.ts';

const FS_DB_NAME = 'coverflow_fs_handles_v1';
const FS_STORE_NAME = 'handles';
const FS_PROJECT_KEY = 'projectStorageFolder';
const DATA_DIR = 'data';
const FONT_DIR = 'font';
const LIB_DIR = 'lib';
const DECORATION_DIR = 'decoration';
const PROJECT_FILE_EXT = 'cfjx';
const INDEX_FILE = 'project.json';
const PREVIEW_DIR = 'preview';

type IndexEntry = { name: string; size: number; lastModified: number; project: ProjectSummary; previewStamp?: string };
type ProjectIndex = { format: 'coverflow-project-index'; version: 1; list: IndexEntry[] };

const isIndex = (value: unknown): value is ProjectIndex => {
  if (!value || typeof value !== 'object') return false;
  const index = value as ProjectIndex;
  return index.format === 'coverflow-project-index' && index.version === 1 && Array.isArray(index.list) && index.list.every(item =>
    typeof item?.name === 'string' && typeof item.size === 'number' && typeof item.lastModified === 'number' &&
    item.project?.kind === 'summary' && typeof item.project.id === 'string' && typeof item.project.title === 'string' &&
    typeof item.project.updatedAt === 'number' && typeof item.project.width === 'number' && typeof item.project.height === 'number' &&
    typeof item.project.pageCount === 'number' && typeof item.project.layerCount === 'number');
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

// 本地文件系统存储适配器。
export class LocalFileAdapter implements StorageAdapter {
  type: StorageAdapterType = 'localfile';
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private indexEntries: IndexEntry[] = [];
  private indexLoaded = false;
  private previewTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
          ? await decodeProjectArchive(await readFileBytes(item.handle))
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

  listProjectSummaries = async (): Promise<ProjectSummary[]> => {
    const ready = await this.ensureReady({ prompt: false });
    if (!ready || !this.rootHandle) return [];
    const operation = this.writeQueue.then(async () => {
      const root = this.rootHandle!;
      const data = await root.getDirectoryHandle(DATA_DIR, { create: true });
      let existing: IndexEntry[] = [];
      let mayWriteIndex = true;
      try {
        const handle = await root.getFileHandle(INDEX_FILE);
        const parsed: unknown = JSON.parse(await readFileText(handle));
        if (isIndex(parsed)) existing = parsed.list;
        else mayWriteIndex = false;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) mayWriteIndex = false;
      }
      const cached = new Map(existing.map(item => [item.name, item]));
      const next: IndexEntry[] = [];
      for await (const entry of data.values()) {
        if (entry.kind !== 'file' || !/\.(cfj|cfjx)$/i.test(entry.name)) continue;
        const handle = entry as FileSystemFileHandle;
        const previous = cached.get(handle.name);
        try {
          const file = await handle.getFile();
          if (previous && previous.size === file.size && previous.lastModified === file.lastModified) {
            next.push(previous);
            continue;
          }
          const project = handle.name.toLowerCase().endsWith('.cfjx')
            ? await readProjectArchiveManifest(await readFileBytes(handle))
            : readLegacyCfj(await readFileText(handle));
          next.push({ name: handle.name, size: file.size, lastModified: file.lastModified, project: summarizeProject(project) });
        } catch (error) {
          if (previous) next.push(previous);
          console.warn('[CoverFlow project index]', handle.name, error);
        }
      }
      this.indexEntries = next;
      this.indexLoaded = true;
      if (mayWriteIndex && JSON.stringify(existing) !== JSON.stringify(next)) {
        try {
          const handle = await root.getFileHandle(INDEX_FILE, { create: true });
          await writeFileContent(handle, JSON.stringify({ format: 'coverflow-project-index', version: 1, list: next } satisfies ProjectIndex));
        } catch (error) { console.warn('[CoverFlow project index write]', error); }
      }
      const currentCovers = new Set(next.filter(item => item.previewStamp === `${item.size}:${item.lastModified}`).map(item => item.name.replace(/\.(cfj|cfjx)$/i, '')));
      const staleCovers = new Set(existing.filter(item => item.previewStamp && !currentCovers.has(item.name.replace(/\.(cfj|cfjx)$/i, ''))).map(item => `${item.name.replace(/\.(cfj|cfjx)$/i, '')}.webp`));
      if (staleCovers.size) {
        try {
          const directory = await root.getDirectoryHandle(PREVIEW_DIR);
          for (const name of staleCovers) {
            try { await directory.removeEntry(name); }
            catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
          }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'NotFoundError')) console.warn('[CoverFlow preview cleanup]', error);
        }
      }
      const unique = new Map<string, IndexEntry>();
      next.sort((left, right) => Number(right.name.toLowerCase().endsWith('.cfjx')) - Number(left.name.toLowerCase().endsWith('.cfjx')) || right.lastModified - left.lastModified);
      for (const item of next) if (!unique.has(item.project.id)) unique.set(item.project.id, item);
      return [...unique.values()].map(item => item.project);
    });
    this.writeQueue = operation.then(() => {}, () => {});
    return operation;
  };

  getProject = async (projectId: string): Promise<ProjectState | null> => {
    if (!await this.ensureReady({ prompt: false }) || !this.rootHandle) return null;
    if (!this.indexEntries.length) await this.listProjectSummaries();
    const candidates = this.indexEntries.filter(item => item.project.id === projectId)
      .sort((left, right) => Number(right.name.toLowerCase().endsWith('.cfjx')) - Number(left.name.toLowerCase().endsWith('.cfjx')) || right.lastModified - left.lastModified);
    const data = await this.rootHandle.getDirectoryHandle(DATA_DIR, { create: true });
    for (const item of candidates) {
      try {
        const handle = await data.getFileHandle(item.name);
        const project = item.name.toLowerCase().endsWith('.cfjx')
          ? await decodeProjectArchive(await readFileBytes(handle))
          : readLegacyCfj(await readFileText(handle));
        if (project.id === projectId) return project;
      } catch (error) { console.warn('[CoverFlow project read]', item.name, error); }
    }
    return null;
  };

  getProjectPreview = async (projectId: string): Promise<Blob | undefined> => {
    if (!await this.ensureReady({ prompt: false }) || !this.rootHandle) return undefined;
    try {
      const item = this.indexEntries.find(entry => entry.project.id === projectId);
      if (!item || item.previewStamp !== `${item.size}:${item.lastModified}`) return undefined;
      const stem = item.name.replace(/\.(cfj|cfjx)$/i, '');
      if (this.indexEntries.some(entry => entry.project.id !== projectId && entry.name.replace(/\.(cfj|cfjx)$/i, '') === stem)) return undefined;
      const directory = await this.rootHandle.getDirectoryHandle(PREVIEW_DIR);
      return await readFileBlob(await directory.getFileHandle(`${stem}.webp`), 'image/webp');
    } catch { return undefined; }
  };

  private persistIndex = async () => {
    const root = this.rootHandle!;
    try {
      try {
        const handle = await root.getFileHandle(INDEX_FILE);
        if (!isIndex(JSON.parse(await readFileText(handle)))) return;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) return;
      }
      const handle = await root.getFileHandle(INDEX_FILE, { create: true });
      await writeFileContent(handle, JSON.stringify({ format: 'coverflow-project-index', version: 1, list: this.indexEntries } satisfies ProjectIndex));
    } catch (error) { console.warn('[CoverFlow project index write]', error); }
  };

  private ensureIndexLoaded = async () => {
    if (this.indexLoaded) return;
    try {
      const handle = await this.rootHandle!.getFileHandle(INDEX_FILE);
      const parsed: unknown = JSON.parse(await readFileText(handle));
      if (isIndex(parsed)) this.indexEntries = parsed.list;
    } catch {}
    this.indexLoaded = true;
  };

  private writeCover = async (name: string, preview: Uint8Array) => {
    const directory = await this.rootHandle!.getDirectoryHandle(PREVIEW_DIR, { create: true });
    const handle = await directory.getFileHandle(`${name.replace(/\.(cfj|cfjx)$/i, '')}.webp`, { create: true });
    await writeFileContent(handle, new Blob([preview as Uint8Array<ArrayBuffer>], { type: 'image/webp' }));
  };

  saveProjectPreview = async (project: ProjectState, _pageId: string, _preview: Blob) => {
    const previous = this.previewTimers.get(project.id);
    if (previous) clearTimeout(previous);
    this.previewTimers.set(project.id, setTimeout(() => {
      this.previewTimers.delete(project.id);
      const operation = this.writeQueue.then(async () => {
        if (!this.rootHandle) return;
        await this.ensureIndexLoaded();
        const cached = projectPreviews(project);
        if (!Object.keys(cached).length) return;
        const item = this.indexEntries.find(entry => entry.project.id === project.id);
        const name = item?.name ?? `${project.id}.${PROJECT_FILE_EXT}`;
        const data = await this.rootHandle.getDirectoryHandle(DATA_DIR, { create: true });
        const handle = await data.getFileHandle(name);
        const before = await handle.getFile();
        const archiveBytes = name.toLowerCase().endsWith('.cfjx') ? await readFileBytes(handle) : undefined;
        const stored = archiveBytes ? project : readLegacyCfj(await readFileText(handle));
        let bytes: Uint8Array | undefined;
        if (archiveBytes) {
          const result = await prepareProjectArchivePreviews(archiveBytes, project, cached);
          if (!result.matches) return;
          bytes = result.bytes;
        } else if (!sameStoredValue(writeProject(stored), writeProject(project))) return;
        const latest = await handle.getFile();
        if (latest.size !== before.size || latest.lastModified !== before.lastModified) return;
        if (!bytes && item?.previewStamp === `${latest.size}:${latest.lastModified}`) {
          try {
            const directory = await this.rootHandle.getDirectoryHandle(PREVIEW_DIR);
            await directory.getFileHandle(`${name.replace(/\.(cfj|cfjx)$/i, '')}.webp`);
            return;
          } catch (error) {
            if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
          }
        }
        if (bytes) {
          await writeFileContentOnce(handle, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
        }
        const current = await handle.getFile();
        const cover = cached[project.pages?.[0]?.id ?? ''];
        if (cover) await this.writeCover(name, cover);
        const entry: IndexEntry = { name, size: current.size, lastModified: current.lastModified, project: summarizeProject(stored), ...(cover ? { previewStamp: `${current.size}:${current.lastModified}` } : {}) };
        this.indexEntries = [...this.indexEntries.filter(candidate => candidate.name !== name), entry];
        await this.persistIndex();
        notifyProjectPreview(project.id);
      });
      this.writeQueue = operation.catch(error => { console.warn('[CoverFlow preview save]', error); });
    }, 3000));
  };

  saveProject = async (project: ProjectState) => {
    const ready = await this.ensureReady({ prompt: false });
    if (!ready || !this.rootHandle) throw new Error('Project storage folder is unavailable or write permission was not granted.');

    const operation = this.writeQueue.then(async () => {
      await this.ensureIndexLoaded();
      const dataHandle = await this.rootHandle!.getDirectoryHandle(DATA_DIR, { create: true });
      try {
        const existing = await dataHandle.getFileHandle(`${project.id}.${PROJECT_FILE_EXT}`);
        const file = await existing.getFile();
        const indexed = this.indexEntries.find(item => item.name === existing.name);
        if (!indexed || indexed.size !== file.size || indexed.lastModified !== file.lastModified) {
          const previous = await readProjectArchiveManifest(await readFileBytes(existing));
          if (previous.id !== project.id) throw new Error('The project file name is already used by another project.');
        } else if (indexed.project.id !== project.id) {
          throw new Error('The project file name is already used by another project.');
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      }
      const fileHandle = await dataHandle.getFileHandle(`${project.id}.${PROJECT_FILE_EXT}`, { create: true });
      const bytes = await encodeProjectArchive(project);
      await writeFileContent(fileHandle, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
      try {
        const file = await fileHandle.getFile();
        const cover = projectPreviews(project)[project.pages?.[0]?.id ?? ''];
        if (cover) await this.writeCover(fileHandle.name, cover);
        const entry: IndexEntry = { name: fileHandle.name, size: file.size, lastModified: file.lastModified, project: summarizeProject(project), ...(cover ? { previewStamp: `${file.size}:${file.lastModified}` } : {}) };
        this.indexEntries = [...this.indexEntries.filter(item => item.name !== fileHandle.name), entry];
        await this.persistIndex();
        if (cover) notifyProjectPreview(project.id);
      } catch (error) { console.warn('[CoverFlow project index update]', error); }
    });

    this.writeQueue = operation.catch(() => {});
    return operation;
  };

  deleteProject = async (projectId: string) => {
    const ready = await this.ensureReady({ prompt: false });
    if (!ready || !this.rootHandle) throw new Error('Project storage folder is unavailable or write permission was not granted.');

    const operation = this.writeQueue.then(async () => {
      await this.ensureIndexLoaded();
      const dataHandle = await this.rootHandle!.getDirectoryHandle(DATA_DIR, { create: true });
      const names = new Set([`${projectId}.${PROJECT_FILE_EXT}`, `${projectId}.cfj`, ...this.indexEntries.filter(item => item.project.id === projectId).map(item => item.name)]);
      const deleted = new Set<string>();
      for (const name of names) {
        try {
          const handle = await dataHandle.getFileHandle(name);
          const project = name.toLowerCase().endsWith('.cfjx')
            ? await readProjectArchiveManifest(await readFileBytes(handle))
            : readLegacyCfj(await readFileText(handle));
          if (project.id !== projectId) continue;
          await dataHandle.removeEntry(name);
          deleted.add(name);
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'NotFoundError')) throw err;
        }
      }
      this.indexEntries = this.indexEntries.filter(item => item.project.id !== projectId);
      await this.persistIndex();
      try {
        const directory = await this.rootHandle!.getDirectoryHandle(PREVIEW_DIR);
        for (const name of deleted) {
          const stem = name.replace(/\.(cfj|cfjx)$/i, '');
          if (this.indexEntries.some(item => item.name.replace(/\.(cfj|cfjx)$/i, '') === stem)) continue;
          try { await directory.removeEntry(`${name.replace(/\.(cfj|cfjx)$/i, '')}.webp`); }
          catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) console.warn('[CoverFlow preview delete]', error);
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
