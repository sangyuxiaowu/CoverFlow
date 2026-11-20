import { describe, expect, it } from 'vitest';
import { imageAssets, leaseImageAssets } from './imageAssets.ts';
import { embedProjectImageAssets, ProjectImageSession } from './projectImageSession.ts';
import { syncProjectPages } from './projectCompatibility.ts';

const image = 'data:image/png;base64,AQIDBA==';
const createProject = () => syncProjectPages({ id: 'session', title: 'Session', updatedAt: 1, selectedLayerId: null,
  layers: [{ id: 'image', name: 'Image', type: 'image', content: image, x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }],
  pageInfo: { width: 100, height: 100, background: { type: 'image', value: image, overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });

describe('project image session', () => {
  it('deduplicates images and releases them on close', async () => {
    const session = new ProjectImageSession();
    const project = await session.adopt(createProject());
    const reference = project.layers[0].content;
    expect(reference).toMatch(/^asset-image:/);
    expect(project.pageInfo.background.value).toBe(reference);
    expect(new Uint8Array(await imageAssets.blob(reference)!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    session.close();
    expect(imageAssets.blob(reference)).toBeUndefined();
    await expect(session.adopt(project)).rejects.toThrow('closed');
  });

  it('retains shared assets independently across project sessions', async () => {
    const source = new ProjectImageSession();
    const target = new ProjectImageSession();
    try {
      const first = await source.adopt(createProject());
      const second = await target.adopt(first);
      source.close();
      expect(imageAssets.blob(second.layers[0].content)).toBeDefined();
      target.close();
      expect(imageAssets.blob(second.layers[0].content)).toBeUndefined();
    } finally { source.close(); target.close(); }
  });

  it('creates a self-contained snapshot even when the session closes during serialization', async () => {
    const session = new ProjectImageSession();
    const project = await session.adopt(createProject());
    const embedding = embedProjectImageAssets(project);
    session.close();
    const embedded = await embedding;
    expect(embedded.layers[0].content).toBe(image);
    expect(embedded.pageInfo.background.value).toBe(image);
  });

  it('releases expired snapshots while preserving active leases and newly added images', async () => {
    const session = new ProjectImageSession();
    const project = await session.adopt(createProject());
    const reference = project.layers[0].content;
    const other = await session.addImage(await (await fetch('data:image/png;base64,BQYH')).blob());
    const release = leaseImageAssets(project.pages!);
    session.reconcile([project]);
    session.reconcile([]);
    expect(imageAssets.blob(reference)).toBeDefined();
    expect(imageAssets.blob(other)).toBeDefined();
    release();
    expect(imageAssets.blob(reference)).toBeUndefined();
    session.close();
    expect(imageAssets.blob(other)).toBeUndefined();
  });

  it('rejects a binary import when its session closes during hashing', async () => {
    const session = new ProjectImageSession();
    const blob = new Blob(['image'], { type: 'image/png' });
    let finish!: (value: ArrayBuffer) => void;
    blob.arrayBuffer = () => new Promise(resolve => { finish = resolve; });
    const pending = session.addImage(blob);
    session.close();
    finish(new Uint8Array([1, 2, 3]).buffer);
    await expect(pending).rejects.toThrow('released');
    await expect(session.addImage(blob)).rejects.toThrow('closed');
  });
});