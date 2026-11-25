import type { ProjectSummary } from './StorageAdapter.ts';

export type BrowserRecentProject = {
  path: string;
  handle: FileSystemFileHandle;
  summary: ProjectSummary;
  lastOpenedAt: number;
};

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('coverflow_recent_files_v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'path' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function listBrowserRecentProjects(): Promise<BrowserRecentProject[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('files', 'readonly').objectStore('files').getAll();
      request.onsuccess = () => resolve((request.result as BrowserRecentProject[]).sort((left, right) => right.lastOpenedAt - left.lastOpenedAt));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function putBrowserRecentProject(item: BrowserRecentProject): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      transaction.objectStore('files').put(item);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function removeBrowserRecentProject(path: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      transaction.objectStore('files').delete(path);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}