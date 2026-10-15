import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Layer, ProjectState } from '../../../types.ts';
import { editLayers, updateProjectLayer } from './layerOperations.ts';
import { clampFloatingRect } from './floatingGeometry.ts';

const layer = (id: string, x: number): Layer => ({ id, name: id, type: 'text', content: id, x, y: 20, width: 100, height: 50, rotation: 0, zIndex: x, visible: true, locked: false, opacity: 1 });
const project = (): ProjectState => ({ id: 'project', title: 'Cover', layers: [layer('a', 0), layer('b', 200), layer('c', 500)], background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 }, canvasConfig: { width: 800, height: 600, ratio: '4:3' }, selectedLayerId: 'a', updatedAt: 0 });

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
  assert.deepEqual(desktop, { x: 10, y: 10, width: 340, height: 360 });
});

test('invalid saved float geometry and minimized header positions are bounded', () => {
  const fallback = clampFloatingRect({ x: NaN, y: Infinity, width: NaN, height: Infinity }, { width: 800, height: 600 });
  assert.equal(fallback.width, 520);
  assert.equal(fallback.height, 580);
  assert.equal(fallback.x, 10);
  const minimized = clampFloatingRect({ x: 10, y: 1000, width: 520, height: 640 }, { width: 800, height: 900 }, true);
  assert.equal(minimized.y, 826);
});