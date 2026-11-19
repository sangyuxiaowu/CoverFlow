import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { Layer, ProjectState } from '../types.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { LayerClipboard } from './layerClipboard.ts';

const layer = (id: string, changes: Partial<Layer> = {}): Layer => ({ id, name: id, type: 'text', content: 'content', x: 1, y: 2, width: 30, height: 40, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1, ...changes });
const project = (id: string, layers: Layer[]): ProjectState => syncProjectPages({ id, title: id, layers, pageInfo: { ...({ width: 100, height: 100 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } }, selectedLayerId: null, updatedAt: 0 });

test('clipboard resolves live group contents, deduplicates and remaps hierarchy in stacking order', async () => {
  const clipboard = new LayerClipboard();
  const source = project('source', [layer('child', { parentId: 'group', zIndex: 10, content: 'data:image/png;base64,abc', type: 'image' }), layer('group', { type: 'group', children: ['child'], zIndex: 20, locked: true })]);
  const target = project('target', [layer('existing', { zIndex: 50 })]);
  const resolve = async (id: string) => { if (id === source.id) return source; throw new Error('missing'); };
  const child = { projectId: source.id, pageId: source.activePageId!, layerId: 'child', info: 'image' };
  const group = { ...child, layerId: 'group', info: 'group' };
  assert.deepEqual(await clipboard.copy([child, group, child], resolve), { added: 2, count: 2 });
  assert.equal((await clipboard.check(resolve))[1].childCount, 1);
  source.layers[0].content = 'changed';
  const result = await clipboard.paste(target, target.activePageId!, resolve);
  const [copiedChild, copiedGroup] = result.project.layers.slice(1);
  assert.equal(copiedChild.content, 'changed');
  assert.equal(copiedChild.parentId, copiedGroup.id);
  assert.deepEqual(copiedGroup.children, [copiedChild.id]);
  assert.deepEqual([copiedChild.zIndex, copiedGroup.zIndex], [51, 52]);
  assert.equal(copiedGroup.locked, true);
  assert.notEqual(copiedChild.id, 'child');
  clipboard.remove(group);
  const standalone = await clipboard.paste(target, target.activePageId!, resolve);
  assert.equal(standalone.project.layers.at(-1)!.parentId, undefined);
  clipboard.clear();
  assert.equal(clipboard.getSnapshot().length, 0);
});

test('invalid sources and invalid info do not change the clipboard or target', async () => {
  const clipboard = new LayerClipboard();
  const source = project('source', [layer('one')]);
  const resolve = async () => source;
  const entry = { projectId: source.id, pageId: source.activePageId!, layerId: 'one' };
  await assert.rejects(clipboard.copy([entry, { ...entry, layerId: 'missing' }], resolve));
  await assert.rejects(clipboard.copy([{ ...entry, info: 'data:image/png;base64,abc' }], resolve));
  assert.equal(clipboard.getSnapshot().length, 0);
  await clipboard.copy([entry], resolve);
  source.layers.length = 0;
  assert.equal((await clipboard.check(resolve))[0].available, false);
  const target = project('target', []);
  await assert.rejects(clipboard.paste(target, target.activePageId!, resolve));
  assert.equal(target.layers.length, 0);
});

test('a concurrent clear prevents an in-flight copy from restoring old entries', async () => {
  const clipboard = new LayerClipboard();
  const source = project('source', [layer('one'), layer('two')]);
  const entry = { projectId: source.id, pageId: source.activePageId!, layerId: 'one' };
  await clipboard.copy([entry], async () => source);
  let release!: (value: ProjectState) => void;
  const pending = clipboard.copy([{ ...entry, layerId: 'two' }], () => new Promise(resolve => { release = resolve; }));
  clipboard.clear();
  release(source);
  await assert.rejects(pending, /Clipboard changed/);
  assert.equal(clipboard.getSnapshot().length, 0);
});

test('clearing an empty clipboard also cancels an in-flight first copy', async () => {
  const clipboard = new LayerClipboard();
  const source = project('source', [layer('one')]);
  let release!: (value: ProjectState) => void;
  const pending = clipboard.copy([{ projectId: source.id, pageId: source.activePageId!, layerId: 'one' }], () => new Promise(resolve => { release = resolve; }));
  clipboard.clear();
  release(source);
  await assert.rejects(pending, /Clipboard changed/);
  assert.equal(clipboard.getSnapshot().length, 0);
});

test('source pages follow first appearance and each page preserves its stacking order', async () => {
  const clipboard = new LayerClipboard();
  const first = project('first', [layer('top', { zIndex: 8 }), layer('bottom', { zIndex: 2 })]);
  const second = project('second', [layer('middle', { zIndex: 4 })]);
  const target = project('target', []);
  const resolve = async (id: string) => id === first.id ? first : second;
  await clipboard.copy([
    { projectId: first.id, pageId: first.activePageId!, layerId: 'top' },
    { projectId: second.id, pageId: second.activePageId!, layerId: 'middle' },
    { projectId: first.id, pageId: first.activePageId!, layerId: 'bottom' }
  ], resolve);
  const result = await clipboard.paste(target, target.activePageId!, resolve);
  assert.deepEqual(result.project.layers.map(item => item.name), ['bottom', 'top', 'middle']);
});