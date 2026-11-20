import 'fake-indexeddb/auto';
import { test, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import assert from 'node:assert/strict';
import { IndexedDBAdapter } from './IndexedDBAdapter.ts';
import { syncProjectPages, writeProject } from './projectCompatibility.ts';
import { Blob as NodeBlob } from 'node:buffer';
import { imageAssets } from './imageAssets.ts';
import { unpackImagePages } from './indexedDbImages.ts';

test('reads an individual project by ID', async () => {
  const adapter = new IndexedDBAdapter();
  const project = syncProjectPages({ id: 'single-project', title: 'Single', layers: [], pageInfo: { ...({ width: 100, height: 100 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } }, selectedLayerId: null, updatedAt: 0 });
  await adapter.saveProject(project);
  assert.equal((await adapter.getProject(project.id))?.id, project.id);
  assert.equal(await adapter.getProject('missing-project'), null);
  await adapter.deleteProject(project.id);
});

test('stores lightweight summaries and rejects stale preview images', async () => {
  const adapter = new IndexedDBAdapter();
  const project = syncProjectPages({ id: 'preview-project', title: 'Preview', layers: [], pageInfo: { width: 100, height: 50, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } }, selectedLayerId: null, updatedAt: 1 });
  const preview = new NodeBlob(['image'], { type: 'image/webp' }) as unknown as Blob;
  await adapter.saveProject(project);
  await adapter.saveProjectPreview(project, project.pages![0].id, preview);
  assert.equal((await adapter.listProjectSummaries()).find(item => item.id === project.id)?.width, 100);
  assert.equal((await adapter.getProjectPreview(project.id))?.size, preview.size);
  await adapter.saveProject({ ...project, pageInfo: { ...project.pageInfo, width: 200 }, updatedAt: 2 });
  assert.equal(await adapter.getProjectPreview(project.id), undefined);
  await adapter.deleteProject(project.id);
  assert.equal((await adapter.listProjectSummaries()).some(item => item.id === project.id), false);
});

test('upgrades a version 1 database without losing projects', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  try {
    const project = syncProjectPages({ id: 'legacy', title: 'Legacy', layers: [], pageInfo: { width: 120, height: 80, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } }, selectedLayerId: null, updatedAt: 1 });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('coverflow_projects_db_v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' }).put(writeProject(project));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const adapter = new IndexedDBAdapter();
    assert.equal((await adapter.listProjectSummaries())[0]?.title, 'Legacy');
    assert.equal((await adapter.getProject(project.id))?.pageInfo.width, 120);
  } finally { vi.unstubAllGlobals(); }
});

test('stores pages separately, writes only changed pages, and deletes removed pages', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  try {
    const adapter = new IndexedDBAdapter();
    const first = syncProjectPages({ id: 'paged', title: 'Paged', layers: [], pageInfo: { width: 120, height: 80, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } }, selectedLayerId: null, updatedAt: 1 });
    const second = { ...first.pages![0], id: 'second', name: 'Second' };
    const third = { ...first.pages![0], id: 'third', name: 'Third' };
    const project = { ...first, pages: [first.pages![0], second, third] };
    await adapter.saveProject(project);
    assert.equal(put.mock.contexts.filter(store => (store as IDBObjectStore).name === 'projectPages').length, 3);
    put.mockClear();
    const changed = { ...project, pages: [project.pages[0], { ...second, name: 'Changed' }, third], updatedAt: 2 };
    await adapter.saveProject(changed);
    assert.equal(put.mock.contexts.filter(store => (store as IDBObjectStore).name === 'projectPages').length, 1);
    const reopened = await adapter.getProject(project.id);
    assert.deepEqual(reopened?.pages?.map(page => page.name), ['', 'Changed', 'Third']);
    assert.equal(reopened?.selectedLayerId, null);
    await adapter.saveProject({ ...reopened!, pages: [reopened!.pages![0], reopened!.pages![2]], updatedAt: 3 });
    assert.deepEqual((await adapter.listProjects()).items[0].pages?.map(page => page.id), [project.pages[0].id, 'third']);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('coverflow_projects_db_v1', 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction('projectPages').objectStore('projectPages').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    assert.equal(records.length, 2);
    db.close();
    await adapter.deleteProject(project.id);
    assert.equal(await adapter.getProject(project.id), null);
  } finally { put.mockRestore(); vi.unstubAllGlobals(); }
});

test('migrates an inline IndexedDB project when saving without losing image data', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const owner = imageAssets.createOwner();
  try {
    const image = 'data:image/png;base64,AQIDBA==';
    const old = syncProjectPages({ id: 'inline', title: 'Inline', selectedLayerId: null, updatedAt: 1,
      layers: [{ id: 'image', name: 'Image', type: 'image', content: image, x: 0, y: 0, width: 50, height: 50, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }],
      pageInfo: { width: 120, height: 80, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('coverflow_projects_db_v1', 2);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('projects', { keyPath: 'id' }).put(writeProject(old));
        request.result.createObjectStore('summaries', { keyPath: 'id' });
        request.result.createObjectStore('previews', { keyPath: ['projectId', 'pageId'] }).createIndex('projectId', 'projectId');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const adapter = new IndexedDBAdapter();
    const opened = await adapter.getProject(old.id);
    assert.equal(opened?.layers[0].content, image);
    const binary = await adapter.getProject(old.id, owner);
    assert.match(binary!.layers[0].content, /^asset-image:/);
    assert.deepEqual(new Uint8Array(await imageAssets.blob(binary!.layers[0].content)!.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
    await adapter.saveProject(opened!);
    assert.equal((await adapter.getProject(old.id))?.layers[0].content, image);
  } finally { imageAssets.release(owner); vi.unstubAllGlobals(); }
});

test('rewrites all pages when another client replaces a project with the same id', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  try {
    const adapter = new IndexedDBAdapter();
    const first = syncProjectPages({ id: 'concurrent', title: 'First', layers: [], selectedLayerId: null, updatedAt: 1,
      pageInfo: { width: 120, height: 80, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });
    const project = { ...first, pages: [first.pages![0], { ...first.pages![0], id: 'second' }] };
    await adapter.saveProject(project);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('coverflow_projects_db_v1', 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['projects', 'projectPages'], 'readwrite');
      tx.objectStore('projects').delete(project.id);
      for (const page of project.pages) tx.objectStore('projectPages').delete([project.id, page.id]);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    db.close();
    put.mockClear();
    await adapter.saveProject(project);
    assert.equal(put.mock.contexts.filter(store => (store as IDBObjectStore).name === 'projectPages').length, 2);
    assert.equal((await adapter.getProject(project.id))?.pages?.length, 2);
  } finally { put.mockRestore(); vi.unstubAllGlobals(); }
});

test('deduplicates binary images, avoids rewriting them on edits and removes unreferenced assets', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  try {
    const adapter = new IndexedDBAdapter();
    const image = 'data:image/png;base64,AQIDBA==';
    const initial = syncProjectPages({ id: 'assets', title: 'Assets', selectedLayerId: null, updatedAt: 1,
      layers: [{ id: 'image', name: 'Image', type: 'image', content: image, x: 0, y: 0, width: 50, height: 50, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }],
      pageInfo: { width: 120, height: 80, background: { type: 'image', value: image, overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });
    const project = { ...initial, pages: [initial.pages![0], { ...initial.pages![0], id: 'second' }] };
    await adapter.saveProject(project);
    assert.equal(put.mock.contexts.filter(store => (store as IDBObjectStore).name === 'projectImages').length, 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('coverflow_projects_db_v1', 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <Value,>(store: string) => new Promise<Value[]>((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const assets = await read<{ blob: Blob }>('projectImages');
    assert.equal(assets.length, 1);
    assert.deepEqual(new Uint8Array(await assets[0].blob.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
    assert.equal(JSON.stringify(await read('projectPages')).includes(image), false);
    put.mockClear();
    const movedLayers = [{ ...project.layers[0], x: 20 }];
    const moved = { ...project, layers: movedLayers, pages: [{ ...project.pages[0], layers: movedLayers }, project.pages[1]], updatedAt: 2 };
    await adapter.saveProject(moved);
    assert.equal(put.mock.contexts.filter(store => (store as IDBObjectStore).name === 'projectImages').length, 0);
    const reopened = await adapter.getProject(project.id);
    assert.equal(reopened?.layers[0].content, image);
    assert.equal(reopened?.pages![1].pageInfo.background.value, image);
    const emptyBackground = { ...reopened!.pageInfo.background, type: 'color' as const, value: '#fff' };
    await adapter.saveProject({ ...reopened!, layers: [], pageInfo: { ...reopened!.pageInfo, background: emptyBackground },
      pages: reopened!.pages!.map(page => ({ ...page, layers: [], pageInfo: { ...page.pageInfo, background: emptyBackground } })), updatedAt: 3 });
    assert.equal((await read('projectImages')).length, 0);
    await adapter.saveProject(project);
    assert.equal((await read('projectImages')).length, 1);
    assert.equal((await adapter.getProject(project.id))?.layers[0].content, image);
    db.close();
  } finally { put.mockRestore(); vi.unstubAllGlobals(); }
});

test('preserves an invalid legacy data URL instead of failing to save the project', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  try {
    const adapter = new IndexedDBAdapter();
    const invalid = 'data:image/png;base64,not-valid!';
    const project = syncProjectPages({ id: 'invalid-image', title: 'Legacy', selectedLayerId: null, updatedAt: 1,
      layers: [{ id: 'image', name: 'Image', type: 'image', content: invalid, x: 0, y: 0, width: 50, height: 50, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }],
      pageInfo: { width: 120, height: 80, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });
    await adapter.saveProject(project);
    assert.equal((await adapter.getProject(project.id))?.layers[0].content, invalid);
  } finally { vi.unstubAllGlobals(); }
});

test('serializes image preparation, later saves and deletes across adapter instances', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const originalFetch = globalThis.fetch;
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetching = new Promise<void>(resolve => { started = resolve; });
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (...args) => { started(); await gate; return originalFetch(...args); });
  try {
    const firstAdapter = new IndexedDBAdapter();
    const secondAdapter = new IndexedDBAdapter();
    const project = syncProjectPages({ id: 'ordered', title: 'First', selectedLayerId: null, updatedAt: 1,
      layers: [{ id: 'image', name: 'Image', type: 'image', content: 'data:image/png;base64,AQIDBA==', x: 0, y: 0, width: 50, height: 50, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }],
      pageInfo: { width: 120, height: 80, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });
    const first = firstAdapter.saveProject(project);
    await fetching;
    const second = secondAdapter.saveProject({ ...project, title: 'Second' });
    const deletion = firstAdapter.deleteProject(project.id);
    release();
    await Promise.all([first, second, deletion]);
    assert.equal(await firstAdapter.getProject(project.id), null);
    await secondAdapter.saveProject({ ...project, title: 'After delete' });
    assert.equal((await firstAdapter.getProject(project.id))?.title, 'After delete');
  } finally { fetch.mockRestore(); vi.unstubAllGlobals(); }
});

test('holds referenced binary images through queued saves and rejects unavailable assets', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const owner = imageAssets.createOwner();
  try {
    const adapter = new IndexedDBAdapter();
    const reference = await imageAssets.add(owner, new NodeBlob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }) as unknown as Blob);
    const project = syncProjectPages({ id: 'binary-queue', title: 'Binary', selectedLayerId: null, updatedAt: 1,
      layers: [{ id: 'image', name: 'Image', type: 'image', content: reference, x: 0, y: 0, width: 50, height: 50, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }],
      pageInfo: { width: 120, height: 80, background: { type: 'image', value: reference, overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });
    const saving = adapter.saveProject(project);
    imageAssets.release(owner);
    await saving;
    const opened = await adapter.getProject(project.id);
    assert.equal(opened?.layers[0].content, 'data:image/png;base64,AQIDBA==');
    assert.equal(opened?.pageInfo.background.value, 'data:image/png;base64,AQIDBA==');
    await assert.rejects(adapter.saveProject(project), /unavailable/);
  } finally { imageAssets.release(owner); vi.unstubAllGlobals(); }
});

test('unpacks stored binary images into owner-scoped references and verifies their hash', async () => {
  const owner = imageAssets.createOwner();
  const blob = new NodeBlob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }) as unknown as Blob;
  const reference = await imageAssets.add(owner, blob);
  const id = reference.slice('asset-image:'.length);
  const project = syncProjectPages({ id: 'binary-read', title: 'Binary', selectedLayerId: null, updatedAt: 1,
    layers: [{ id: 'image', name: 'Image', type: 'image', content: `idb-image:${id}`, x: 0, y: 0, width: 50, height: 50, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }],
    pageInfo: { width: 120, height: 80, background: { type: 'image', value: `idb-image:${id}`, overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });
  try {
    const unpacked = await unpackImagePages(project.pages!, [{ id, blob }], owner);
    assert.equal(unpacked.pages[0].layers[0].content, reference);
    assert.equal(unpacked.pages[0].pageInfo.background.value, reference);
    await assert.rejects(unpackImagePages(project.pages!, [{ id, blob: new NodeBlob(['wrong'], { type: 'image/png' }) as unknown as Blob }], owner), /Invalid stored project image/);
  } finally { imageAssets.release(owner); }
});