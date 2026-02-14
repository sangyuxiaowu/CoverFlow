import { ProjectState } from '../types.ts';
import { StorageAdapter, StorageAdapterType } from './StorageAdapter.ts';

const DB_NAME = 'coverflow_projects_db_v1';
const STORE_NAME = 'projects';

const openIndexedDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const readAllProjects = async () => {
  const db = await openIndexedDb();
  return new Promise<ProjectState[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as ProjectState[]);
    req.onerror = () => reject(req.error);
  });
};

const upsertProject = async (project: ProjectState) => {
  const db = await openIndexedDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.put(project);
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

const deleteProject = async (projectId: string) => {
  const db = await openIndexedDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.delete(projectId);
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

// IndexedDB 存储适配器。
export class IndexedDBAdapter implements StorageAdapter {
  type: StorageAdapterType = 'indexeddb';

  isAvailable = () => typeof indexedDB !== 'undefined';

  ensureReady = async () => this.isAvailable();

  listProjects = async () => {
    if (!this.isAvailable()) return { items: [], total: 0 };
    const items = await readAllProjects();
    return { items, total: items.length };
  };

  saveProject = async (project: ProjectState) => {
    if (!this.isAvailable()) return;
    await upsertProject(project);
  };

  deleteProject = async (projectId: string) => {
    if (!this.isAvailable()) return;
    await deleteProject(projectId);
  };
}

// 创建 IndexedDB 适配器实例。
export const createIndexedDBAdapter = () => new IndexedDBAdapter();
