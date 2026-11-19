import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { ProjectState } from '../../../types.ts';
import { syncProjectPages } from '../../../storage/projectCompatibility.ts';
import { LayerClipboard } from '../../../utils/layerClipboard.ts';
import { executeTool } from './execute.ts';
import { TOOL_DEFINITIONS } from './definitions.ts';

test('clipboard tool shares references and commits a paste to an inactive page', async () => {
  let project: ProjectState = syncProjectPages({ id: 'p', title: 'Project', layers: [{ id: 'a', name: 'Title', type: 'text', content: 'hello', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }], pageInfo: { ...({ width: 100, height: 100 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } }, selectedLayerId: null, updatedAt: 0 });
  const pageId = project.activePageId!;
  project = { ...project, pages: [...project.pages!, { ...project.pages![0], id: 'other', layers: [] }] };
  const clipboard = new LayerClipboard();
  const bridge = { clipboard, getProject: () => project, getSelection: () => [], commit: async (next: ProjectState) => { project = next; }, manageProjects: async () => ({}) };
  const signal = new AbortController().signal;
  await executeTool('clipboard', { action: 'copy', layers: [{ projectId: 'p', pageId, layerId: 'a', info: 'note' }] }, bridge, signal);
  const checked = await executeTool('clipboard', { action: 'check' }, bridge, signal) as { layers: { name: string; info: string }[] };
  assert.equal(checked.layers[0].name, 'Title');
  assert.equal(checked.layers[0].info, 'note');
  await assert.rejects(executeTool('clipboard', { action: 'paste', projectId: 'other', pageId: 'other' }, bridge, signal));
  await executeTool('clipboard', { action: 'paste', projectId: 'p', pageId: 'other' }, bridge, signal);
  assert.equal(project.layers.length, 1);
  assert.equal(project.pages!.find(page => page.id === 'other')!.layers[0].content, 'hello');
  await executeTool('clipboard', { action: 'clear' }, bridge, signal);
  assert.equal(clipboard.getSnapshot().length, 0);
});

test('clipboard schema makes source and target context optional', () => {
  const parameters = TOOL_DEFINITIONS.find(item => item.function.name === 'clipboard')!.function.parameters as {
    required: string[];
    properties: { layers: { items: { required: string[] } } };
  };
  assert.deepEqual(parameters.required, ['action']);
  assert.deepEqual(parameters.properties.layers.items.required, ['layerId']);
});

test('clipboard defaults omitted project and page IDs to the current context', async () => {
  let project: ProjectState | null = syncProjectPages({ id: 'p', title: 'Project', layers: [{ id: 'a', name: 'Title', type: 'text', content: 'hello', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }], pageInfo: { ...({ width: 100, height: 100 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } }, selectedLayerId: null, updatedAt: 0 });
  const pageId = project.activePageId!;
  const source = project;
  const clipboard = new LayerClipboard();
  const bridge = { clipboard, getProject: () => project, getProjectById: async () => source, getSelection: () => [], commit: async (next: ProjectState) => { project = next; }, manageProjects: async () => ({}) };
  const signal = new AbortController().signal;
  await executeTool('clipboard', { action: 'copy', layers: [{ layerId: 'a', info: 'note' }] }, bridge, signal);
  assert.deepEqual(clipboard.getSnapshot(), [{ projectId: 'p', pageId, layerId: 'a', info: 'note' }]);
  const result = await executeTool('clipboard', { action: 'paste' }, bridge, signal) as { projectId: string; pageId: string; createdLayerIds: string[] };
  assert.equal(result.projectId, 'p');
  assert.equal(result.pageId, pageId);
  assert.equal(result.createdLayerIds.length, 1);
  assert.equal(project!.layers.length, 2);
  await executeTool('clipboard', { action: 'clear' }, bridge, signal);
  await executeTool('clipboard', { action: 'copy', layers: [{ projectId: 'p', layerId: 'a' }, { pageId, layerId: 'a' }] }, bridge, signal);
  assert.equal(clipboard.getSnapshot().length, 1);
  await assert.rejects(executeTool('clipboard', { action: 'copy', layers: [{ layerId: 'a', extra: true }] }, bridge, signal), /Invalid clipboard entry/);
  await assert.rejects(executeTool('clipboard', { action: 'copy', layers: [{ layerId: 'a', pageId: null }] }, bridge, signal), /pageId/);
  await assert.rejects(executeTool('clipboard', { action: 'paste', projectId: null }, bridge, signal), /projectId/);
  const explicitPageResult = await executeTool('clipboard', { action: 'paste', pageId }, bridge, signal) as { pageId: string };
  assert.equal(explicitPageResult.pageId, pageId);
  const explicitProjectResult = await executeTool('clipboard', { action: 'paste', projectId: 'p' }, bridge, signal) as { pageId: string };
  assert.equal(explicitProjectResult.pageId, pageId);
  project = null;
  await assert.rejects(executeTool('clipboard', { action: 'copy', layers: [{ layerId: 'a' }] }, bridge, signal), /projectId/);
  await assert.rejects(executeTool('clipboard', { action: 'copy', layers: [{ projectId: 'p', layerId: 'a' }] }, bridge, signal), /pageId/);
  await executeTool('clipboard', { action: 'copy', layers: [{ projectId: 'p', pageId, layerId: 'a' }] }, bridge, signal);
  await assert.rejects(executeTool('clipboard', { action: 'paste' }, bridge, signal), /Open the target project/);
});