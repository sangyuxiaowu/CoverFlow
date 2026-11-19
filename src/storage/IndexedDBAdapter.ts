import { ProjectState } from '../types.ts';
import { ListProjectsOptions, StorageAdapter, StorageAdapterType, type ProjectSummary, summarizeProject } from './StorageAdapter.ts';
import { readProject, writeProject } from './projectCompatibility.ts';
import { notifyProjectPreview, pagePreviewFingerprint, rememberProjectPreview } from './projectPreviews.ts';

const DB_NAME = 'coverflow_projects_db_v1';
const STORE_NAME = 'projects';
const SUMMARY_STORE = 'summaries';
const PREVIEW_STORE = 'previews';
type StoredSummary = ProjectSummary & { firstPageId: string; fingerprint: string };

const createSummary = (project: ProjectState): StoredSummary => {
  const page = project.pages![0];
  return { ...summarizeProject(project), firstPageId: page.id, fingerprint: pagePreviewFingerprint(page) };
};

const openIndexedDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 2);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
    if (!request.result.objectStoreNames.contains(SUMMARY_STORE)) {
      const summaries = request.result.createObjectStore(SUMMARY_STORE, { keyPath: 'id' });
      const cursor = request.transaction!.objectStore(STORE_NAME).openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        try { summaries.put(createSummary(readProject(item.value))); }
        catch (error) { console.warn('[CoverFlow summary migration]', error); }
        item.continue();
      };
    }
    if (!request.result.objectStoreNames.contains(PREVIEW_STORE)) {
      const previews = request.result.createObjectStore(PREVIEW_STORE, { keyPath: ['projectId', 'pageId'] });
      previews.createIndex('projectId', 'projectId');
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const readAllProjects = async () => {
  const db = await openIndexedDb();
  try { return await new Promise<ProjectState[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      try { resolve((req.result as unknown[]).map(readProject)); }
      catch (error) { reject(error); }
    };
    req.onerror = () => reject(req.error);
  }); } finally { db.close(); }
};

const upsertProject = async (project: ProjectState) => {
  const db = await openIndexedDb();
  const document = writeProject(project);
  const tx = db.transaction([STORE_NAME, SUMMARY_STORE], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.put(document);
  tx.objectStore(SUMMARY_STORE).put(createSummary({ ...project, pages: document.pages }));
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
};

const deleteProject = async (projectId: string) => {
  const db = await openIndexedDb();
  const tx = db.transaction([STORE_NAME, SUMMARY_STORE, PREVIEW_STORE], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.delete(projectId);
  tx.objectStore(SUMMARY_STORE).delete(projectId);
  const cursor = tx.objectStore(PREVIEW_STORE).index('projectId').openKeyCursor(IDBKeyRange.only(projectId));
  cursor.onsuccess = () => { if (cursor.result) { tx.objectStore(PREVIEW_STORE).delete(cursor.result.primaryKey); cursor.result.continue(); } };
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
};

// IndexedDB 存储适配器。
export class IndexedDBAdapter implements StorageAdapter {
  type: StorageAdapterType = 'indexeddb';

  isAvailable = () => typeof indexedDB !== 'undefined';

  ensureReady = async () => this.isAvailable();

  getProject = async (projectId: string) => {
    if (!this.isAvailable()) return null;
    const db = await openIndexedDb();
    try {
      const project = await new Promise<ProjectState | null>((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(projectId);
        request.onsuccess = () => {
          try { resolve(request.result === undefined ? null : readProject(request.result)); }
          catch (error) { reject(error); }
        };
        request.onerror = () => reject(request.error);
      });
      if (!project) return null;
      let records: Array<{ pageId: string; fingerprint: string; blob: Blob }> = [];
      try { records = await new Promise<Array<{ pageId: string; fingerprint: string; blob: Blob }>>((resolve, reject) => {
        const request = db.transaction(PREVIEW_STORE, 'readonly').objectStore(PREVIEW_STORE).index('projectId').getAll(IDBKeyRange.only(projectId));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }); } catch (error) { console.warn('[CoverFlow preview read]', error); }
      for (const page of project.pages ?? []) {
        const record = records.find(item => item.pageId === page.id);
        if (record?.blob instanceof Blob && record.fingerprint === pagePreviewFingerprint(page)) {
          try { rememberProjectPreview(project, page, new Uint8Array(await record.blob.arrayBuffer())); }
          catch (error) { console.warn('[CoverFlow preview read]', error); }
        }
      }
      return project;
    } finally { db.close(); }
  };

  listProjectSummaries = async (): Promise<ProjectSummary[]> => {
    if (!this.isAvailable()) return [];
    const db = await openIndexedDb();
    try {
      return await new Promise<ProjectSummary[]>((resolve, reject) => {
        const request = db.transaction(SUMMARY_STORE, 'readonly').objectStore(SUMMARY_STORE).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  };

  getProjectPreview = async (projectId: string): Promise<Blob | undefined> => {
    if (!this.isAvailable()) return undefined;
    const db = await openIndexedDb();
    try {
      const summary = await new Promise<StoredSummary | undefined>((resolve, reject) => {
        const request = db.transaction(SUMMARY_STORE, 'readonly').objectStore(SUMMARY_STORE).get(projectId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!summary) return undefined;
      return await new Promise<Blob | undefined>((resolve, reject) => {
        const request = db.transaction(PREVIEW_STORE, 'readonly').objectStore(PREVIEW_STORE).get([projectId, summary.firstPageId]);
        request.onsuccess = () => resolve(request.result?.fingerprint === summary.fingerprint ? request.result.blob : undefined);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  };

  getPagePreview = async (projectId: string, pageId: string, fingerprint: string): Promise<Blob | undefined> => {
    if (!this.isAvailable()) return undefined;
    const db = await openIndexedDb();
    try {
      return await new Promise<Blob | undefined>((resolve, reject) => {
        const request = db.transaction(PREVIEW_STORE, 'readonly').objectStore(PREVIEW_STORE).get([projectId, pageId]);
        request.onsuccess = () => resolve(request.result?.fingerprint === fingerprint ? request.result.blob : undefined);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  };

  saveProjectPreview = async (project: ProjectState, pageId: string, preview: Blob) => {
    const page = project.pages?.find(item => item.id === pageId);
    if (!page || !this.isAvailable()) return;
    const fingerprint = pagePreviewFingerprint(page);
    const db = await openIndexedDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PREVIEW_STORE, 'readwrite');
        tx.objectStore(PREVIEW_STORE).put({ projectId: project.id, pageId, fingerprint, blob: preview });
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
      notifyProjectPreview(project.id);
    } finally { db.close(); }
  };

  listProjects = async (options?: ListProjectsOptions) => {
    if (!this.isAvailable()) return { items: [], total: 0 };
    const items = await readAllProjects();
    if (!options) return { items, total: items.length };
    const query = options.query?.trim().toLowerCase() || '';
    const filtered = items.filter(project => !query || project.title.toLowerCase().includes(query))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    return { items: filtered.slice(start, start + pageSize), total: filtered.length };
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
