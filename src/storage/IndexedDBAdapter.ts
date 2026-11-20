import { ProjectDocument, ProjectPage, ProjectState } from '../types.ts';
import { ListProjectsOptions, StorageAdapter, StorageAdapterType, type ProjectSummary, summarizeProject } from './StorageAdapter.ts';
import { readProject, writeProject } from './projectCompatibility.ts';
import { notifyProjectPreview, pagePreviewFingerprint, pagePreviewFingerprintAsync, rememberProjectPreview } from './projectPreviews.ts';
import { readLegacyIndexedDBProject } from './legacyCfj.ts';
import { packImagePages, unpackImagePages, type ImageAsset, type ImageCache } from './indexedDbImages.ts';
import { captureImageAssets } from './imageAssets.ts';

const DB_NAME = 'coverflow_projects_db_v1';
const STORE_NAME = 'projects';
const SUMMARY_STORE = 'summaries';
const PREVIEW_STORE = 'previews';
const PAGE_STORE = 'projectPages';
const ASSET_STORE = 'projectImages';
type StoredSummary = ProjectSummary & { firstPageId: string; fingerprint: string };
type PagedProject = Omit<ProjectDocument, 'pages'> & { storageFormat: 'paged-v1'; pageIds: string[]; revision: string; assetIds?: string[] };
type StoredPage = { projectId: string; pageId: string; page: ProjectPage };
type StoredAsset = ImageAsset & { projectId: string };
let lastPages: { factory: IDBFactory; projectId: string; revision: string; pages: ProjectPage[] } | null = null;
let lastImages: { factory: IDBFactory; projectId: string; cache: ImageCache } | null = null;
let cacheEpoch = 0;
const projectWrites = new WeakMap<IDBFactory, Map<string, Promise<void>>>();

const enqueueProjectWrite = (projectId: string, operation: () => Promise<void>) => {
  const factory = indexedDB;
  let queue = projectWrites.get(factory);
  if (!queue) { queue = new Map(); projectWrites.set(factory, queue); }
  const writes = queue;
  const result = (writes.get(projectId) ?? Promise.resolve()).then(operation);
  const settled = result.catch(() => {});
  writes.set(projectId, settled);
  void settled.then(() => { if (writes.get(projectId) === settled) writes.delete(projectId); });
  return result;
};

export function releaseProjectStorageCache(projectId: string) {
  cacheEpoch++;
  if (lastPages?.projectId === projectId) lastPages = null;
  if (lastImages?.projectId === projectId) lastImages = null;
}

export const cachedProjectImage = (projectId: string, value: string) =>
  lastImages?.factory === globalThis.indexedDB && lastImages.projectId === projectId ? lastImages.cache.get(value) : undefined;

const isPagedProject = (value: unknown): value is PagedProject => Boolean(value && typeof value === 'object' && (value as PagedProject).storageFormat === 'paged-v1');

const readStoredProject = async (value: unknown, records: StoredPage[], assets: StoredAsset[]) => {
  if (!isPagedProject(value)) return { project: readLegacyIndexedDBProject(value), cache: new Map() as ImageCache };
  if (!Array.isArray(value.pageIds) || typeof value.revision !== 'string' || !value.revision) throw new Error('Invalid stored project index.');
  const pages = new Map(records.filter(record => record.projectId === value.id).map(record => [record.pageId, record.page]));
  const ordered = value.pageIds.map(id => {
    const page = pages.get(id);
    if (!page || page.id !== id) throw new Error('Missing stored project page.');
    return page;
  });
  const unpacked = await unpackImagePages(ordered, assets.filter(asset => asset.projectId === value.id));
  return { project: readProject({ ...value, pages: unpacked.pages }), cache: unpacked.cache };
};

const requestValue = <Value,>(request: IDBRequest<Value>) => new Promise<Value>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const createSummary = async (project: ProjectState): Promise<StoredSummary> => {
  const page = project.pages![0];
  return { ...summarizeProject(project), firstPageId: page.id, fingerprint: await pagePreviewFingerprintAsync(page) };
};

const openIndexedDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 4);
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
        try {
          const project = readProject(item.value);
          const page = project.pages![0];
          summaries.put({ ...summarizeProject(project), firstPageId: page.id, fingerprint: pagePreviewFingerprint(page) });
        }
        catch (error) { console.warn('[CoverFlow summary migration]', error); }
        item.continue();
      };
    }
    if (!request.result.objectStoreNames.contains(PREVIEW_STORE)) {
      const previews = request.result.createObjectStore(PREVIEW_STORE, { keyPath: ['projectId', 'pageId'] });
      previews.createIndex('projectId', 'projectId');
    }
    if (!request.result.objectStoreNames.contains(PAGE_STORE)) {
      const pages = request.result.createObjectStore(PAGE_STORE, { keyPath: ['projectId', 'pageId'] });
      pages.createIndex('projectId', 'projectId');
    }
    if (!request.result.objectStoreNames.contains(ASSET_STORE)) {
      const images = request.result.createObjectStore(ASSET_STORE, { keyPath: ['projectId', 'id'] });
      images.createIndex('projectId', 'projectId');
    }
  };
  request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  request.onerror = () => reject(request.error);
});

const readAllProjects = async () => {
  const db = await openIndexedDb();
  try { return await new Promise<ProjectState[]>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, PAGE_STORE, ASSET_STORE], 'readonly');
    Promise.all([requestValue(tx.objectStore(STORE_NAME).getAll()), requestValue(tx.objectStore(PAGE_STORE).getAll()), requestValue(tx.objectStore(ASSET_STORE).getAll())])
      .then(([projects, pages, assets]) => Promise.all((projects as unknown[]).map(value => readStoredProject(value, pages as StoredPage[], assets as StoredAsset[]))))
      .then(results => resolve(results.map(result => result.project))).catch(reject);
  }); } finally { db.close(); }
};

const upsertProject = async (project: ProjectState, held: Map<string, Blob>) => {
  const epoch = cacheEpoch;
  const document = writeProject(project);
  const summary = await createSummary({ ...project, pages: document.pages });
  const cache: ImageCache = new Map();
  const previousPages = lastPages;
  const previousImages = lastImages?.factory === indexedDB && lastImages.projectId === project.id ? lastImages.cache : undefined;
  const packed = await packImagePages(document.pages, cache, previousImages, held);
  const db = await openIndexedDb();
  const tx = db.transaction([STORE_NAME, SUMMARY_STORE, PAGE_STORE, ASSET_STORE], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const pages = tx.objectStore(PAGE_STORE);
  const images = tx.objectStore(ASSET_STORE);
  const revision = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}-${Math.random()}`;
  const existing = store.get(project.id);
  existing.onsuccess = () => {
    const previous: unknown = existing.result;
    if (isPagedProject(previous)) {
      if (!Array.isArray(previous.pageIds) || typeof previous.revision !== 'string' || !previous.revision) { tx.abort(); return; }
      const ids = new Set(document.pages.map(page => page.id));
      for (const id of previous.pageIds) if (!ids.has(id)) pages.delete([project.id, id]);
      for (const id of previous.assetIds ?? []) if (!packed.assets.has(id)) images.delete([project.id, id]);
    }
    const cached = previousImages && previousPages?.factory === indexedDB && previousPages.projectId === project.id && isPagedProject(previous) && Array.isArray(previous.assetIds) && previousPages.revision === previous.revision ? previousPages : null;
    for (const [index, page] of document.pages.entries()) {
      if (!cached?.pages.includes(page)) pages.put({ projectId: project.id, pageId: page.id, page: packed.pages[index] } satisfies StoredPage);
    }
    const existingAssets = new Set(isPagedProject(previous) ? previous.assetIds ?? [] : []);
    for (const asset of packed.assets.values()) if (!existingAssets.has(asset.id)) images.put({ projectId: project.id, ...asset } satisfies StoredAsset);
    const { pages: _pages, ...metadata } = document;
    store.put({ ...metadata, storageFormat: 'paged-v1', pageIds: document.pages.map(page => page.id), revision, assetIds: [...packed.assets.keys()] } satisfies PagedProject);
    tx.objectStore(SUMMARY_STORE).put(summary);
  };
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => { if (epoch === cacheEpoch) { lastPages = { factory: indexedDB, projectId: project.id, revision, pages: document.pages }; lastImages = { factory: indexedDB, projectId: project.id, cache }; } db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
};

const deleteProject = async (projectId: string) => {
  const db = await openIndexedDb();
  const tx = db.transaction([STORE_NAME, SUMMARY_STORE, PREVIEW_STORE, PAGE_STORE, ASSET_STORE], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.delete(projectId);
  tx.objectStore(SUMMARY_STORE).delete(projectId);
  const cursor = tx.objectStore(PREVIEW_STORE).index('projectId').openKeyCursor(IDBKeyRange.only(projectId));
  cursor.onsuccess = () => { if (cursor.result) { tx.objectStore(PREVIEW_STORE).delete(cursor.result.primaryKey); cursor.result.continue(); } };
  const pageCursor = tx.objectStore(PAGE_STORE).index('projectId').openKeyCursor(IDBKeyRange.only(projectId));
  pageCursor.onsuccess = () => { if (pageCursor.result) { tx.objectStore(PAGE_STORE).delete(pageCursor.result.primaryKey); pageCursor.result.continue(); } };
  const assetCursor = tx.objectStore(ASSET_STORE).index('projectId').openKeyCursor(IDBKeyRange.only(projectId));
  assetCursor.onsuccess = () => { if (assetCursor.result) { tx.objectStore(ASSET_STORE).delete(assetCursor.result.primaryKey); assetCursor.result.continue(); } };
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => { if (lastPages?.factory === indexedDB && lastPages.projectId === projectId) lastPages = null; if (lastImages?.factory === indexedDB && lastImages.projectId === projectId) lastImages = null; db.close(); resolve(); };
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
    const epoch = cacheEpoch;
    const db = await openIndexedDb();
    try {
      const tx = db.transaction([STORE_NAME, PAGE_STORE, ASSET_STORE], 'readonly');
      const [stored, pages, assets] = await Promise.all([
        requestValue(tx.objectStore(STORE_NAME).get(projectId)),
        requestValue(tx.objectStore(PAGE_STORE).index('projectId').getAll(IDBKeyRange.only(projectId))),
        requestValue(tx.objectStore(ASSET_STORE).index('projectId').getAll(IDBKeyRange.only(projectId)))
      ]);
      if (stored === undefined) return null;
      const { project, cache } = await readStoredProject(stored, pages as StoredPage[], assets as StoredAsset[]);
      if (epoch === cacheEpoch) {
        if (isPagedProject(stored)) lastPages = { factory: indexedDB, projectId, revision: stored.revision, pages: project.pages! };
        lastImages = { factory: indexedDB, projectId, cache };
      }
      let records: Array<{ pageId: string; fingerprint: string; blob: Blob }> = [];
      try { records = await new Promise<Array<{ pageId: string; fingerprint: string; blob: Blob }>>((resolve, reject) => {
        const request = db.transaction(PREVIEW_STORE, 'readonly').objectStore(PREVIEW_STORE).index('projectId').getAll(IDBKeyRange.only(projectId));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }); } catch (error) { console.warn('[CoverFlow preview read]', error); }
      for (const page of project.pages ?? []) {
        const record = records.find(item => item.pageId === page.id);
        if (record?.blob instanceof Blob && record.fingerprint === await pagePreviewFingerprintAsync(page)) {
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
    await enqueueProjectWrite(project.id, async () => {
      const fingerprint = await pagePreviewFingerprintAsync(page);
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
    });
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
    const held = captureImageAssets(writeProject(project).pages);
    await enqueueProjectWrite(project.id, () => upsertProject(project, held));
  };

  deleteProject = async (projectId: string) => {
    if (!this.isAvailable()) return;
    await enqueueProjectWrite(projectId, () => deleteProject(projectId));
  };
}

// 创建 IndexedDB 适配器实例。
export const createIndexedDBAdapter = () => new IndexedDBAdapter();
