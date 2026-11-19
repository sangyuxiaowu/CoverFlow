import 'fake-indexeddb/auto';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { IndexedDBAdapter } from './IndexedDBAdapter.ts';
import { syncProjectPages } from './projectCompatibility.ts';

test('reads an individual project by ID', async () => {
  const adapter = new IndexedDBAdapter();
  const project = syncProjectPages({ id: 'single-project', title: 'Single', layers: [], background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 }, canvasConfig: { width: 100, height: 100, ratio: '1:1' }, selectedLayerId: null, updatedAt: 0 });
  await adapter.saveProject(project);
  assert.equal((await adapter.getProject(project.id))?.id, project.id);
  assert.equal(await adapter.getProject('missing-project'), null);
  await adapter.deleteProject(project.id);
});