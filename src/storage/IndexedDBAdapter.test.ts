import 'fake-indexeddb/auto';
import { test, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import assert from 'node:assert/strict';
import { IndexedDBAdapter } from './IndexedDBAdapter.ts';
import { syncProjectPages, writeProject } from './projectCompatibility.ts';
import { Blob as NodeBlob } from 'node:buffer';

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