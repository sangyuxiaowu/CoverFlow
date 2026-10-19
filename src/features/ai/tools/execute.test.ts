// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { ProjectState } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { executeTool } from './execute.ts';
import { layerPatch, safeImage } from './validation.ts';
import { TOOL_DEFINITIONS } from './definitions.ts';
import { PRESET_RATIOS } from '../../../constants.ts';
import { ALIGN_MODES, DISTRIBUTE_MODES, EDIT_LAYER_RULES, PROJECT_RULES, fieldUsage, parseEditLayersRequest, parseManageProjectsRequest } from './requests.ts';

function setup(layers: ProjectState['layers'] = [], selectedLayerIds: string[] = []) {
  let current: ProjectState = { id: 'p1', title: 'Test', updatedAt: 0, selectedLayerId: null, layers, canvasConfig: { width: 800, height: 600, ratio: '4:3' }, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } };
  const bridge: WorkspaceBridge = { getProject: () => current, getSelection: () => selectedLayerIds, commit: async project => { current = project; }, manageProjects: async args => args };
  const signal = new AbortController().signal;
  return { bridge, signal };
}

test('background removal is a static tool with model selection guidance and no readiness filtering', () => {
  const definitions = TOOL_DEFINITIONS.filter(item => item.function.name === 'remove_background');
  assert.equal(definitions.length, 1);
  const parameters = definitions[0].function.parameters;
  const properties = parameters.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(parameters.required, ['projectId', 'layerId']);
  assert.deepEqual(properties.modelId.enum, ['u2netp', 'birefnet']);
  assert.match(String(properties.modelId.description), /轻量|快速/);
  assert.match(String(properties.modelId.description), /毛发|复杂边缘/);
  assert.equal('backgroundRemoved' in (properties || {}), false);
});

test('dedicated tool provides cover size recommendations with and without an open project', async () => {
  const { bridge, signal } = setup();
  for (const getProject of [bridge.getProject, () => null]) {
    const recommendations = await executeTool('get_cover_size_recommendations', {}, { ...bridge, getProject }, signal) as {
      note: string; presets: typeof PRESET_RATIOS;
    };
    assert.deepEqual(recommendations.presets, PRESET_RATIOS);
    assert.match(recommendations.note, /不是平台强制规格/);
    assert.ok(recommendations.presets.every(preset => preset.description.length > 0));
    const context = await executeTool('get_context', {}, { ...bridge, getProject }, signal) as Record<string, unknown>;
    assert.equal('coverSizeRecommendations' in context, false);
    assert.equal('presets' in context, false);
    if (context.projectId === null) assert.match(String(context.message), /get_cover_size_recommendations/);
  }
  const definition = TOOL_DEFINITIONS.find(item => item.function.name === 'get_cover_size_recommendations');
  assert.ok(definition);
  assert.deepEqual(definition.function.parameters.required, []);
});

test('selected image layers expose metadata and only request a preview for vision models', async () => {
  const imageLayer: ProjectState['layers'][number] = { id: 'image-1', name: 'Photo', type: 'image', content: 'data:image/png;base64,abc', x: 10, y: 20, width: 300, height: 200, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 };
  const { bridge, signal } = setup([imageLayer], ['image-1']);
  let previewRequests = 0;
  const preview = new Blob(['webp'], { type: 'image/webp' });
  bridge.getLayerPreview = async () => { previewRequests++; return preview; };

  const textOnly = await executeTool('get_selected_layers', {}, bridge, signal) as { layers: Record<string, any>[]; images: unknown[] };
  assert.equal(previewRequests, 0);
  assert.equal(textOnly.layers[0].content, undefined);
  assert.deepEqual(textOnly.layers[0].imageInfo, { sourceType: 'embedded', sourceLength: imageLayer.content.length, previewStatus: 'not_requested' });
  assert.deepEqual(textOnly.images, []);

  const visual = await executeTool('get_selected_layers', {}, bridge, signal, true) as { layers: Record<string, any>[]; images: { blob: Blob }[] };
  assert.equal(previewRequests, 1);
  assert.equal(visual.layers[0].imageInfo.previewStatus, 'available');
  assert.equal(visual.images[0].blob, preview);
});

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
  const canvas = TOOL_DEFINITIONS.find(definition => definition.function.name === 'update_canvas')!.function;
  const addProperties = (add.parameters.properties as Record<string, Record<string, unknown>>).properties;
  const editProperties = (edit.parameters.properties as Record<string, Record<string, unknown>>).properties;
  const editLayerProperties = editProperties.properties as Record<string, Record<string, unknown>>;
  const imageProperties = editLayerProperties.image.properties as Record<string, Record<string, unknown>>;
  const textProperties = editLayerProperties.text.properties as Record<string, Record<string, unknown>>;
  const canvasProperties = canvas.parameters.properties as Record<string, Record<string, unknown>>;
  const backgroundProperties = (canvasProperties.background.properties as Record<string, Record<string, unknown>>);
  const overlayProperties = backgroundProperties.overlay.properties as Record<string, unknown>;
  assert.deepEqual(addProperties.required, ['content']);
  assert.deepEqual(editProperties.required, []);
  assert.deepEqual(Object.keys(overlayProperties), ['type', 'color', 'opacity', 'scale']);
  assert.deepEqual(Object.keys(editLayerProperties).filter(key => ['image', 'text'].includes(key)), ['image', 'text']);
  assert.equal(editLayerProperties.image.minProperties, 1);
  assert.equal(editLayerProperties.text.minProperties, 1);
  assert.equal(imageProperties.imageFilters.minProperties, 1);
  assert.equal(imageProperties.imageCrop.minProperties, 1);
  assert.ok((editLayerProperties.image.description as string).includes('仅 image 图层'));
  assert.ok((editLayerProperties.text.description as string).includes('仅 text 图层'));
  assert.ok(!Object.hasOwn(editLayerProperties, 'fontSize'));
  assert.ok(!Object.hasOwn(editLayerProperties, 'flipX'));
  assert.ok(Object.hasOwn(textProperties, 'fontSize'));
  assert.equal(add.description.includes('6000'), false);
  assert.equal(add.description.includes('url()'), false);
  assert.ok(((addProperties.properties as Record<string, Record<string, unknown>>).content.description as string).includes('6000'));
});

test('tools read live state between consecutive edits', async () => {
  const { bridge, signal } = setup();
  await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { content: 'Hello', text: { fontSize: 64 } } }, bridge, signal);
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
  assert.throws(() => safeImage('javascript:alert(1)'), /Images require an HTTP\(S\) URL or bitmap data URL\./);
  assert.throws(() => safeImage('not a URL'), /Images require an HTTP\(S\) URL or bitmap data URL\./);
  assert.throws(() => safeImage('data:image/svg+xml,<svg/>'));
  assert.equal(safeImage('https://example.com/cover.png'), 'https://example.com/cover.png');
});

test('canvas and background edits are validated and committed', async () => {
  const { bridge, signal } = setup();
  await executeTool('update_canvas', { projectId: 'p1', width: 1200, background: { type: 'gradient', value: 'linear-gradient(90deg,#000,#fff)', overlay: { type: 'dots', color: '#fff', opacity: 0.3, scale: 24 } } }, bridge, signal);
  assert.equal(bridge.getProject()!.canvasConfig.width, 1200);
  assert.equal(bridge.getProject()!.background.type, 'gradient');
  assert.equal(bridge.getProject()!.background.overlayType, 'dots');
  assert.equal(bridge.getProject()!.background.overlayScale, 24);
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', background: { overlay: { scale: 19 } } }, bridge, signal), /Invalid/);
  assert.equal(bridge.getProject()!.background.overlayScale, 24);
  await executeTool('update_canvas', { projectId: 'p1', background: { overlay: { scale: 20 } } }, bridge, signal);
  assert.equal(bridge.getProject()!.background.overlayScale, 20);
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', width: -1 }, bridge, signal), /Invalid/);
});

test('custom CSS backgrounds and HTML decorations use the shared validation', async () => {
  const { bridge, signal } = setup();
  await executeTool('update_canvas', { projectId: 'p1', background: { type: 'css', value: 'background: linear-gradient(45deg, red, blue);' } }, bridge, signal);
  assert.equal(bridge.getProject()!.background.type, 'css');
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', background: { overlay: { type: 'dots' } } }, bridge, signal), /Overlay textures are not supported/);
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', background: { type: 'css', value: 'background: red;', overlay: { scale: 24 } } }, bridge, signal), /Overlay textures are not supported/);
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', background: { overlayType: 'dots' } }, bridge, signal), /Unsupported background field/);
  assert.equal(bridge.getProject()!.background.overlayType, 'none');
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

test('edit actions reject missing, empty and unrelated arguments without committing', async () => {
  const { bridge, signal } = setup();
  await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { content: 'Keep' } }, bridge, signal);
  const before = structuredClone(bridge.getProject());
  const layerIds = [before!.layers[0].id];
  const invalid = [
    { action: 'update' }, { action: 'update', properties: {} },
    { action: 'update', properties: { opacity: 0.5 }, mode: 'left' },
    { action: 'delete', properties: { opacity: 0.5 } },
    { action: 'duplicate', name: 'Ignored' }, { action: 'front', mode: 'left' },
    { action: 'back', extra: true }, { action: 'ungroup', properties: {} },
    { action: 'group', properties: { name: 'Old contract' } },
    { action: 'align' }, { action: 'align', mode: 'horizontal' },
    { action: 'distribute' }, { action: 'distribute', mode: 'left' }
  ];
  let commits = 0;
  const guarded = { ...bridge, commit: async () => { commits++; } };
  for (const args of invalid) {
    await assert.rejects(executeTool('edit_layers', { projectId: 'p1', layerIds, ...args }, guarded, signal), Error, JSON.stringify(args));
    assert.deepEqual(bridge.getProject(), before);
  }
  assert.equal(commits, 0);
});

test('group uses a top-level name and alignment accepts its own modes', async () => {
  const { bridge, signal } = setup();
  for (const content of ['First', 'Second']) await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { content } }, bridge, signal);
  const layerIds = bridge.getProject()!.layers.map(layer => layer.id);
  await executeTool('edit_layers', { projectId: 'p1', action: 'group', layerIds, name: 'Named group' }, bridge, signal);
  const group = bridge.getProject()!.layers.find(layer => layer.type === 'group')!;
  assert.equal(group.name, 'Named group');
  await executeTool('edit_layers', { projectId: 'p1', action: 'align', layerIds: [group.id], mode: 'left' }, bridge, signal);
  assert.equal(bridge.getProject()!.layers.find(layer => layer.id === group.id)!.x, 0);
});

test('flat tool schemas and runtime action contracts stay aligned', () => {
  for (const [name, rules] of [['edit_layers', EDIT_LAYER_RULES], ['manage_projects', PROJECT_RULES]] as const) {
    const schema = TOOL_DEFINITIONS.find(definition => definition.function.name === name)!.function.parameters;
    assert.equal(schema.type, 'object');
    assert.equal(schema.oneOf, undefined);
    assert.equal(schema.anyOf, undefined);
    const fields = schema.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(fields.action.enum, Object.keys(rules));
    const contractFields = new Set(['action', ...Object.values(rules).flatMap(rule => [...rule.required, ...rule.optional])]);
    assert.deepEqual(Object.keys(fields).sort(), [...contractFields].sort());
    for (const [action, rule] of Object.entries(rules)) {
      assert.deepEqual([...(schema.required as string[])].sort(), ['action', ...Object.keys(fields).filter(field => field !== 'action' && Object.values(rules).every(branch => (branch.required as readonly string[]).includes(field)))].sort());
      for (const field of [...rule.required, ...rule.optional]) {
        if (field === 'projectId' && name === 'edit_layers' || field === 'layerIds') continue;
        assert.ok((fields[field].description as string).startsWith(fieldUsage(rules, field)), `${name}.${action}.${field}`);
      }
    }
    if (name === 'edit_layers') {
      assert.equal(fields.properties.minProperties, 1);
      assert.deepEqual(fields.mode.enum, [...ALIGN_MODES, ...DISTRIBUTE_MODES]);
    }
  }
});

test('action parsers accept every valid action and reject every cross-action field', () => {
  const layerSamples: Record<string, unknown> = { projectId: 'p1', layerIds: ['a', 'b', 'c'], properties: { opacity: 0.5 }, name: 'Group', mode: 'left' };
  const projectSamples: Record<string, unknown> = { projectId: 'p1', title: 'Title', page: 1, pageSize: 20, query: 'Find', width: 800, height: 600 };
  for (const [rules, samples, parse] of [[EDIT_LAYER_RULES, layerSamples, parseEditLayersRequest], [PROJECT_RULES, projectSamples, parseManageProjectsRequest]] as const) {
    for (const [action, rule] of Object.entries(rules)) {
      const allowed: readonly string[] = [...rule.required, ...rule.optional];
      const args = { action, ...Object.fromEntries(allowed.map(field => [field, field === 'mode' && action === 'distribute' ? 'horizontal' : samples[field]])) };
      assert.deepEqual(parse(args), args);
      for (const field of Object.keys(samples).filter(field => !allowed.includes(field))) {
        assert.throws(() => parse({ ...args, [field]: samples[field] }), /unsupported field/);
      }
      for (const field of rule.required) {
        const missing: Record<string, unknown> = { ...args };
        delete missing[field];
        assert.throws(() => parse(missing), /missing required field/);
        assert.throws(() => parse({ ...args, [field]: null }));
      }
    }
    for (const invalid of [null, [], {}, { action: '__proto__' }, { action: 'unknown' }]) assert.throws(() => parse(invalid));
  }
  for (const mode of ALIGN_MODES) assert.equal(parseEditLayersRequest({ projectId: 'p1', action: 'align', layerIds: ['a'], mode }).action, 'align');
  for (const mode of DISTRIBUTE_MODES) assert.equal(parseEditLayersRequest({ projectId: 'p1', action: 'distribute', layerIds: ['a', 'b', 'c'], mode }).action, 'distribute');
});

test('forward and backward execute through the tool without extra parameters', async () => {
  const { bridge, signal } = setup();
  for (const content of ['First', 'Second', 'Third']) await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { content } }, bridge, signal);
  const [first, second, third] = bridge.getProject()!.layers.map(layer => layer.id);
  const args = { projectId: 'p1', layerIds: [first] };
  await executeTool('edit_layers', { ...args, action: 'forward' }, bridge, signal);
  assert.deepEqual(bridge.getProject()!.layers.map(layer => layer.id), [second, first, third]);
  await executeTool('edit_layers', { ...args, action: 'backward' }, bridge, signal);
  assert.deepEqual(bridge.getProject()!.layers.map(layer => layer.id), [first, second, third]);
  const before = structuredClone(bridge.getProject());
  await assert.rejects(executeTool('edit_layers', { ...args, action: 'forward', mode: 'left' }, bridge, signal), /unsupported field/);
  await assert.rejects(executeTool('edit_layers', { ...args, action: 'backward', properties: { zIndex: 1 } }, bridge, signal), /unsupported field/);
  assert.deepEqual(bridge.getProject(), before);
});

test('image source and description are editable, readable and restricted to image layers', async () => {
  const { bridge, signal } = setup();
  await executeTool('add_layer', { projectId: 'p1', type: 'image', properties: { content: 'https://example.com/photo.png', image: { imageSource: 'upload', imageDescription: 'A user description' } } }, bridge, signal);
  const id = bridge.getProject()!.selectedLayerId!;
  await executeTool('edit_layers', { projectId: 'p1', action: 'update', layerIds: [id], properties: { image: { imageDescription: 'Revised description' } } }, bridge, signal);
  const selected = await executeTool('get_selected_layers', {}, { ...bridge, getSelection: () => [id] }, signal) as { layers: { imageSource: string; imageDescription: string }[]; images: unknown[] };
  assert.equal(selected.layers[0].imageSource, 'upload');
  assert.equal(selected.layers[0].imageDescription, 'Revised description');
  assert.deepEqual(selected.images, []);
  const saved = JSON.parse(JSON.stringify(bridge.getProject())) as ProjectState;
  assert.equal(saved.layers[0].imageDescription, 'Revised description');
  assert.throws(() => layerPatch({ image: { imageSource: 'x'.repeat(201) } }), /Invalid/);
  assert.throws(() => layerPatch({ image: { imageDescription: 'x'.repeat(10001) } }), /Invalid/);
  await assert.rejects(executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { content: 'Text', image: { imageSource: 'upload' } } }, bridge, signal), /only supported/);
});

test('image layer flip, filters, and non-destructive crop are controllable via AI tools and restricted to image layers', async () => {
  const { bridge, signal } = setup();
  await executeTool('add_layer', {
    projectId: 'p1',
    type: 'image',
    properties: {
      content: 'https://example.com/photo.png',
      width: 400,
      height: 300,
      image: {
        flipX: true,
        imageFilters: { brightness: 120, contrast: 110 },
        imageCrop: { x: 10, y: 20, width: 50, height: 50 }
      }
    }
  }, bridge, signal);

  const id = bridge.getProject()!.selectedLayerId!;
  let layer = bridge.getProject()!.layers[0];
  assert.equal(layer.flipX, true);
  assert.deepEqual(layer.imageFilters, { brightness: 120, contrast: 110, grayscale: 0, blur: 0 });
  assert.deepEqual(layer.imageCrop, { x: 10, y: 20, width: 50, height: 50 });

  // Partial filter update preserves existing brightness/contrast and updates grayscale/blur
  await executeTool('edit_layers', {
    projectId: 'p1',
    action: 'update',
    layerIds: [id],
    properties: { image: { imageFilters: { grayscale: 40, blur: 2.5 } } }
  }, bridge, signal);
  layer = bridge.getProject()!.layers[0];
  assert.deepEqual(layer.imageFilters, { brightness: 120, contrast: 110, grayscale: 40, blur: 2.5 });

  // Flipping horizontally mirrors active crop X coordinate
  await executeTool('edit_layers', {
    projectId: 'p1',
    action: 'update',
    layerIds: [id],
    properties: { image: { flipX: false, flipY: true } }
  }, bridge, signal);
  layer = bridge.getProject()!.layers[0];
  assert.equal(layer.flipX, false);
  assert.equal(layer.flipY, true);
  assert.deepEqual(layer.imageCrop, { x: 40, y: 30, width: 50, height: 50 });

  // Resetting filters and crop via default values clears imageFilters and imageCrop and restores dimensions
  await executeTool('edit_layers', {
    projectId: 'p1',
    action: 'update',
    layerIds: [id],
    properties: {
      image: {
        imageFilters: { brightness: 100, contrast: 100, grayscale: 0, blur: 0 },
        imageCrop: { x: 0, y: 0, width: 100, height: 100 }
      }
    }
  }, bridge, signal);
  layer = bridge.getProject()!.layers[0];
  assert.equal(layer.imageFilters, undefined);
  assert.equal(layer.imageCrop, undefined);
  assert.equal(layer.width, 800);
  assert.equal(layer.height, 600);

  // Reject image-only properties on non-image layers and out-of-bounds crop/filter values
  await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { content: 'Title' } }, bridge, signal);
  const textId = bridge.getProject()!.selectedLayerId!;
  await assert.rejects(executeTool('edit_layers', { projectId: 'p1', action: 'update', layerIds: [textId], properties: { image: { flipX: true } } }, bridge, signal), /only supported/);
  await assert.rejects(executeTool('edit_layers', { projectId: 'p1', action: 'update', layerIds: [textId], properties: { image: { imageFilters: { brightness: 110 } } } }, bridge, signal), /only supported/);
  assert.throws(() => layerPatch({ image: { imageFilters: { brightness: 250 } } }), /Invalid/);
  assert.throws(() => layerPatch({ image: { imageFilters: {} } }), /Invalid imageFilters/);
  assert.throws(() => layerPatch({ image: { imageCrop: {} } }), /Invalid imageCrop/);
  assert.throws(() => layerPatch({ image: { imageCrop: { x: 60, width: 50 } } }), /exceed 100%/);
  await assert.rejects(executeTool('add_layer', { projectId: 'p1', type: 'image', properties: { content: 'https://example.com/other.png', text: { fontSize: 32 } } }, bridge, signal), /only supported on text layers/);
  await assert.rejects(executeTool('edit_layers', { projectId: 'p1', action: 'update', layerIds: [id], properties: { text: { fontSize: 32 } } }, bridge, signal), /only supported on text layers/);
});