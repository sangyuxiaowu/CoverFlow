import 'fake-indexeddb/auto';
import { test, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import assert from 'node:assert/strict';
import { IndexedDBAdapter } from './IndexedDBAdapter.ts';
import { LocalFileAdapter } from './LocalFileAdapter.ts';
import { CloudAdapter } from './CloudAdapter.ts';
import { syncProjectPages } from './projectCompatibility.ts';
import { decodeProjectArchive } from './projectArchive.ts';
import type { ProjectState } from '../types.ts';
import { imageAssets } from './imageAssets.ts';
import { appendProjectVersion, mergeProjectVersionChanges, removeProjectVersion } from './versionStore.ts';

const sampleProject = (id = 'ver-proj'): ProjectState => syncProjectPages({
  id,
  title: 'Cover V1',
  selectedLayerId: null,
  updatedAt: 100,
  layers: [{
    id: 'l1',
    name: 'Title',
    type: 'text',
    content: 'Version 1',
    x: 10,
    y: 10,
    width: 100,
    height: 40,
    rotation: 0,
    zIndex: 1,
    visible: true,
    locked: false,
    opacity: 1
  }],
  pageInfo: {
    width: 1200,
    height: 630,
    background: { type: 'color', value: '#0f172a', overlayType: 'none', overlayColor: '#ffffff', overlayOpacity: 0, overlayScale: 20 }
  }
});

test('version changes preserve edits and versions added while saving', () => {
  const original = appendProjectVersion(sampleProject(), 'Old').project;
  const added = appendProjectVersion(original, 'New').project;
  const concurrent = appendProjectVersion({ ...original, title: 'Edited during save' }, 'Concurrent').project;
  const merged = mergeProjectVersionChanges(concurrent, original, added);
  assert.equal(merged.title, 'Edited during save');
  assert.deepEqual(new Set(merged.versions?.map(version => version.info)), new Set(['Old', 'New', 'Concurrent']));

  const removed = removeProjectVersion(original, original.versions![0].id);
  const afterDelete = mergeProjectVersionChanges(concurrent, original, removed);
  assert.equal(afterDelete.title, 'Edited during save');
  assert.deepEqual(afterDelete.versions?.map(version => version.info), ['Concurrent']);
});

test('IndexedDBAdapter saves, lists, reads, and deletes versions with image deduplication and project cleanup', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const owner = imageAssets.createOwner();
  try {
    const adapter = new IndexedDBAdapter();
    const image = 'data:image/png;base64,AQIDBA==';
    const base = sampleProject('idb-versions');
    const withImage: ProjectState = {
      ...base,
      layers: [
        ...base.layers,
        { id: 'img1', name: 'Img', type: 'image', content: image, x: 0, y: 0, width: 50, height: 50, rotation: 0, zIndex: 2, visible: true, locked: false, opacity: 1 }
      ],
      pages: [{
        ...base.pages![0],
        layers: [
          ...base.layers,
          { id: 'img1', name: 'Img', type: 'image', content: image, x: 0, y: 0, width: 50, height: 50, rotation: 0, zIndex: 2, visible: true, locked: false, opacity: 1 }
        ]
      }]
    };
    await adapter.saveProject(withImage);

    await assert.rejects(adapter.saveProjectVersion(withImage, '   '), /required/);

    const v1 = await adapter.saveProjectVersion(withImage, 'First milestone');
    await new Promise(resolve => setTimeout(resolve, 5));
    const edited = syncProjectPages({ ...withImage, title: 'Cover V2', layers: base.layers, pages: [{ ...base.pages![0], layers: base.layers }] });
    const v2 = await adapter.saveProjectVersion(edited, 'Removed image');

    const list = await adapter.listProjectVersions(withImage.id);
    assert.deepEqual(list.map(v => v.info), ['Removed image', 'First milestone']);
    assert.equal(v1.width, 1200);
    assert.equal(v2.title, 'Cover V2');

    const loadedV1 = await adapter.getProjectVersion(withImage.id, v1.id, owner);
    assert.ok(loadedV1);
    assert.equal(loadedV1.layers.length, 2);
    assert.match(loadedV1.layers[1].content, /^asset-image:/);

    await adapter.deleteProjectVersion(withImage.id, v1.id);
    assert.equal(await adapter.getProjectVersion(withImage.id, v1.id), null);
    assert.deepEqual((await adapter.listProjectVersions(withImage.id)).map(v => v.id), [v2.id]);

    // Deleting project removes remaining versions too
    await adapter.deleteProject(withImage.id);
    assert.deepEqual(await adapter.listProjectVersions(withImage.id), []);
  } finally {
    imageAssets.release(owner);
    vi.unstubAllGlobals();
  }
});

test('LocalFileAdapter stores, lists, loads, and deletes embedded versions inside .cfjx without creating a versions directory', async () => {
  const dirs = new Map<string, Map<string, { bytes: Uint8Array; modified: number }>>();
  const ensureDirMap = (path: string) => {
    let map = dirs.get(path);
    if (!map) {
      map = new Map();
      dirs.set(path, map);
    }
    return map;
  };

  const makeDirHandle = (path: string): FileSystemDirectoryHandle => {
    const files = ensureDirMap(path);
    return {
      kind: 'directory',
      name: path.split('/').pop() || 'root',
      getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
        const nextPath = path ? `${path}/${name}` : name;
        if (!dirs.has(nextPath) && !options?.create) {
          throw new DOMException('Missing', 'NotFoundError');
        }
        return makeDirHandle(nextPath);
      },
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        if (!files.has(name) && !options?.create) {
          throw new DOMException('Missing', 'NotFoundError');
        }
        return {
          kind: 'file',
          name,
          getFile: async () => {
            const item = files.get(name);
            if (!item) throw new DOMException('Missing', 'NotFoundError');
            return {
              size: item.bytes.length,
              lastModified: item.modified,
              text: async () => new TextDecoder().decode(item.bytes),
              arrayBuffer: async () => Uint8Array.from(item.bytes).buffer
            };
          },
          createWritable: async () => {
            let buffer = new Uint8Array();
            return {
              write: async (content: string | Blob) => {
                buffer = typeof content === 'string'
                  ? new TextEncoder().encode(content)
                  : new Uint8Array(await content.arrayBuffer());
              },
              close: async () => {
                files.set(name, { bytes: buffer, modified: Date.now() });
              },
              abort: async () => {}
            };
          }
        } as unknown as FileSystemFileHandle;
      },
      removeEntry: async (name: string, options?: { recursive?: boolean }) => {
        const subPath = path ? `${path}/${name}` : name;
        if (options?.recursive && dirs.has(subPath)) {
          for (const key of [...dirs.keys()]) {
            if (key === subPath || key.startsWith(`${subPath}/`)) dirs.delete(key);
          }
          return;
        }
        if (!files.delete(name)) throw new DOMException('Missing', 'NotFoundError');
      },
      values: async function* () {}
    } as unknown as FileSystemDirectoryHandle;
  };

  const adapter = new LocalFileAdapter();
  vi.spyOn(adapter, 'ensureReady').mockResolvedValue(true);
  Object.assign(adapter, { rootHandle: makeDirHandle('') });

  const project = sampleProject('local-ver');
  await adapter.saveProject(project);
  const v1 = await adapter.saveProjectVersion(project, 'Initial local snapshot');
  const v2 = await adapter.saveProjectVersion({ ...project, title: 'Updated local' }, 'Second local snapshot');

  const listed = await adapter.listProjectVersions(project.id);
  assert.equal(listed.length, 2);
  assert.ok(listed.some(v => v.id === v1.id && v.info === 'Initial local snapshot'));
  assert.ok(listed.some(v => v.id === v2.id && v.title === 'Updated local'));

  assert.equal(dirs.has('versions'), false);
  assert.equal(dirs.get('')?.has('versions.json'), false);
  const archiveFile = [...(dirs.get('data')?.entries() ?? [])].find(([name]) => name.endsWith('.cfjx'))?.[1];
  assert.ok(archiveFile);
  const decoded = await decodeProjectArchive(archiveFile.bytes);
  assert.equal(decoded.versions?.length, 2);

  const loaded = await adapter.getProjectVersion(project.id, v1.id);
  assert.equal(loaded?.title, 'Cover V1');

  await adapter.deleteProjectVersion(project.id, v1.id);
  assert.equal(await adapter.getProjectVersion(project.id, v1.id), null);
  assert.deepEqual((await adapter.listProjectVersions(project.id)).map(v => v.id), [v2.id]);

  await adapter.deleteProject(project.id);
  assert.deepEqual(await adapter.listProjectVersions(project.id), []);
});

test('CloudAdapter saves, lists, loads, deletes versions, and cleans up on project deletion', async () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); }
  });
  try {
    const adapter = new CloudAdapter();
    const project = sampleProject('cloud-ver');
    await adapter.saveProject(project);
    const v1 = await adapter.saveProjectVersion(project, 'Cloud v1');
    const v2 = await adapter.saveProjectVersion({ ...project, title: 'Cloud v2' }, 'Cloud v2');

    const listed = await adapter.listProjectVersions(project.id);
    assert.equal(listed.length, 2);
    assert.equal((await adapter.getProjectVersion(project.id, v1.id))?.title, 'Cover V1');

    await adapter.deleteProjectVersion(project.id, v1.id);
    assert.deepEqual((await adapter.listProjectVersions(project.id)).map(v => v.id), [v2.id]);

    await adapter.deleteProject(project.id);
    assert.deepEqual(await adapter.listProjectVersions(project.id), []);
  } finally {
    vi.unstubAllGlobals();
  }
});
