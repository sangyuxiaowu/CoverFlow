import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { Layer, ProjectState } from '../../../types.ts';
import { editLayers, updateProjectLayer } from './layerOperations.ts';
import { clampFloatingRect } from './floatingGeometry.ts';

const layer = (id: string, x: number): Layer => ({ id, name: id, type: 'text', content: id, x, y: 20, width: 100, height: 50, rotation: 0, zIndex: x, visible: true, locked: false, opacity: 1 });
const project = (): ProjectState => ({ id: 'project', title: 'Cover', layers: [layer('a', 0), layer('b', 200), layer('c', 500)], background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 }, canvasConfig: { width: 800, height: 600, ratio: '4:3' }, selectedLayerId: 'a', updatedAt: 0 });

test('background removal status survives ordinary edits and resets for a replacement image', () => {
  const original = project();
  original.layers[0] = { ...original.layers[0], type: 'image', backgroundRemoved: true };
  assert.equal(updateProjectLayer(original, 'a', { x: 30 }).layers[0].backgroundRemoved, true);
  assert.equal(updateProjectLayer(original, 'a', { content: 'replacement' }).layers[0].backgroundRemoved, false);
  assert.equal(updateProjectLayer(original, 'a', { content: 'result', backgroundRemoved: true }).layers[0].backgroundRemoved, true);
  assert.equal(editLayers(original, 'duplicate', ['a']).layers.at(-1)!.backgroundRemoved, true);
  assert.equal(JSON.parse(JSON.stringify(original)).layers[0].backgroundRemoved, true);
});

test('group transforms propagate and updating a child recomputes bounds', () => {
  const grouped = editLayers(project(), 'group', ['a', 'b']);
  const groupId = grouped.selectedLayerId!;
  const moved = updateProjectLayer(grouped, groupId, { x: 100, width: 600 });
  assert.equal(moved.layers.find(item => item.id === 'a')!.x, 100);
  assert.equal(moved.layers.find(item => item.id === 'a')!.width, 200);
  assert.equal(moved.layers.find(item => item.id === 'b')!.x, 500);
  const resized = updateProjectLayer(moved, 'a', { x: 50 });
  assert.equal(resized.layers.find(item => item.id === groupId)!.x, 50);
  assert.equal(project().layers[0].x, 0);
});

test('group duplication remaps parent and child IDs', () => {
  const grouped = editLayers(project(), 'group', ['a', 'b']);
  const cloned = editLayers(grouped, 'duplicate', [grouped.selectedLayerId!]);
  const group = cloned.layers.find(item => item.id === cloned.selectedLayerId)!;
  assert.equal(group.children!.length, 2);
  group.children!.forEach(id => assert.equal(cloned.layers.find(item => item.id === id)!.parentId, group.id));
  assert.equal(cloned.layers.length, 7);
});

test('deleting children removes empty groups and stale selection', () => {
  const grouped = editLayers(project(), 'group', ['a', 'b']);
  const deleted = editLayers(grouped, 'delete', ['a', 'b']);
  assert.deepEqual(deleted.layers.map(item => item.id), ['c']);
  assert.equal(deleted.selectedLayerId, null);
});

test('locked layers require explicit unlocking', () => {
  const original = project();
  original.layers[0].locked = true;
  assert.throws(() => editLayers(original, 'delete', ['a']), /Unlock/);
  assert.equal(editLayers(original, 'update', ['a'], { locked: false }).layers[0].locked, false);
});

test('alignment, distribution, ordering and ratio lock preserve geometry', () => {
  const distributed = editLayers(project(), 'distribute', ['a', 'b', 'c'], {}, 'horizontal');
  assert.equal(distributed.layers[1].x, 250);
  assert.equal(editLayers(project(), 'align', ['a'], {}, 'center').layers[0].x, 350);
  assert.equal(editLayers(project(), 'front', ['a']).layers.at(-1)!.id, 'a');
  const original = project();
  original.layers[0].ratioLocked = true;
  assert.equal(updateProjectLayer(original, 'a', { width: 200 }).layers[0].height, 100);
});

test('invalid IDs and unsupported actions do not modify the project', () => {
  const original = project();
  const snapshot = structuredClone(original);
  assert.throws(() => editLayers(original, 'group', ['missing', 'b']), /not found/);
  assert.deepEqual(original, snapshot);
});

test('floating windows stay visible on mobile and after viewport changes', () => {
  const mobile = clampFloatingRect({ x: 1100, y: 800, width: 520, height: 640 }, { width: 390, height: 844 });
  assert.equal(mobile.width, 370);
  assert.equal(mobile.x, 10);
  assert.equal(mobile.y + mobile.height, 834);
  const desktop = clampFloatingRect({ x: -200, y: -100, width: 100, height: 100 }, { width: 1440, height: 900 });
  assert.deepEqual(desktop, { x: 10, y: 10, width: 360, height: 360 });
});

test('invalid saved float geometry and minimized header positions are bounded', () => {
  const fallback = clampFloatingRect({ x: NaN, y: Infinity, width: NaN, height: Infinity }, { width: 800, height: 600 });
  assert.equal(fallback.width, 520);
  assert.equal(fallback.height, 580);
  assert.equal(fallback.x, 10);
  const minimized = clampFloatingRect({ x: 10, y: 1000, width: 520, height: 640 }, { width: 800, height: 900 }, true);
  assert.equal(minimized.y, 826);
});

test('one-step ordering swaps neighbors rather than incrementing sparse z-index values', () => {
  const original = project();
  original.layers.reverse();
  const snapshot = structuredClone(original);
  const forward = editLayers(original, 'forward', ['a']);
  assert.deepEqual(forward.layers.map(item => item.id), ['b', 'a', 'c']);
  assert.deepEqual(forward.layers.map(item => item.zIndex), [1, 2, 3]);
  const backward = editLayers(original, 'backward', ['c']);
  assert.deepEqual(backward.layers.map(item => item.id), ['a', 'c', 'b']);
  assert.deepEqual(original, snapshot);
  for (const [action, target] of [['forward', 'c'], ['backward', 'a']] as const) {
    assert.deepEqual(editLayers(original, action, [target]).layers.map(item => item.id), ['a', 'b', 'c']);
  }
});

test('one-step multi-selection preserves relative order and stops at the boundaries', () => {
  const original = project();
  original.layers = ['a', 'b', 'c', 'd', 'e'].map((id, index) => layer(id, index * 100));
  const cases = [
    ['forward', ['b', 'a'], ['c', 'a', 'b', 'd', 'e']],
    ['backward', ['e', 'd'], ['a', 'b', 'd', 'e', 'c']],
    ['forward', ['a', 'c'], ['b', 'a', 'd', 'c', 'e']],
    ['backward', ['b', 'd'], ['b', 'a', 'd', 'c', 'e']],
    ['forward', ['d', 'e'], ['a', 'b', 'c', 'd', 'e']],
    ['backward', ['a', 'b'], ['a', 'b', 'c', 'd', 'e']],
    ['forward', ['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'e']]
  ] as const;
  for (const [action, selected, expected] of cases) {
    const next = editLayers(original, action, [...selected]);
    assert.deepEqual(next.layers.map(item => item.id), expected);
    assert.equal(next.selectedLayerId, original.selectedLayerId);
  }
});

test('one-step ordering includes group children and enforces locks', () => {
  const original = project();
  const group: Layer = { ...layer('group', 250), type: 'group', content: '', children: ['a', 'b'] };
  original.layers = [original.layers[0], original.layers[1], group, original.layers[2]];
  original.layers[0].parentId = group.id;
  original.layers[1].parentId = group.id;
  const forward = editLayers(original, 'forward', [group.id, 'a']);
  assert.deepEqual(forward.layers.map(item => item.id), ['c', 'a', 'b', 'group']);
  assert.deepEqual(forward.layers.find(item => item.id === group.id)!.children, ['a', 'b']);
  assert.deepEqual(editLayers(forward, 'backward', [group.id]).layers.map(item => item.id), ['a', 'b', 'group', 'c']);
  original.layers[0].locked = true;
  for (const action of ['forward', 'backward'] as const) {
    assert.throws(() => editLayers(original, action, [group.id]), /Unlock/);
    assert.throws(() => editLayers(original, action, ['a']), /Unlock/);
    assert.throws(() => editLayers(original, action, ['missing']), /not found/);
  }
});

test('image provenance survives transforms and copies but clears when the image is replaced', () => {
  const original = project();
  Object.assign(original.layers[0], { type: 'image', imageSource: 'agnes-image-2.5-flash', imageDescription: 'A glowing city' });
  const moved = updateProjectLayer(original, 'a', { x: 30 });
  assert.equal(moved.layers[0].imageDescription, 'A glowing city');
  const copied = editLayers(moved, 'duplicate', ['a']);
  assert.equal(copied.layers.find(item => item.id === copied.selectedLayerId)!.imageSource, 'agnes-image-2.5-flash');
  assert.equal(copied.layers.find(item => item.id === copied.selectedLayerId)!.imageDescription, 'A glowing city');
  const replaced = updateProjectLayer(moved, 'a', { content: 'https://example.com/new.png' });
  assert.equal(replaced.layers[0].imageSource, 'unknown');
  assert.equal(replaced.layers[0].imageDescription, '');
  const described = updateProjectLayer(moved, 'a', { content: 'https://example.com/new.png', imageSource: 'upload', imageDescription: 'My photo' });
  assert.equal(described.layers[0].imageSource, 'upload');
  assert.equal(described.layers[0].imageDescription, 'My photo');
});