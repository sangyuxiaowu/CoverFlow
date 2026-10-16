// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { ProjectState } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { executeTool } from './execute.ts';
import { layerPatch, safeImage } from './validation.ts';
import { TOOL_DEFINITIONS } from './definitions.ts';

function setup() {
  let current: ProjectState = { id: 'p1', title: 'Test', updatedAt: 0, selectedLayerId: null, layers: [], canvasConfig: { width: 800, height: 600, ratio: '4:3' }, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } };
  const bridge: WorkspaceBridge = { getProject: () => current, getSelection: () => [], commit: async project => { current = project; }, manageProjects: async args => args };
  const signal = new AbortController().signal;
  return { bridge, signal };
}

test('tool schemas describe every parameter and nested field with valid required keys', () => {
  const inspect = (schema: Record<string, unknown>, path: string) => {
    assert.equal(typeof schema.description, 'string', `${path} needs a description`);
    assert.ok((schema.description as string).trim(), `${path} has an empty description`);
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false, path);
      const properties = schema.properties as Record<string, Record<string, unknown>>;
      for (const key of schema.required as string[]) assert.ok(Object.hasOwn(properties, key), `${path}.${key} is required but missing`);
      for (const [key, child] of Object.entries(properties)) inspect(child, `${path}.${key}`);
    }
    if (schema.items) inspect(schema.items as Record<string, unknown>, `${path}[]`);
    if (Array.isArray(schema.anyOf)) schema.anyOf.forEach((child, index) => inspect(child, `${path}.anyOf[${index}]`));
  };
  for (const definition of TOOL_DEFINITIONS) inspect(definition.function.parameters, definition.function.name);
  const add = TOOL_DEFINITIONS.find(definition => definition.function.name === 'add_layer')!.function;
  const edit = TOOL_DEFINITIONS.find(definition => definition.function.name === 'edit_layers')!.function;
  const addProperties = (add.parameters.properties as Record<string, Record<string, unknown>>).properties;
  const editProperties = (edit.parameters.properties as Record<string, Record<string, unknown>>).properties;
  assert.deepEqual(addProperties.required, ['content']);
  assert.deepEqual(editProperties.required, []);
  assert.equal(add.description.includes('6000'), false);
  assert.equal(add.description.includes('url()'), false);
  assert.ok(((addProperties.properties as Record<string, Record<string, unknown>>).content.description as string).includes('6000'));
});

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
  const source = '<style>:root{--accent:#38bdf8}.badge{color:var(--accent)}</style><div class="badge">Hello</div>';
  await executeTool('add_layer', { projectId: 'p1', type: 'decoration', properties: { content: source } }, bridge, signal);
  const layer = bridge.getProject()!.layers[0];
  assert.equal(layer.decorationFormat, 'html');
  assert.equal(layer.content, source);
  await assert.rejects(executeTool('edit_layers', { projectId: 'p1', action: 'update', layerIds: [layer.id], properties: { content: '<div onclick="alert(1)">Bad</div>' } }, bridge, signal));
  assert.equal(bridge.getProject()!.layers[0].content, source);
  await assert.rejects(executeTool('edit_layers', { projectId: 'p1', action: 'update', layerIds: [layer.id], properties: { decorationFormat: 'css' } }, bridge, signal));
});

test('decoration color fields fail without committing while variable edits preserve alpha', async () => {
  const { bridge, signal } = setup();
  const content = '--accent: rgba(255,255,255,0.24); background: var(--accent);';
  await assert.rejects(executeTool('add_layer', { projectId: 'p1', type: 'decoration', properties: { content, color: '#ff0000' } }, bridge, signal), /CSS variables/);
  assert.equal(bridge.getProject()!.layers.length, 0);
  await executeTool('add_layer', { projectId: 'p1', type: 'decoration', properties: { content, decorationFormat: 'css' } }, bridge, signal);
  const decorationId = bridge.getProject()!.selectedLayerId!;
  await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { content: 'Title', color: '#ffffff' } }, bridge, signal);
  const textId = bridge.getProject()!.selectedLayerId!;
  await assert.rejects(executeTool('edit_layers', { projectId: 'p1', action: 'update', layerIds: [decorationId, textId], properties: { color: '#ff0000' } }, bridge, signal), /CSS variables/);
  assert.equal(bridge.getProject()!.layers.find(layer => layer.id === textId)!.color, '#ffffff');
  const nextContent = content.replace('rgba(255,255,255,0.24)', 'oklch(0.6 0.1 220 / 0.24)');
  await executeTool('edit_layers', { projectId: 'p1', action: 'update', layerIds: [decorationId], properties: { content: nextContent } }, bridge, signal);
  assert.equal(bridge.getProject()!.layers.find(layer => layer.id === decorationId)!.content, nextContent);
  assert.equal(bridge.getProject()!.layers.find(layer => layer.id === decorationId)!.decorationFormat, 'css');
  await executeTool('edit_layers', { projectId: 'p1', action: 'update', layerIds: [textId], properties: { color: '#22c55e' } }, bridge, signal);
  assert.equal(bridge.getProject()!.layers.find(layer => layer.id === textId)!.color, '#22c55e');
});