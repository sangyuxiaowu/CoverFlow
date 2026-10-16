// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { ProjectState } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { executeTool } from './execute.ts';
import { layerPatch, safeImage } from './validation.ts';

function setup() {
  let current: ProjectState = { id: 'p1', title: 'Test', updatedAt: 0, selectedLayerId: null, layers: [], canvasConfig: { width: 800, height: 600, ratio: '4:3' }, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } };
  const bridge: WorkspaceBridge = { getProject: () => current, getSelection: () => [], commit: async project => { current = project; }, manageProjects: async args => args };
  const signal = new AbortController().signal;
  return { bridge, signal };
}

test('tools read live state between consecutive edits', async () => {
  const { bridge, signal } = setup();
  await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { content: 'Hello', fontSize: 64 } }, bridge, signal);
  const id = bridge.getProject()!.selectedLayerId!;
  await executeTool('edit_layers', { projectId: 'p1', action: 'update', layerIds: [id], properties: { content: 'Updated', opacity: 0.5 } }, bridge, signal);
  assert.equal(bridge.getProject()!.layers[0].content, 'Updated');
  assert.equal(bridge.getProject()!.layers[0].opacity, 0.5);
});

test('stale project IDs, aborts and invalid fields never commit', async () => {
  const { bridge, signal } = setup();
  await assert.rejects(executeTool('add_layer', { projectId: 'old', type: 'text', properties: { content: 'Bad' } }, bridge, signal), /changed/);
  assert.throws(() => layerPatch({ id: 'overwrite' }), /Unsupported/);
  assert.throws(() => layerPatch({ opacity: 2 }), /Invalid/);
  assert.throws(() => layerPatch({ width: Number.NaN }), /Invalid/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', width: 1000 }, bridge, abort.signal));
  assert.equal(bridge.getProject()!.layers.length, 0);
});

test('unsafe image sources are rejected', () => {
  assert.throws(() => safeImage('javascript:alert(1)'));
  assert.throws(() => safeImage('data:image/svg+xml,<svg/>'));
  assert.equal(safeImage('https://example.com/cover.png'), 'https://example.com/cover.png');
});

test('canvas and background edits are validated and committed', async () => {
  const { bridge, signal } = setup();
  await executeTool('update_canvas', { projectId: 'p1', width: 1200, background: { type: 'gradient', value: 'linear-gradient(90deg,#000,#fff)' } }, bridge, signal);
  assert.equal(bridge.getProject()!.canvasConfig.width, 1200);
  assert.equal(bridge.getProject()!.background.type, 'gradient');
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', width: -1 }, bridge, signal), /Invalid/);
});

test('custom CSS backgrounds and HTML decorations use the shared validation', async () => {
  const { bridge, signal } = setup();
  await executeTool('update_canvas', { projectId: 'p1', background: { type: 'css', value: 'background: linear-gradient(45deg, red, blue);' } }, bridge, signal);
  assert.equal(bridge.getProject()!.background.type, 'css');
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', background: { value: 'position:fixed;' } }, bridge, signal));
  const source = '<style>.badge {color:currentColor}</style><div class="badge">Hello</div>';
  await executeTool('add_layer', { projectId: 'p1', type: 'decoration', properties: { content: source } }, bridge, signal);
  const layer = bridge.getProject()!.layers[0];
  assert.equal(layer.decorationFormat, 'html');
  assert.equal(layer.content, source);
  await assert.rejects(executeTool('edit_layers', { projectId: 'p1', action: 'update', layerIds: [layer.id], properties: { content: '<div onclick="alert(1)">Bad</div>' } }, bridge, signal));
  assert.equal(bridge.getProject()!.layers[0].content, source);
  await assert.rejects(executeTool('edit_layers', { projectId: 'p1', action: 'update', layerIds: [layer.id], properties: { decorationFormat: 'css' } }, bridge, signal));
});